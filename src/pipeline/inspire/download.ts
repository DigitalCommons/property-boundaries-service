import "dotenv/config";
import { chromium } from "playwright";
import path from "path";
import fs, { readFileSync } from "fs";
import { readdir, lstat, writeFile, rm } from "fs/promises";
import extract from "extract-zip";
import { exec } from "child_process";
import { promisify } from "util";
import ogr2ogr from "ogr2ogr";
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
      logger.info(`Skip ${newDownloadFile} since GeoJSON already exists`);
    } else if (fs.existsSync(existingDownloadFile)) {
      // If zip file is already downloaded for this month, we don't need to download it again
      logger.info(
        `Skip ${newDownloadFile} since we have already downloaded data for this council`
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

/** Unzip archives for each of the new downloads then delete the original zip (to save space) */
const unzipArchives = async () => {
  for (const file of newDownloads) {
    const zipFile = path.resolve(`${downloadPath}/${file}`);
    const unzipDir = path.resolve(
      `${downloadPath}/${file}`.replace(".zip", "")
    );
    await rm(unzipDir, { recursive: true, force: true }); // Remove any existing unzipped files
    logger.info(`Unzip: ${file}`);
    await extract(zipFile, {
      dir: unzipDir,
    });
    await rm(zipFile, { force: true }); // Remove zip file
  }
};

/**
 * Transform gml files into GeoJSON for each council (if GeoJSON hasn't already been generated),
 * then delete the unzipped folder that contained the gml file.
 */
const transformGMLToGeoJson = async () => {
  const councils = newDownloads.map((filename) => filename.replace(".zip", ""));

  for (const council of councils) {
    const downloadFolderPath = `${downloadPath}/${council}`;
    const geojsonFilePath = `${geojsonPath}/${council}.json`;

    // If GeoJSON already exists for this council and month, we don't need to transform it again
    if (fs.existsSync(geojsonFilePath)) {
      logger.info(
        `Skip transforming ${council} GML since GeoJSON already exists`
      );
      // Remove download folder to save space
      await rm(downloadFolderPath, { recursive: true, force: true });
      continue;
    }

    const stat = await lstat(downloadFolderPath);

    if (stat.isDirectory()) {
      const files = await readdir(downloadFolderPath);
      if (files.includes("Land_Registry_Cadastral_Parcels.gml")) {
        const gmlFile = `${downloadFolderPath}/Land_Registry_Cadastral_Parcels.gml`;
        logger.info(`Transform GML: ${council}`);

        const { data } = await ogr2ogr(gmlFile, {
          maxBuffer: 1024 * 1024 * 1024, // 1 GB should be enough to handle any council
          options: ["-t_srs", "EPSG:4326"], // GPS projection, which we use in our database
        });

        try {
          await writeFile(geojsonFilePath, JSON.stringify(data));
          logger.info(`Written ${council}.json successfully`);
        } catch (err) {
          logger.error(err, `Writing ${council}.json error`);
          throw err;
        }

        // Remove download folder to save space
        await rm(downloadFolderPath, { recursive: true, force: true });
      } else {
        throw new Error(`Download for ${council} didn't include GML file`);
      }
    }
  }
  logger.info("Finished transforming GML files");
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
    const contents = readFileSync(
      path.resolve(`${geojsonPath}/${filename}`),
      "utf8"
    );
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
    const filePath = `${geojsonPath}/${council}.json`;
    const data: FeatureCollection<Polygon> = JSON.parse(
      fs.readFileSync(filePath, "utf8")
    );
    const councilName = path.parse(filePath).name;
    logger.info(
      `Number of polygons in ${councilName}: ${data.features.length}`
    );

    // Insert into DB in chunks so we don't hit MySQL max packet limit
    const chunkSize = 10000;
    while (data.features.length > 0) {
      const chunk = data.features.splice(0, chunkSize);
      await bulkCreatePendingPolygons(chunk, councilName);
    }
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
  await unzipArchives();
  await transformGMLToGeoJson();

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
