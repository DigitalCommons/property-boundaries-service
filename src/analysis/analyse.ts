import path from "path";
import { readFile } from "fs/promises";
import fs from "fs";
import { Match, getExistingPolygons, comparePolygons } from "./methods";

const generatePath = path.resolve("./generated");
const analysedPath = path.resolve("./analysed");
// TODO: to increase this, need to use POST requests instead, since there is a HTTP URL length limit
const maxRows = 2000; // max number of polygons we will analyse in each JSON

export type StatsForEachCouncil = {
  [council: string]: number[];
};

export type AllStats = {
  [statType: string]: StatsForEachCouncil;
};

// Stats which we will be calculating
const allStats: AllStats = {
  exactMatchIds: {},
  sameVerticesIds: {},
  differentVerticesIds: {},
  percentageIntersects: {},
  newInspireIds: {},
  offsetMeans: {},
  offsetStds: {},
};

const analysePolygonsInJSON = async (filename) => {
  const data = JSON.parse(
    await readFile(path.resolve(`${generatePath}/${filename}`), "utf8")
  );
  const councilName = path.parse(filename).name;
  console.log(`Number of polygons in ${councilName}:`, data.features.length);
  console.log(`Take first ${maxRows} polygons as a test`);

  const existingPolygons = await getExistingPolygons(
    data.features
      .slice(0, maxRows)
      .map((feature) => feature.properties.INSPIREID)
  );

  if (!existingPolygons) {
    console.error("Couldn't fetch polygons");
    return;
  }

  const exactMatchIds: number[] = [];
  const sameVerticesIds: number[] = [];
  const differentVerticesIds: number[] = [];
  const percentageIntersects: number[] = [];
  const newInspireIds: number[] = [];
  const offsetMeans: number[] = [];
  const offsetStds: number[] = [];

  for (const [index, newFeature] of data.features.slice(0, maxRows).entries()) {
    const inspireId = newFeature.properties.INSPIREID;
    const existingPolygon = existingPolygons.find(
      (polygon) => polygon.poly_id === inspireId
    );
    const newCoords: number[][] = newFeature.geometry.coordinates[0];

    if (existingPolygon) {
      const oldCoords = existingPolygon.geom.coordinates[0];
      // Our DB is in lat-long format and INSPIRE is in long-lat format, so reverse new ones
      for (const vertex of newCoords) {
        vertex.reverse();
      }

      const { match, percentageIntersect, offsetStats } = comparePolygons(
        oldCoords,
        newCoords
      );

      switch (match) {
        case Match.Exact:
          exactMatchIds.push(inspireId);
          break;
        case Match.SameVertices:
          sameVerticesIds.push(inspireId);
          break;
        case Match.DifferentVertices:
          differentVerticesIds.push(inspireId);
          percentageIntersects.push(percentageIntersect);
          if (offsetStats) {
            // Choose max of either long or lat i.e. the worst case
            offsetMeans.push(
              Math.max(
                Math.abs(offsetStats.latMean),
                Math.abs(offsetStats.longMean)
              )
            );
            offsetStds.push(Math.max(offsetStats.latStd, offsetStats.longStd));
          }
          break;
      }
    } else {
      newInspireIds.push(inspireId);
    }

    if ((index + 1) % 50 === 0) {
      console.log(`Polygon ${index + 1}/${maxRows}, ${councilName}`);
    }
  }

  allStats.exactMatchIds[councilName] = exactMatchIds;
  allStats.sameVerticesIds[councilName] = sameVerticesIds;
  allStats.differentVerticesIds[councilName] = differentVerticesIds;
  allStats.percentageIntersects[councilName] = percentageIntersects;
  allStats.offsetMeans[councilName] = offsetMeans;
  allStats.offsetStds[councilName] = offsetStds;
};

// Script:

const files = fs.readdirSync(generatePath);

Promise.all(
  files.map(async (file) => {
    if (file.includes(".json")) {
      await analysePolygonsInJSON(file);
    }
  })
).then((_data) => {
  console.log("Storing analysis in analysis.json");
  try {
    fs.mkdirSync(analysedPath, { recursive: true });
    fs.writeFileSync(`${analysedPath}/analysis.json`, JSON.stringify(allStats));
  } catch (err) {
    console.error("Error writing analysis.json", err);
  }
});
