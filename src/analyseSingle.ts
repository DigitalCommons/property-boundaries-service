import path from "path";
import { readdirSync } from "fs";
import { readFile } from "fs/promises";
import { Match, getExistingPolygon, comparePolygons } from "./analysis/methods";

const ID = undefined; //Adur: 35984908;
let council: string | undefined;
const generatePath = path.resolve("./generated");

const analysePolygonInJSON = async (
  geoJsonPath,
  inspireId: number | undefined
) => {
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

    // TODO: Combine this into single API call for many polygons, to reduce network load
    const existingPolygon = await getExistingPolygon(id);

    if (existingPolygon) {
      const oldCoords = existingPolygon.geom.coordinates[0];

      const diff = newCoords.map((coords, i) => [
        coords[0] - oldCoords[i][0],
        coords[1] - oldCoords[i][1],
      ]);
      console.log("Coordinates diff:", diff);

      const { match, percentageIntersect } = comparePolygons(
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
        case Match.DifferentVertices:
          console.log(
            "Different vertices, percentage intersect:",
            percentageIntersect
          );
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
const files = readdirSync(generatePath);
let filePath;
if (council && files.includes(`${council}.json`)) {
  filePath = path.resolve(`${generatePath}/${council}.json`);
} else {
  // Get first JSON file
  filePath = path.resolve(
    `${generatePath}/${files.find((file) => file.includes(".json"))}`
  );
}
analysePolygonInJSON(filePath, ID);
