import "dotenv/config";
import { chromium } from "playwright";
import path from "path";
import fs, { readFileSync } from "fs";
import { readdir, lstat, rm } from "fs/promises";
import extract from "extract-zip";
import { exec } from "child_process";
import { promisify } from "util";
import geojsonhint from "@mapbox/geojsonhint";
import getLogger from "../logger";
import { Logger } from "pino";
import {
  bulkCreatePendingPolygons,
  deleteAllPendingPolygons,
} from "../../queries/query";
import { FeatureCollection, Polygon } from "@turf/turf";

// An array of different user agents for different versions of Chrome on Windows and Mac
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.0.110 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.32.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.33 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.11.0.0 Safari/537.36",
];

let downloadPath: string;
let geojsonPath: string;
let newDownloads: string[] = [];
let logger: Logger;

/** Download INSPIRE files using a headless playwright browser */
const downloadInspire = async (numCouncils: number) => {
  const url =
    "https://use-land-property-data.service.gov.uk/datasets/inspire/download";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // Randomise userAgent so that we are not blocked by bot filters
    userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
  });
  const page = await context.newPage();
  await page.goto(url);

  const inspireDownloadLinks = await page.evaluate(() => {
    const inspireDownloadLinks: string[] = [];
    const pageLinks = document.getElementsByTagName("a");
    let linkIdCount = 0;
    for (const link of pageLinks) {
      if (link.innerText === "Download .gml") {
        link.id = `download-link-${linkIdCount++}`;
        inspireDownloadLinks.push(link.id);
      }
    }

    return inspireDownloadLinks;
  });

  logger.info(
    `We found INSPIRE download links for ${inspireDownloadLinks.length} councils`
  );

  for (const link of inspireDownloadLinks.slice(0, numCouncils)) {
    const downloadButton = await page.waitForSelector("#" + link);

    const downloadPromise = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloadPromise;
    const newDownloadFile = download.suggestedFilename();

    const existingDownloadFile = `${downloadPath}/${newDownloadFile}`;
    const geojsonFilePath = `${geojsonPath}/${newDownloadFile.replace(
      ".zip",
      ".json"
    )}`;
    if (fs.existsSync(geojsonFilePath)) {
      // If GeoJSON already exists for this month, we don't need to download and transform it again
      logger.info(
        `Skip downloading and transforming ${newDownloadFile} since GeoJSON already exists`
      );
    } else if (fs.existsSync(existingDownloadFile)) {
      // If zip file is already downloaded for this month, we don't need to download it again
      logger.info(
        `Skip downloading ${newDownloadFile} since zipfile already exists`
      );
      // We still want to add it to newDownloads so that we unzip and transform it
      newDownloads.push(newDownloadFile);
    } else {
      logger.info(`Downloading ${newDownloadFile}`);
      await download.saveAs(`${downloadPath}/${newDownloadFile}`);
      newDownloads.push(newDownloadFile);
    }
  }

  await browser.close();
};

/**
 * Run backup script in a separate shell process to upload latest INSPIRE zip files to our Hetzner
 * storage box.
 */
const backupInspireDownloads = async () => {
  const command = "bash scripts/backup-inspire-downloads.sh";
  logger.info(`Running '${command}'`);
  const { stdout, stderr } = await promisify(exec)(command);
  logger.info(`raw INSPIRE backup script stdout: ${stdout}`);
  logger.info(`raw INSPIRE backup script stderr: ${stderr}`);
};

/** Unzip an archive then delete the original archive (to save space) */
const unzipArchive = async (council: string) => {
  const zipFile = path.resolve(`${downloadPath}/${council}.zip`);
  const unzipDir = path.resolve(`${downloadPath}/${council}`);
  await rm(unzipDir, { recursive: true, force: true }); // Remove any existing unzipped files
  logger.info(`Unzip: ${council}.zip`);
  await extract(zipFile, {
    dir: unzipDir,
  });
  await rm(zipFile, { force: true }); // Remove zip file
};

/**
 * Transform GML file for a council into a GeoJSON (if GeoJSON hasn't already been generated), then
 * delete the unzipped folder that contained the GML file to save space.
 */
const transformGMLToGeoJson = async (council: string) => {
  const downloadFolderPath = `${downloadPath}/${council}`;
  const geojsonFilePath = `${geojsonPath}/${council}.json`;

  // If GeoJSON already exists for this council and month, we don't need to transform it again
  if (fs.existsSync(geojsonFilePath)) {
    logger.info(
      `Skip transforming ${council} GML since GeoJSON already exists`
    );
    // Remove download folder to save space
    await rm(downloadFolderPath, { recursive: true, force: true });
    return;
  }

  const stat = await lstat(downloadFolderPath);

  if (stat.isDirectory()) {
    const files = await readdir(downloadFolderPath);
    if (files.includes("Land_Registry_Cadastral_Parcels.gml")) {
      logger.info(`Transform GML: ${council}`);
      const gmlFile = `${downloadFolderPath}/Land_Registry_Cadastral_Parcels.gml`;

      try {
        await ogr2ogr(gmlFile, geojsonFilePath);
        logger.info(`Written ${council}.json successfully`);
      } catch (err) {
        logger.error(err, `Transforming ${council}.gml error`);
        throw err;
      }

      // Remove download folder to save space
      await rm(downloadFolderPath, { recursive: true, force: true });
    } else {
      throw new Error(`Download for ${council} didn't contain a GML file`);
    }
  }
};

