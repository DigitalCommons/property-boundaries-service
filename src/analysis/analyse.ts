import path from "path";
import { readFile } from "fs/promises";
import fs from "fs";
import { Match, getExistingPolygons, comparePolygons } from "./methods";

const generatePath = path.resolve("./generated");
const analysedPath = path.resolve("./analysed");

const maxRows = 15000; // max number of polygons we will analyse in each JSON
const maxCouncils = 1; // max number of council JSON files we will analyse

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
  exactOffsetIds: {},
  highOverlapIds: {},
  segmentedIds: {},
  segmentedIncompleteIds: {},
  failedMatchIds: {},
  newInspireIds: {},
  percentageIntersects: {},
  offsetMeans: {},
  offsetStds: {},
};

type FailedMatchInfo = {
  inspireId: number;
  sameNumberVertices: boolean;
  latMean?: number;
  longMean?: number;
  latStd?: number;
  longStd?: number;
  percentageIntersect: number;
  oldCoords: number[][];
  newCoords: number[][];
};
const allFailedMatchesInfo: {
  [council: string]: FailedMatchInfo[];
} = {};

const analysePolygonsInJSON = async (filename: string) => {
  const data = JSON.parse(
    await readFile(path.resolve(`${generatePath}/${filename}`), "utf8")
  );
  const councilName = path.parse(filename).name;
  console.log(`Number of polygons in ${councilName}:`, data.features.length);
  console.log(`Take last ${maxRows} polygons as a test`);
  const sampleData = data.features.slice(-maxRows);

  const existingPolygons = await getExistingPolygons(
    sampleData.map((feature) => feature.properties.INSPIREID)
  );

  if (!existingPolygons) {
    console.error("Couldn't fetch polygons");
    return;
  }

  const exactMatchIds: number[] = [];
  const sameVerticesIds: number[] = [];
  const exactOffsetIds: number[] = [];
  const highOverlapIds: number[] = [];
  const segmentedIds: number[] = [];
  const segmentedIncompleteIds: number[] = [];
  const failedMatchIds: number[] = [];
  const newInspireIds: number[] = [];
  const percentageIntersects: number[] = [];
  const offsetMeans: number[] = [];
  const offsetStds: number[] = [];
  const failedMatchesInfo: FailedMatchInfo[] = [];

  // Keep track of the offset for the previous successful polygon match. Nearby polygons in the
  // dataset tend to be in close geographical proximity so we can use this offset as a suggestion
  // for cases where we are unable to calcualte the offset
  let previousLatLongOffset: number[] = null;

  // Iterate over polygons
  for (const [index, newFeature] of sampleData.entries()) {
    const inspireId = newFeature.properties.INSPIREID;
    const existingPolygon = existingPolygons.find(
      (polygon) => polygon.poly_id === inspireId
    );
    const newCoords: number[][] = newFeature.geometry.coordinates[0];

    if (existingPolygon) {
      const oldCoords = existingPolygon.geom.coordinates[0];
      // Our DB is in lat-long format and INSPIRE (GeoJSON) is in long-lat format.
      // Reverse old ones since turf uses long-lat
      for (const vertex of oldCoords) {
        vertex.reverse();
      }

      const firstNearbyPolygonIndex = Math.max(
        0,
        data.features.length - 5500 + index
      );
      const { match, percentageIntersect, offsetStats, otherPolygonIds } =
        comparePolygons(
          inspireId,
          oldCoords,
          newCoords,
          previousLatLongOffset,
          data.features
            // .slice(
            //   firstNearbyPolygonIndex,
            //   firstNearbyPolygonIndex + 1000 // include 1000 nearby polygons
            // )
            .filter((feature) => feature.properties.INSPIREID !== inspireId)
        );

      percentageIntersects.push(percentageIntersect);
      if (offsetStats?.sameNumberVertices) {
        // If offset could be calculated
        offsetMeans.push(
          Math.max(
            // Choose max of either long or lat i.e. the worst case
            Math.abs(offsetStats.latMean),
            Math.abs(offsetStats.longMean)
          )
        );
        offsetStds.push(Math.max(offsetStats.latStd, offsetStats.longStd));
      }

      switch (match) {
        case Match.Exact:
          exactMatchIds.push(inspireId);
          break;
        case Match.SameVertices:
          sameVerticesIds.push(inspireId);
          break;
        case Match.ExactOffset:
          exactOffsetIds.push(inspireId);
          previousLatLongOffset = [offsetStats.latMean, offsetStats.longMean];
          break;
        case Match.HighOverlap:
          highOverlapIds.push(inspireId);
          break;
        case Match.Segmented:
          segmentedIds.push(inspireId);
          // TODO: also push the other segment IDs so we don't have to analyse them too
          break;
        case Match.SegmentedIncomplete:
          segmentedIncompleteIds.push(inspireId);
          // case Match.Merged:
          // case Match.MergedIncomplete:
          // TODO
          break;
        case Match.Fail:
          failedMatchIds.push(inspireId);
          failedMatchesInfo.push({
            inspireId,
            ...offsetStats,
            percentageIntersect,
            oldCoords,
            newCoords,
          });

          // TODO:
          // - check if polygon is in the same rough area
          //     - if not, try to geocode matching title?
          break;
        default:
          console.error(
            "We shouldn't hit this, all cases should be handled. INSPIRE ID:",
            inspireId
          );
          break;
      }
    } else {
      newInspireIds.push(inspireId);
    }

    if ((index + 1) % 1000 === 0) {
      // TODO: readd this
      // console.log(`Polygon ${index + 1}/${maxRows}, ${councilName}`);
    }
  }

  allStats.exactMatchIds[councilName] = exactMatchIds;
  allStats.sameVerticesIds[councilName] = sameVerticesIds;
  allStats.exactOffsetIds[councilName] = exactOffsetIds;
  allStats.highOverlapIds[councilName] = highOverlapIds;
  allStats.segmentedIds[councilName] = segmentedIds;
  allStats.segmentedIncompleteIds[councilName] = segmentedIncompleteIds;
  allStats.failedMatchIds[councilName] = failedMatchIds;
  allStats.newInspireIds[councilName] = newInspireIds;
  allStats.percentageIntersects[councilName] = percentageIntersects;
  allStats.offsetMeans[councilName] = offsetMeans;
  allStats.offsetStds[councilName] = offsetStds;
  allFailedMatchesInfo[councilName] = failedMatchesInfo;
};

