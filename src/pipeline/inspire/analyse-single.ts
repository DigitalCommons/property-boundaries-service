import path from "path";
import { readdirSync } from "fs";
import { readFile } from "fs/promises";
import { Match, getExistingPolygons, comparePolygons } from "./methods";
import getLogger from "../logger";

// Analyse a single polygon with the following INSPIRE ID (or just take any if undefined)
const ID = undefined;
let council: string | undefined;
const geoJsonPath = path.resolve("./geojson");

const analysePolygonInJSON = async (
  geoJsonPath,
  inspireId: number | undefined
) => {
  const logger = getLogger();
  const data = JSON.parse(await readFile(geoJsonPath, "utf8"));
  console.log(`Number of polygons in ${geoJsonPath}:`, data.features.length);
  let id: number;
  if (inspireId) {
    id = inspireId;
  } else {
    id = data.features[0].properties.INSPIREID;
    console.log("No ID given so use first polygon in dataset:", id);
  }
  const feature = data.features.find(
    (feature) => feature.properties.INSPIREID === id
  );
  if (feature) {
    const newCoords: number[][] = feature.geometry.coordinates[0];
    // Our DB is in lat-long format and INSPIRE dataset is in long-lat format, so reverse them now
    for (const vertex of newCoords) {
      vertex.reverse();
    }

    const existingPolygon: any = (await getExistingPolygons([id]))[0];

    if (existingPolygon) {
      const oldCoords = existingPolygon.geom.coordinates[0];

      const diff = newCoords.map((coords, i) => [
        coords[0] - oldCoords[i][0],
        coords[1] - oldCoords[i][1],
      ]);
      console.log("Coordinates diff:", diff);

      const { match, percentageIntersect, offsetStats } = await comparePolygons(
        id,
        id,
        oldCoords,
        newCoords
      );

      switch (match) {
        case Match.Exact:
          console.log("Exact match");
          break;
        case Match.SameVertices:
          console.log(
            "Same set of vertices but in different presentation order"
          );
          break;
        case Match.ExactOffset:
          console.log(
            "Same vertices, each offset by the same lat and long (within distance and std thresholds)"
          );
          break;
        case Match.HighOverlap:
          console.log(
            "Different vertices but with an overlap that meets the percentage intersect threshold"
          );
          break;
        case Match.Fail:
          console.log("Failed match, info:", {
            ...offsetStats,
            percentageIntersect,
            oldCoords,
            newCoords,
          });
          break;
        default:
          console.error("We shouldn't hit this, all cases should be handled");
          break;
      }
    } else {
      console.log("INSPIRE ID doesn't exist in current DB");
    }
  } else {
    console.log("Can't find polygon with this ID in JSON file");
  }
};

// Script:
const files = readdirSync(geoJsonPath);
let filePath;
if (council && files.includes(`${council}.json`)) {
  filePath = path.resolve(`${geoJsonPath}/${council}.json`);
} else {
  // Get first JSON file
  filePath = path.resolve(
    `${geoJsonPath}/${files.find((file) => file.includes(".json"))}`
  );
}
analysePolygonInJSON(filePath, ID);
