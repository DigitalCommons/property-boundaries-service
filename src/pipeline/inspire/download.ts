import "dotenv/config";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { readdir, lstat, rm } from "fs/promises";
import extract from "extract-zip";
import { exec } from "child_process";
import { promisify } from "util";
import moment from "moment-timezone";
import getLogger from "../logger";
import { Logger } from "pino";
import {
  bulkCreatePendingPolygons,
  deleteAllPendingPolygons,
} from "../../queries/query";
import { chain } from "stream-chain";
import { parser } from "stream-json/Parser";
import { pick } from "stream-json/filters/Pick";
import { streamArray } from "stream-json/streamers/StreamArray";
import { Feature, Polygon } from "geojson";

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
const downloadInspire = async (maxCouncils: number) => {
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

  for (const link of inspireDownloadLinks.slice(0, maxCouncils)) {
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
  if (!process.env.REMOTE_BACKUP_DESTINATION_PATH) {
    logger.warn(
      "Skipping backup since REMOTE_BACKUP_DESTINATION_PATH is not set"
    );
    return;
  }
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
 * For all GeoJSONs in the geojson folder, add each polygon to pending_inspire_polygons, ready for
 * analysis, then delete the GeoJSON file (to save space).
 */
const createPendingPolygons = async () => {
  await deleteAllPendingPolygons();

  const councils = fs
    .readdirSync(geojsonPath)
    .filter((f) => f.includes(".json"))
    .map((filename) => filename.replace(".json", ""));

  logger.info(
    `Inserting downloaded polygons from ${councils.length} councils into pending_inspire_polygons...`
  );

  for (const council of councils) {
    const geojsonFilePath = `${geojsonPath}/${council}.json`;
    let polygonsCount = 0;
    const polygonsToCreate = [];

    // Stream JSON rather than reading and parsing whole file, to avoid OOME
    const pipeline = chain([
      fs.createReadStream(geojsonFilePath),
      parser(),
      pick({ filter: "features", once: true }),
      streamArray(),
    ]);

    // Insert into DB in chunks rather than individually, to reduce DB operations, but use small
    // enough chunks so that we don't hit MySQL max packet limit
    const chunkSize = 10000;

    for await (const data of pipeline) {
      const polygon: Feature<Polygon> = data.value;
      ++polygonsCount;

      try {
        // Reverse since we store coords as lat-long in DB, not long-lat as in the govt INSPIRE data
        for (const vertex of polygon.geometry.coordinates[0]) {
          vertex.reverse();
        }
      } catch (error) {
        logger.error(
          { error, polygon },
          `Error reversing polygon coordinates, skip this bad polygon`
        );
        continue;
      }

      polygonsToCreate.push(polygon);

      if (polygonsToCreate.length >= chunkSize) {
        const chunk = polygonsToCreate.splice(0, chunkSize);
        await bulkCreatePendingPolygons(chunk, council);
      }
    }

    // Sanity check that we parsed some data
    if (polygonsCount < 100) {
      throw new Error(
        `We parsed only ${polygonsCount} polygons in ${council}. We expect more than this`
      );
    }
    logger.info(`Number of polygons added from ${council}: ${polygonsCount}`);

    await rm(geojsonFilePath, { force: true });
  }
  logger.info("Created all pending INSPIRE polygons in DB");
};

/**
 * INSPIRE data is published on the first Sunday of every month. This function works out the month
 * of the latest available data in YYYY-MM format
 */
const getLatestInspirePublishMonth = (): string => {
  //
  const date = moment().tz("Europe/London").startOf("month");
  date.day(7); // the next sunday
  if (date.date() > 7) {
    // if the date is now after 7th, go back one week
    date.day(-7);
  }
  const today = moment().tz("Europe/London");
  if (date.isSame(today, "date")) {
    throw new Error(
      "Today is first Sunday of the month. Wait until tomorrow to run pipeline, to avoid data inconsistency problems"
    );
  }
  if (date.isAfter(today)) {
    // Data for this month hasn't been published yet so subtract a month
    date.subtract(1, "month");
  }
  return date.format("YYYY-MM");
};

/**
 * Download the latest INSPIRE data and upload it to our remote backup location. Then, unzip the
 * archive for each council and transform each of the GML files to GeoJSON data. The results will be
 * saved to the geojson/ folder, a json file for each council. Finally, insert the data from these
 * GeoJSON files into the 'pending_inspire_polygons' table in the DB, ready for analysis.
 */
export const downloadAndBackupInspirePolygons = async (options: any) => {
  // Download the data for the first <maxCouncils> councils. Default to all.
  const maxCouncils: number = options.maxCouncils || 1e4;

  logger = getLogger();
  const latestInspirePublishMonth = getLatestInspirePublishMonth();

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

  // delete pending polygons in the database before we start downloading new data, to ensure there
  // is disk space
  await deleteAllPendingPolygons();

  newDownloads = [];

  // Download INSPIRE data from govt website
  await downloadInspire(maxCouncils);

  // If new files were downloaded, back them up
  if (newDownloads.length > 0) {
    await backupInspireDownloads();
  }

  // Unzip and transform all new downloads
  const councils = newDownloads.map((filename) => filename.replace(".zip", ""));
  for (const council of councils) {
    await unzipArchive(council);
    await transformGMLToGeoJson(council);
  }
  logger.info("Finished transforming GML files");

  // Insert new polygons in database as pending, ready for analysis
  await createPendingPolygons();
};
