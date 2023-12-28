import "dotenv/config";
import axios from "axios";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import extract from "extract-zip";
import csvParser from "csv-parser";
import ogr2ogr from "ogr2ogr";
import { createLandOwnership } from "./queries/query";

const downloadPath = path.resolve("./downloads");
const generatePath = path.resolve("./generated");

// An array of different user agents for different versions of Chrome on Windows and Mac
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.0.110 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.32.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.33 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.11.0.0 Safari/537.36",
];

const readdir = promisify(fs.readdir);
const lstat = promisify(fs.lstat);
const writeFile = promisify(fs.writeFile);

/** Download INSPIRE files using a headless playwright browser */
async function downloadInspire() {
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

  // Just download data from first council for now
  const downloadButton = await page.waitForSelector(
    "#" + inspireDownloadLinks[5]
  );

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;

  // Wait for the download process to complete and save the file
  await download.saveAs(`${downloadPath}/${download.suggestedFilename()}`);

  await browser.close();
}

/** Unzip archives for each council in the downloads folder in parallel */
async function unzip() {
  const files = await readdir(downloadPath);

  await Promise.all(
    files.map(async (file) => {
      if (file.includes(".zip")) {
        console.log("Unzip:", file);
        await extract(path.resolve(`${downloadPath}/${file}`), {
          dir: path.resolve(`${downloadPath}/${file}`.replace(".zip", "")),
        });
      }
    })
  );
}

/** Transform gml files into GeoJSON for each council in parallel */
async function transformGML() {
  const downloads = await readdir(downloadPath);
  fs.mkdirSync(generatePath, { recursive: true });

  await Promise.all(
    downloads.map(async (council) => {
      const folderPath = `${downloadPath}/${council}`;
      const stat = await lstat(folderPath);

      if (stat.isDirectory()) {
        const files = await readdir(folderPath);
        if (files.includes("Land_Registry_Cadastral_Parcels.gml")) {
          const gmlFile = `${folderPath}/Land_Registry_Cadastral_Parcels.gml`;
          console.log("Transform GML:", council);

          // TODO: comment to explain why we are using this projection
          const { data } = await ogr2ogr(gmlFile, {
            maxBuffer: 1024 * 1024 * 200,
            // TODO: try instead with:
            // - 3857 (web mercator, default for Mapbox)
            // - 4326 (used by GPS, mentioned in FE README from initial commit)
            // options: ["-t_srs", "EPSG:4269"],
            options: ["-t_srs", "EPSG:4326"], // GPS projection
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
// fs.rmSync(path.resolve(downloadPath), { recursive: true, force: true });
// fs.rmSync(path.resolve(generatePath), { recursive: true, force: true });

// downloadInspire().then(unzip).then(transformGML);

// downloadOwnerships();
