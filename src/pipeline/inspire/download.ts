import "dotenv/config";
import { chromium } from "playwright";
import path from "path";
import fs, { readFileSync } from "fs";
import { readdir, lstat, writeFile, rm } from "fs/promises";
import extract from "extract-zip";
import ogr2ogr from "ogr2ogr";
import moment from "moment-timezone";
import geojsonhint from "@mapbox/geojsonhint";

// An array of different user agents for different versions of Chrome on Windows and Mac
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.0.110 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.32.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.33 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.11.0.0 Safari/537.36",
];

const geojsonPath = path.resolve("./geojson");
let downloadPath: string;
let newDownloads: string[] = [];

/** Download INSPIRE files using a headless playwright browser */
const downloadInspire = async (numCouncils: number) => {
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

  for (const link of inspireDownloadLinks.slice(0, numCouncils)) {
    const downloadButton = await page.waitForSelector("#" + link);

    const downloadPromise = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloadPromise;
    const newDownloadFile = download.suggestedFilename();

    const existingDownloadFile = `${downloadPath}/${newDownloadFile}`;
    // If existing file is already downloaded for this month, we don't need to download it again
    if (fs.existsSync(existingDownloadFile)) {
      console.log(
        `Skip ${newDownloadFile} since we have already downloaded data for this council`
      );
    } else {
      console.log(`Downloading ${newDownloadFile}`);
      await download.saveAs(`${downloadPath}/${newDownloadFile}`);
    }
    newDownloads.push(newDownloadFile);
  }

  await browser.close();
};

/** Unzip archives for each of the new downloads in parallel */
const unzipArchives = async () => {
  await Promise.all(
    newDownloads.map(async (file) => {
      const unzipDir = path.resolve(
        `${downloadPath}/${file}`.replace(".zip", "")
      );
      await rm(unzipDir, { recursive: true, force: true }); // Remove any existing unzipped files
      console.log("Unzip:", file);
      await extract(path.resolve(`${downloadPath}/${file}`), {
        dir: unzipDir,
      });
    })
  );
};

/** Transform gml files into GeoJSON for each council in parallel */
const transformGMLToGeoJson = async () => {
  const councils = newDownloads.map((filename) => filename.replace(".zip", ""));
  fs.mkdirSync(geojsonPath, { recursive: true });

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
              `${geojsonPath}/${council}.json`,
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
    const contents = readFileSync(
      path.resolve(`${geojsonPath}/${filename}`),
      "utf8"
    );
    errors.push(
      ...geojsonhint.hint(contents).map((errors) => ({ ...errors, filename }))
    );
  }
  return errors;
};

/**
 * Download the latest INSPIRE data, unzip the archive for each council, then transform each of the
 * GML files to GeoJSON data. The results will be saved to the geojson/ folder, a json file for each
 * council.
 *
 * @param numCouncils Download the data for the first <numCouncils> councils. Defaults to all.
 */
export const downloadGeoJsonPolygons = async (numCouncils: number = 1e4) => {
  //  INSPIRE data is published on the first Sunday of every month. Let's find the month of the
  //  latest publish
  const date = moment().tz("Europe/London").startOf("month");
  date.day(7); // the next sunday
  if (date.date() > 7) {
    // if the date is now after 7th, go back one week
    date.day(-7);
  }
  const today = moment().tz("Europe/London");
  if (date.isSame(today, "date")) {
    throw new Error(
      "Today is first Sunday of the month. Wait until tomorrow to run, to avoid data inconsistency problems"
    );
  }
  if (date.isAfter(today)) {
    // Data for this month hasn't been published yet so subtract a month
    date.subtract(1, "month");
  }
  const latestInspirePublishMonth = date.format("YYYY-MM");
  downloadPath = path.resolve("./downloads", latestInspirePublishMonth);

  // reset geojson folder
  fs.rmSync(geojsonPath, { recursive: true, force: true });
  // delete old files in the downloads folder
  const oldFolders = fs
    .readdirSync("./downloads")
    .filter((folderName) => folderName !== latestInspirePublishMonth);
  for (const folder of oldFolders) {
    fs.rmSync(path.resolve("./downloads", folder), {
      recursive: true,
      force: true,
    });
  }

  newDownloads = [];

  await downloadInspire(numCouncils);
  await unzipArchives();
  await transformGMLToGeoJson();

  const errors = geoJsonSanityCheck();
  if (errors.length > 0) {
    throw new Error(
      `GeoJSON validation failed: ${JSON.stringify(errors, null, 2)}`
    );
  }
};