const analyseAllJSONs = async (filenames: string[]) => {
  // Analyse councils one at a time, to prevent OOM errors
  for (const filename of filenames) {
    await analysePolygonsInJSON(filename);
  }
};

// Script:
const files = fs
  .readdirSync(generatePath)
  .filter((f) => f.includes(".json"))
  .slice(0, maxCouncils);

analyseAllJSONs(files).then((_void) => {
  console.log("Sanity check:");
  console.log(
    `Total polygons analysed: ${maxRows} for ${files.length} councils = ${
      maxRows * files.length
    }`
  );
  const newInspireIdsCount = Object.values(allStats.newInspireIds).flat()
    .length;
  const segmentedIncompleteCount = Object.values(
    allStats.segmentedIncompleteIds
  ).flat().length;
  const failedMatchCount = Object.values(allStats.failedMatchIds).flat().length;
  const finalDataPolygonCount =
    Object.values(allStats.exactMatchIds).flat().length +
    Object.values(allStats.sameVerticesIds).flat().length +
    Object.values(allStats.exactOffsetIds).flat().length +
    Object.values(allStats.highOverlapIds).flat().length +
    Object.values(allStats.segmentedIds).flat().length +
    Object.values(allStats.segmentedIncompleteIds).flat().length +
    failedMatchCount +
    newInspireIdsCount;
  console.log(
    `Total polygons in final data: ${finalDataPolygonCount} (${Math.round(
      (newInspireIdsCount * 100) / finalDataPolygonCount
    )}% new IDs, ${segmentedIncompleteCount} segmented incomplete, ${failedMatchCount} failed matches)`
  );

  console.log("Storing all stats in analysis.json");
  try {
    fs.mkdirSync(analysedPath, { recursive: true });
    fs.writeFileSync(
      `${analysedPath}/analysis.json`,
      JSON.stringify({ allStats, allFailedMatchesInfo })
    );
  } catch (err) {
    console.error("Error writing analysis.json", err);
  }
});