/**
 * Wrapper for the GDAL ogr2ogr tool, to convert an input GML file into GeoJSON with the EPSG:4326
 * projection (the standard GPS projection used by GeoJSON and in our DB).
 */
const ogr2ogr = async (inputPath: string, outputPath: string) => {
  const command = `ogr2ogr -f GeoJSON -skipfailures -t_srs EPSG:4326 ${outputPath} ${inputPath}`;
  await promisify(exec)(command, {
    maxBuffer: 1024 * 1024 * 1024, // 1 GB should be enough to handle any council
  });
};

/**
 * Test that the newly transformed files are all valid GeoJSON.
 * @returns array of errors (or empty list if GeoJSON is valid)
 */
const geoJsonSanityCheck = () => {
  const errors = [];
  const geoJsonFiles = fs
    .readdirSync(geojsonPath)
    .filter((f) => f.includes(".json"));

  for (const filename of geoJsonFiles) {
    logger.info(`Checking validity of ${filename}`);
    const filePath = path.resolve(`${geojsonPath}/${filename}`);

    var size = fs.statSync(filePath).size;
    if (size > 450 * 1024 * 1024) {
      // we might hit Node maximum string size limit so just skip
      continue;
    }

    const contents = readFileSync(filePath, "utf8");
    const geojsonErrors = geojsonhint
      .hint(JSON.parse(contents))
      .map((errors) => ({ ...errors, filename }));
    errors.push(...geojsonErrors);
  }
  return errors;
};

const createPendingPolygons = async () => {
  await deleteAllPendingPolygons();

  const councils = newDownloads.map((filename) => filename.replace(".zip", ""));

  for (const council of councils) {
    const geojsonFilePath = `${geojsonPath}/${council}.json`;
    const data: FeatureCollection<Polygon> = JSON.parse(
      fs.readFileSync(geojsonFilePath, "utf8")
    );
    logger.info(`Number of polygons in ${council}: ${data.features.length}`);

    // Insert into DB in chunks so we don't hit MySQL max packet limit
    const chunkSize = 10000;
    while (data.features.length > 0) {
      const chunk = data.features.splice(0, chunkSize);
      await bulkCreatePendingPolygons(chunk, council);
    }

    // Remove geojson file (to save space)
    await rm(geojsonFilePath, { force: true });
  }

  logger.info("Created all pending INSPIRE polygons in DB");
};

/**
 * Download the latest INSPIRE data, unzip the archive for each council, then transform each of the
 * GML files to GeoJSON data. The results will be saved to the geojson/ folder, a json file for each
 * council. Finally, after checking that the GeoJSON is valid, insert the data from these GeoJSON
 * files into the 'pending_inspire_polygons' table in the DB, ready for analysis.
 *
 * @param latestInspirePublishMonth month of the latest available INSPIRE data in YYYY-MM format
 * @param numCouncils Download the data for the first <numCouncils> councils. Defaults to all.
 */
export const downloadAndBackupInspirePolygons = async (
  pipelineUniqueKey: string,
  latestInspirePublishMonth: string,
  numCouncils: number = 1e4
) => {
  logger = getLogger(pipelineUniqueKey);

  downloadPath = path.resolve("./downloads", latestInspirePublishMonth);
  geojsonPath = path.resolve("./geojson", latestInspirePublishMonth);
  fs.mkdirSync(downloadPath, { recursive: true });
  fs.mkdirSync(geojsonPath, { recursive: true });

  // delete old files in the geojson and downloads folder
  const oldDownloadsFolders = fs
    .readdirSync("./downloads")
    .filter((folderName) => folderName !== latestInspirePublishMonth);
  for (const folder of oldDownloadsFolders) {
    fs.rmSync(path.resolve("./downloads", folder), {
      recursive: true,
      force: true,
    });
  }
  const oldGeojsonFolders = fs
    .readdirSync("./geojson")
    .filter((folderName) => folderName !== latestInspirePublishMonth);
  for (const folder of oldGeojsonFolders) {
    fs.rmSync(path.resolve("./geojson", folder), {
      recursive: true,
      force: true,
    });
  }

  newDownloads = [];

  await downloadInspire(numCouncils);
  await backupInspireDownloads();

  const councils = newDownloads.map((filename) => filename.replace(".zip", ""));

  for (const council of councils) {
    await unzipArchive(council);
    await transformGMLToGeoJson(council);
  }
  logger.info("Finished transforming GML files");

  const errors = geoJsonSanityCheck();
  if (errors.length > 0) {
    throw new Error(
      `GeoJSON validation failed: ${JSON.stringify(errors, null, 2)}`
    );
  } else {
    logger.info("All GeoJSON files are valid");
  }

  await createPendingPolygons();
};
