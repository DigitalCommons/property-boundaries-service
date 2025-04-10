import "dotenv/config";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { readdir, lstat, rm } from "fs/promises";
import extract from "extract-zip";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { logger } from "../logger";
import {
  deleteAllPendingPolygons,
  getLastPipelineRun,
  setPipelineLastCouncilDownloaded,
} from "../../queries/query";
import { getLatestInspirePublishMonth } from "../util";

// An array of different user agents for different versions of Chrome on Windows and Mac
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.0.110 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.32.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.11.0.0 Safari/537.36",
];

let downloadPath: string;
let councils: string[] = [];
let anyNewDownloads = false;

/** Download INSPIRE files using a headless playwright browser */
const downloadInspire = async (
  maxCouncils: number,
  afterCouncil: string | undefined,
) => {
  const url =
    "https://use-land-property-data.service.gov.uk/datasets/inspire/download";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({
    // Randomise userAgent and set other headers so that we are not blocked by bot filters
    "User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)],
    "Accept-Language": "en-US,en;q=0.9",
  });
  await page.goto(url, {
    referer: "https://use-land-property-data.service.gov.uk/datasets/inspire",
  });
  await page.locator(".govuk-link").first().waitFor({ timeout: 10000 });

  const inspireDownloadLinks = await page.evaluate((afterCouncil) => {
    const inspireDownloadLinks: any[] = [];
    const pageLinks = document.getElementsByTagName("a");
    // If afterCouncil is undefined, we want to download all councils, so set matched=true
    let afterCouncilMatched = afterCouncil === undefined;
    let linkIdCount = 0;
    let totalLinksCount = 0;

    for (const link of pageLinks) {
      if (link.innerText === "Download .gml") {
        totalLinksCount++;

        if (afterCouncilMatched) {
          link.id = `download-link-${linkIdCount++}`;
          inspireDownloadLinks.push({
            id: link.id,
            council: link.href.split("/").pop().replace(".zip", ""),
          });
        }

        if (!afterCouncilMatched && link.href.includes(afterCouncil)) {
          afterCouncilMatched = true;
        }
      }
    }
    return inspireDownloadLinks;
  }, afterCouncil);

  logger.info(`Found ${inspireDownloadLinks.length} INSPIRE download links`);
  if (inspireDownloadLinks.length === 0) {
    logger.error(`Page content: ${await page.content()}`);
  } else {
    // Add random delays of 1 to 2 seconds and scrolling to simulate human behavior
    await page.waitForTimeout(Math.floor(Math.random() * 1000 + 1000));
    await page.evaluate(() =>
      window.scrollBy(0, window.innerHeight / (1 + Math.random())),
    );
    await page.waitForTimeout(Math.floor(Math.random() * 1000 + 1000));
  }

  for (const link of inspireDownloadLinks.slice(0, maxCouncils)) {
    const council = link.council;
    const downloadFilePath = `${downloadPath}/${council}.zip`;

    if (fs.existsSync(downloadFilePath)) {
      // If zip file is already downloaded for this month, we don't need to download it again
      logger.info(
        `Skip downloading ${council}.zip since zipfile already exists`,
      );
    } else {
      const downloadButton = await page.waitForSelector("#" + link.id);
      const downloadPromise = page.waitForEvent("download");

      logger.info(`Click download link for ${council}.zip`);
      await downloadButton.click({ force: true });
      logger.info((await page.content()).substring(0, 50000));
      const download = await downloadPromise;

      logger.info(`Downloading ${council}.zip`);
      await download.saveAs(downloadFilePath);
      anyNewDownloads = true;
    }
    councils.push(council);
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
      "Skipping backup since REMOTE_BACKUP_DESTINATION_PATH is not set",
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
 * Run the script to transform and insert data from a council's GML file into the
 * pending_inspire_polygons DB table.
 */
const gmlToPendingInspirePolygons = async (council: string) => {
  const downloadFolderPath = `${downloadPath}/${council}`;
  const stat = await lstat(downloadFolderPath);

  if (stat.isDirectory()) {
    const files = await readdir(downloadFolderPath);
    if (files.includes("Land_Registry_Cadastral_Parcels.gml")) {
      logger.info(`Transform GML and insert into DB: ${council}`);
      const gmlFile = `${downloadFolderPath}/Land_Registry_Cadastral_Parcels.gml`;

      await new Promise<void>((resolve, reject) => {
        const ls = spawn("bash", [
          "scripts/gml-to-pending-inspire-polygons.sh",
          gmlFile,
          council,
        ]);

        ls.stdout.on("data", (data) => {
          logger.info(`${data}`);
        });

        ls.stderr.on("data", (data) => {
          logger.error(`${data}`);
        });

        ls.on("close", (code) => {
          if (code == 0) {
            resolve();
          } else {
            reject(
              `spawn exited with code ${code} when transforming GML for ${council}`,
            );
          }
        });
      });

      // const { stdout, stderr } = await promisify(exec)(
      //   `bash scripts/gml-to-pending-inspire-polygons.sh ${gmlFile} ${council}`,
      //   {
      //     maxBuffer: 1024 * 1024 * 1024, // 1 GB should be enough to handle any council
      //   }
      // );
      // logger.info(
      //   `raw gml-to-pending-inspire-polygons script stdout: ${stdout}`
      // );
      // logger.info(
      //   `raw gml-to-pending-inspire-polygons script stderr: ${stderr}`
      // );

      await setPipelineLastCouncilDownloaded(council);

      // Remove download folder to save space
      await rm(downloadFolderPath, { recursive: true, force: true });
    } else {
      throw new Error(`Download for ${council} didn't contain a GML file`);
    }
  } else {
    throw new Error(`${downloadFolderPath} is not a directory`);
  }
};

/**
 * Download the latest INSPIRE data and upload it to our remote backup location. Then, unzip the
 * archive for each council and transform each of the GML files and insert the data into the
 * 'pending_inspire_polygons' table in the DB, ready for analysis.
 */
export const downloadAndBackupInspirePolygons = async (options: any) => {
  const afterCouncil: string | undefined = options.resume
    ? (await getLastPipelineRun())?.last_council_downloaded || undefined
    : options.afterCouncil;
  // Download the data for the first <maxCouncils> councils after <afterCouncil>. Default to all.
  const maxCouncils: number = options.maxCouncils || 1e4;

  const latestInspirePublishMonth = getLatestInspirePublishMonth();

  logger.info(
    `Download ${latestInspirePublishMonth} INSPIRE data ` + afterCouncil
      ? `after council ${afterCouncil}`
      : "for all councils",
  );

  downloadPath = path.resolve("./downloads", latestInspirePublishMonth);
  fs.mkdirSync(downloadPath, { recursive: true });

  // delete old files in the downloads folder
  const oldDownloadsFolders = fs
    .readdirSync("./downloads")
    .filter((folderName) => folderName !== latestInspirePublishMonth);
  for (const folder of oldDownloadsFolders) {
    fs.rmSync(path.resolve("./downloads", folder), {
      recursive: true,
      force: true,
    });
  }

  if (!options.resume) {
    // delete pending polygons in the database before we start downloading new data, to ensure there
    // is disk space
    logger.info("Deleting all pending polygons in the database");
    await deleteAllPendingPolygons();
  }

  councils = [];

  // Download INSPIRE data from govt website
  await downloadInspire(maxCouncils, afterCouncil);

  // If new files were downloaded, back them up
  if (anyNewDownloads) {
    await backupInspireDownloads();
  }

  // Unzip and transform all new downloads
  for (const council of councils) {
    await unzipArchive(council);
    await gmlToPendingInspirePolygons(council);
  }

  logger.info(
    "Downloaded, transformed, and created all pending INSPIRE polygons in DB",
  );
};
