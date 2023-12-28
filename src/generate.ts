import "dotenv/config";
import axios from "axios";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { readdir, lstat, writeFile } from "fs/promises";
import extract from "extract-zip";
import csvParser from "csv-parser";
import ogr2ogr from "ogr2ogr";
import moment from "moment-timezone";
// import { createLandOwnership } from "./queries/query";

// Just download data from first 10 councils for now
const maxCouncils = 15;

const downloadPath = path.resolve("./downloads");
const generatePath = path.resolve("./generated");

// An array of different user agents for different versions of Chrome on Windows and Mac
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.0.110 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.32.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.33 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.11.0.0 Safari/537.36",
];

const newDownloads: string[] = [];

/**
 * INSPIRE data is published on the first Sunday of every month. So let's take 23:59:59 on this day
 * as the latest publish time. We will be checking against this time to decide whether to refresh
 * the data we have already downloaded.
 */
const date = moment().tz("Europe/London").startOf("month");
date.day(7); // the next sunday
if (date.date() > 7) {
  // if the date is now after 7th, go back one week
  date.day(-7);
}
const latestInspirePublishTimeMs = date.endOf("day").valueOf(); // UNIX timestamp

/** Download INSPIRE files using a headless playwright browser */
async function downloadInspire() {
  fs.mkdirSync(downloadPath, { recursive: true });
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

  console.log(
    `We found INSPIRE download links for ${inspireDownloadLinks.length} councils`
  );

  for (const link of inspireDownloadLinks.slice(0, maxCouncils)) {
    const downloadButton = await page.waitForSelector("#" + link);

    const downloadPromise = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloadPromise;
    const newDownloadFile = download.suggestedFilename();

    // Check name against existing file and its creation date if it exists
    const existingDownloadFile = `${downloadPath}/${newDownloadFile}`;
    const creationTimeMs = fs.statSync(existingDownloadFile, {
      throwIfNoEntry: false,
    })?.birthtimeMs;

    // If existing file was generated after the latest publish, skip this download
    if (creationTimeMs && creationTimeMs > latestInspirePublishTimeMs) {
      console.log(
        `Skip ${newDownloadFile} since we have already generated data for this council`
      );
    } else {
      console.log(`Downloading ${newDownloadFile}`);
      await download.saveAs(`${downloadPath}/${newDownloadFile}`);
      newDownloads.push(newDownloadFile);
    }
  }

  await browser.close();
}

/** Unzip archives for each of the new downloads in parallel */
async function unzip() {
  await Promise.all(
    newDownloads.map(async (file) => {
      console.log("Unzip:", file);
      await extract(path.resolve(`${downloadPath}/${file}`), {
        dir: path.resolve(`${downloadPath}/${file}`.replace(".zip", "")),
      });
    })
  );
}

/** Transform gml files into GeoJSON for each council in parallel */
async function transformGML() {
  const councils = newDownloads.map((filename) => filename.replace(".zip", ""));
  fs.mkdirSync(generatePath, { recursive: true });

  await Promise.all(
    councils.map(async (council) => {
      const folderPath = `${downloadPath}/${council}`;
      const stat = await lstat(folderPath);

      if (stat.isDirectory()) {
        const files = await readdir(folderPath);
        if (files.includes("Land_Registry_Cadastral_Parcels.gml")) {
          const gmlFile = `${folderPath}/Land_Registry_Cadastral_Parcels.gml`;
          console.log("Transform GML:", council);

          const { data } = await ogr2ogr(gmlFile, {
            maxBuffer: 500 * 1024 * 1024, // 500 MB
            options: ["-t_srs", "EPSG:4326"], // GPS projection, which we use in our database
          });

          try {
            await writeFile(
              `${generatePath}/${council}.json`,
              JSON.stringify(data)
            );
            console.log(`Written ${council}.json successfully`);
          } catch (err) {
            console.error(`Writing ${council}.json error`, err);
          }
        }
      }
    })
  );
}

/** Download the Land Reg UK Companies and Land Reg Overseas Companies data. */
async function downloadOwnerships() {
  const datasetsUKResponse = await axios.get(
    "https://use-land-property-data.service.gov.uk/api/v1/datasets/ccod",
    {
      headers: {
        Authorization: process.env.GOV_API_KEY,
      },
    }
  );

  const datasetsOverseasResponse = await axios.get(
    "https://use-land-property-data.service.gov.uk/api/v1/datasets/ocod",
    {
      headers: {
        Authorization: process.env.GOV_API_KEY,
      },
    }
  );

  const filenameUK =
    datasetsUKResponse.data.result.public_resources[0].file_name;
  const filenameOverseas =
    datasetsOverseasResponse.data.result.public_resources[0].file_name;

  const ownershipsUKResponse = await axios.get(
    `https://use-land-property-data.service.gov.uk/api/v1/datasets/ccod/${filenameUK}`,
    {
      headers: {
        Authorization: process.env.GOV_API_KEY,
      },
    }
  );
  const ownershipsOverseasResponse = await axios.get(
    `https://use-land-property-data.service.gov.uk/api/v1/datasets/ocod/${filenameOverseas}`,
    {
      headers: {
        Authorization: process.env.GOV_API_KEY,
      },
    }
  );

  const exampleUKResponse = await axios.get(
    ownershipsUKResponse.data.result.download_url
  );
  const exampleOverseasResponse = await axios.get(
    ownershipsOverseasResponse.data.result.download_url
  );

  const exampleCSVPathUK = path.resolve(`${downloadPath}/exampleUK.csv`);
  const exampleCSVPathOverseas = path.resolve(
    `${downloadPath}/exampleOverseas.csv`
  );

  // TODO: skip this and pipe directly into DB
  try {
    fs.writeFileSync(exampleCSVPathUK, exampleUKResponse.data);
  } catch (err) {
    console.error(err);
  }

  try {
    fs.writeFileSync(exampleCSVPathOverseas, exampleOverseasResponse.data);
  } catch (err) {
    console.error(err);
  }

  // Add ownership data to the DB
  fs.createReadStream(exampleCSVPathUK)
    .pipe(csvParser())
    .on("data", (ownership) => {
      ownership.proprietor_uk_based = true;
      // createLandOwnership(ownership);
      //determine update type
      //either add or delete or update in database
    });
  fs.createReadStream(exampleCSVPathOverseas)
    .pipe(csvParser())
    .on("data", (ownership) => {
      ownership.proprietor_uk_based = false;
      // createLandOwnership(ownership);
      //determine update type
      //either add or delete or update in database
    });
}

// Before deleting we should also:
// - Test that the new data looks okay (e.g. add at least a basic sanity check that the new data isn't corrupted or empty)
// - Automatically save a backup of the previous month's data so that we can easily revert in an emergency

// delete all the files already there
// fs.rmSync(downloadPath, { recursive: true, force: true });
// fs.rmSync(generatePath, { recursive: true, force: true });

downloadInspire().then(unzip).then(transformGML);

// downloadOwnerships();
