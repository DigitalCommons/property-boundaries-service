import "dotenv/config";
import axios from "axios";
import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import extract from "extract-zip";
import csvParser from "csv-parser";
import ogr2ogr from "ogr2ogr";
import { createLandOwnership } from "./queries/query";

const downloadPath = path.resolve("./downloads");

async function downloadInspire() {
  //headless browser getting INSPIRE files

  const url =
    "https://use-land-property-data.service.gov.uk/datasets/inspire/download";
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadPath,
  });

  await page.goto(url);

  const inspireDownloadLinks = await page.evaluate(() => {
    const inspireDownloadLinks = [];
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

  // Just download data from first link for now
  const element = await page.waitForSelector("#" + inspireDownloadLinks[0]);

  await element.click();
  await page.waitForTimeout(5000);

  browser.close();

  return;
}

async function unzip() {
  fs.readdir(downloadPath, (err, files) => {
    files.forEach(async (file) => {
      if (file.includes(".zip")) {
        console.log("Unzip:", file);
        await extract(path.resolve(`${downloadPath}/${file}`), {
          dir: path.resolve(`${downloadPath}/${file}`.replace(".zip", "")),
        });
      }
    });
  });
}

async function transformGML() {
  fs.readdir(downloadPath, (err, files) => {
    files.forEach(async (file) => {
      const folderPath = `${downloadPath}/${file}`;

      if (!fs.lstatSync(folderPath).isFile()) {
        fs.readdir(folderPath, async (err, files) => {
          if (files.includes("Land_Registry_Cadastral_Parcels.gml")) {
            const gmlFile = `${folderPath}/Land_Registry_Cadastral_Parcels.gml`;

            // TODO: comment to explain why we are using this projection
            const { data } = await ogr2ogr(gmlFile, {
              options: ["-t_srs", "EPSG:4269"],
            });

            fs.writeFile(
              `${folderPath}/parcels.json`,
              JSON.stringify(data),
              (err) => {
                console.error(err);
              }
            );

            //for each geojson we need to see if we have an inspire id for that geojson
            //already in the database, if the idea is there, check the coords match
            //if it is, do nothing, if it's not, add it

            //and do we need to remove polygons in the database that are no longer there?
            //how we going to know that? remove from global list of ids the ones
            //that appear or are replaced? i think we probably need to replace
            //them all anyway in case the bounds shift a bit right?

            //and then there's a question about if we're trying to geocode the new ones
          }
        });
      }
    });
  });
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
      createLandOwnership(ownership);
      //determine update type
      //either add or delete or update in database
    });
  fs.createReadStream(exampleCSVPathOverseas)
    .pipe(csvParser())
    .on("data", (ownership) => {
      ownership.proprietor_uk_based = false;
      createLandOwnership(ownership);
      //determine update type
      //either add or delete or update in database
    });
}

// Before deleting we should also:
// - Test that the new data looks okay (e.g. add at least a basic sanity check that the new data isn't corrupted or empty)
// - Automatically save a backup of the previous month's data so that we can easily revert in an emergency

// delete all the files already there
fs.rmSync(path.resolve(downloadPath), { recursive: true, force: true });

downloadInspire().then(unzip).then(transformGML);

downloadOwnerships();
