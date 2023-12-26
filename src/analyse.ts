import path from "path";
import { readFile } from "fs/promises";
import * as Plotly from "plotly.js-dist-min";
import fs from "fs";
import { Match, getExistingPolygon, comparePolygons } from "./analysis/methods";

const generatePath = path.resolve("./generated");
const analysedPath = path.resolve("./analysed");
const maxRows = 100; // max number of polygons we will analyse

// Stats which we will be calculating
const exactMatchIds: number[] = [];
const sameVerticesIds: number[] = [];
const differentVerticesIds: number[] = [];
const percentageIntersects: number[] = [];
const newInspireIds: number[] = [];
const latDiff: number[] = [];
const longDiff: number[] = [];

const analysePolygonsInJSON = async (geoJsonPath) => {
  const data = JSON.parse(await readFile(geoJsonPath, "utf8"));
  console.log(`Number of polygons in ${geoJsonPath}:`, data.features.length);
  console.log(`Take first ${maxRows} polygons as a test`);

  await Promise.all(
    data.features.slice(0, maxRows).map(async (feature, index) => {
      const inspireId = feature.properties.INSPIREID;
      const newCoords: number[][] = feature.geometry.coordinates[0];

      // TODO: Combine this into single API call for many polygons, to reduce network load
      const existingPolygon = await getExistingPolygon(inspireId);

      if (existingPolygon) {
        const oldCoords = existingPolygon.geom.coordinates[0];
        // Our DB is in lat-long format and INSPIRE is in long-lat format, so reverse new ones
        for (const vertex of newCoords) {
          vertex.reverse();
        }
        // Store offsets to analyse later
        newCoords.forEach((coords, i) => [
          latDiff.push(coords[0] - oldCoords[i][0]),
          longDiff.push(coords[1] - oldCoords[i][1]),
        ]);

        const { match, percentageIntersect } = comparePolygons(
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
            break;
        }
      } else {
        newInspireIds.push(inspireId);
      }

      if ((index + 1) % 50 === 0) {
        console.log(`Polygon ${index + 1}/${maxRows}`);
      }
    })
  );
};

const plotHistogram = (data: number[]) => {
  Plotly.newPlot("myPlot", [
    {
      x: data,
      type: "histogram",
    },
  ]);
};

// Script:

// const files = fs.readdirSync(generatePath);

// Promise.all(
//   files.map(async (file) => {
//     if (file.includes(".json")) {
//       await analysePolygonsInJSON(path.resolve(`${generatePath}/${file}`));
//     }
//   })
// ).then((data) => {
//   console.log("Exact matches:", exactMatchIds.length);
//   console.log(
//     "Non-exact matches but with same set of unique vertices:",
//     sameVerticesIds.length
//   );
//   console.log("Non-matches (different vertices):", differentVerticesIds.length);
//   console.log("Non-match INSPIRE IDs:", differentVerticesIds);
//   console.log("Percentage intersects:", percentageIntersects);
//   console.log("New INSPIRE IDs: ", newInspireIds);

//   console.log("Storing analysis");
//   try {
//     fs.mkdirSync(analysedPath, { recursive: true });
//     fs.writeFileSync(
//       `${analysedPath}/analysis.json`,
//       JSON.stringify({
//         exactMatchIds,
//         sameVerticesIds,
//         differentVerticesIds,
//         percentageIntersects,
//         newInspireIds,
//         latDiff,
//         longDiff,
//       })
//     );
//   } catch (err) {
//     console.error("Error writing analysis.json", err);
//   }

//   // console.log("Plotting histogram of percentage intersect...");
//   // plotHistogram(percentageIntersect);
// });

const json = fs.readFileSync(path.resolve("./analysed/analysis.json"), "utf8");
const data = JSON.parse(json);
console.log("Plotting histogram of percentage intersect...");
plotHistogram(data.percentageIntersects);
