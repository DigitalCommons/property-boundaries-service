import "dotenv/config";
import axios from "axios";
import path from "path";
import fs from "fs";
import { promisify } from "util";

const generatePath = path.resolve("./generated");

const readdir = promisify(fs.readdir);
const lstat = promisify(fs.lstat);
const writeFile = promisify(fs.writeFile);

async function analyseCouncil(geoJsonPath) {
  fs.createReadStream(geoJsonPath).on("data", (featureCollection) => {
    // do stuff
  });
}

// Read JSON. For each in data.features  ->
// Match on feature.properties.INSPIREID
// // query current property boundary service
// Check the feature.geometry.coordinates are a perfect match
// Check if they're a perfect match but in a different order
