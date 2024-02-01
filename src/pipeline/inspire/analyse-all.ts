import path from "path";
import { readFile } from "fs/promises";
import fs from "fs";
import { Match, getExistingPolygons, comparePolygons } from "./methods";
import { FeatureCollection, Polygon } from "@turf/turf";

const geojsonPath = path.resolve("./geojson");
const analysisPath = path.resolve("./analysis");

const maxRows = 15000; // max number of polygons we will analyse in each JSON
const maxCouncils = 5; // max number of council JSON files we will analyse

export type StatsForEachCouncil = {
  [council: string]: number[];
};

export type AllStats = {
  [statType: string]: StatsForEachCouncil;
};

// Stats which we will be calculating
const allStats: AllStats = {
  percentageIntersects: {},
  offsetMeans: {},
  offsetStds: {},
};

const allIds: AllStats = {
  exactMatchIds: {},
  sameVerticesIds: {},
  exactOffsetIds: {},
  highOverlapIds: {},
  boundariesShiftedIds: {},
  mergedIds: {},
  mergedIncompleteIds: {},
  segmentedIds: {},
  segmentedIncompleteIds: {},
  mergedAndSegmentedIds: {},
  failedMatchIds: {},
  newInspireIds: {},
};

type FailedMatchInfo = {
  inspireId: number;
  sameNumberVertices: boolean;
  latMean?: number;
  longMean?: number;
  latStd?: number;
  longStd?: number;
  percentageIntersect: number;
  oldLatLong: number[];
  newLatLong: number[];
  oldMergedIds?: number[];
  newSegmentIds?: number[];
};
const allFailedMatchesInfo: {
  [council: string]: FailedMatchInfo[];
} = {};

type MergeAndSegmentInfo = {
  inspireId: number;
  type: string;
  oldMergedIds?: number[];
  newSegmentIds?: number[];
  latLong: number[];
  percentageIntersect: number;
};

const allMergeAndSegmentInfo: {
  [council: string]: MergeAndSegmentInfo[];
} = {};

const analysePolygonsInJSON = async (filename: string) => {
  const data: FeatureCollection<Polygon> = JSON.parse(
    await readFile(path.resolve(`${geojsonPath}/${filename}`), "utf8")
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
  const boundariesShiftedIds: number[] = [];
  const mergedIds: number[] = [];
  const mergedIncompleteIds: number[] = [];
  const segmentedIds: number[] = [];
  const segmentedIncompleteIds: number[] = [];
  const mergedAndSegmentedIds: number[] = [];
  const failedMatchIds: number[] = [];
  const newInspireIds: number[] = [];
  const percentageIntersects: number[] = [];
  const offsetMeans: number[] = [];
  const offsetStds: number[] = [];
  const mergeAndSegmentInfo: MergeAndSegmentInfo[] = [];
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

      // Get address of matching title (if exists)
      const titleAddress = existingPolygon.property_address || undefined;

      const firstNearbyPolygonIndex = Math.max(
        0,
        data.features.length - maxRows + index - 500
      );
      const {
        match,
        percentageIntersect,
        offsetStats,
        oldMergedIds,
        newSegmentIds,
      } = await comparePolygons(
        inspireId,
        oldCoords,
        newCoords,
        previousLatLongOffset,
        data.features
          .slice(
            firstNearbyPolygonIndex,
            firstNearbyPolygonIndex + 1000 // include 1000 nearby polygons
          )
          .filter((feature) => feature.properties.INSPIREID !== inspireId),
        titleAddress
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
        case Match.BoundariesShifted:
          boundariesShiftedIds.push(inspireId);
          break;
        case Match.Merged:
          mergedIds.push(inspireId);
          break;
        case Match.MergedIncomplete:
          mergedIncompleteIds.push(inspireId);
          break;
        case Match.Segmented:
          segmentedIds.push(inspireId);
          // TODO: also push the other segment IDs so we don't have to analyse them too
          break;
        case Match.SegmentedIncomplete:
          segmentedIncompleteIds.push(inspireId);
          break;
        case Match.MergedAndSegmented:
          mergedAndSegmentedIds.push(inspireId);
          break;
        case Match.Fail:
          failedMatchIds.push(inspireId);
          failedMatchesInfo.push({
            inspireId,
            ...offsetStats,
            percentageIntersect,
            oldLatLong: oldCoords[0].reverse(),
            newLatLong: newCoords[0].reverse(),
            oldMergedIds,
            newSegmentIds,
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

      switch (match) {
        case Match.Merged:
        case Match.MergedIncomplete:
        case Match.Segmented:
        case Match.SegmentedIncomplete:
        case Match.MergedAndSegmented:
          mergeAndSegmentInfo.push({
            inspireId,
            type: Match[match],
            oldMergedIds,
            newSegmentIds,
            latLong: newCoords[0].reverse(),
            percentageIntersect,
          });
          break;
      }
    } else {
      newInspireIds.push(inspireId);
    }

    if ((index + 1) % 1000 === 0) {
      console.log(`Polygon ${index + 1}/${maxRows}, ${councilName}`);
    }
  }

  allIds.exactMatchIds[councilName] = exactMatchIds;
  allIds.sameVerticesIds[councilName] = sameVerticesIds;
  allIds.exactOffsetIds[councilName] = exactOffsetIds;
  allIds.highOverlapIds[councilName] = highOverlapIds;
  allIds.boundariesShiftedIds[councilName] = boundariesShiftedIds;
  allIds.mergedIds[councilName] = mergedIds;
  allIds.mergedIncompleteIds[councilName] = mergedIncompleteIds;
  allIds.segmentedIds[councilName] = segmentedIds;
  allIds.segmentedIncompleteIds[councilName] = segmentedIncompleteIds;
  allIds.mergedAndSegmentedIds[councilName] = mergedAndSegmentedIds;
  allIds.failedMatchIds[councilName] = failedMatchIds;
  allIds.newInspireIds[councilName] = newInspireIds;
  allStats.percentageIntersects[councilName] = percentageIntersects;
  allStats.offsetMeans[councilName] = offsetMeans;
  allStats.offsetStds[councilName] = offsetStds;
  allMergeAndSegmentInfo[councilName] = mergeAndSegmentInfo;
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
  .readdirSync(geojsonPath)
  .filter((f) => f.includes(".json"))
  .slice(0, maxCouncils);

analyseAllJSONs(files).then((_void) => {
  console.log("\nSanity check:");
  console.log(
    `Total polygons analysed: ${maxRows} for ${files.length} councils = ${
      maxRows * files.length
    }`
  );
  const finalDataPolygonCount = Object.values(allIds)
    .flatMap((ids) => Object.values(ids))
    .flat().length;
  const finalDataCounts = {};
  for (const [matchType, idsForEachCouncil] of Object.entries(allIds)) {
    const count = Object.values(idsForEachCouncil).flat().length;
    finalDataCounts[matchType] = {
      count,
      "%": Math.round((10000 * count) / finalDataPolygonCount) / 100, // round to 2 d.p.
    };
  }
  console.log("Total polygons in final data:", finalDataPolygonCount);
  console.table(finalDataCounts);

  console.log("Storing all stats in analysis.json");
  try {
    fs.mkdirSync(analysisPath, { recursive: true });
    fs.writeFileSync(`${analysisPath}/allIds.json`, JSON.stringify(allIds));
    fs.writeFileSync(`${analysisPath}/allStats.json`, JSON.stringify(allStats));
    fs.writeFileSync(
      `${analysisPath}/allMergeAndSegmentInfo.json`,
      JSON.stringify(allMergeAndSegmentInfo)
    );
    fs.writeFileSync(
      `${analysisPath}/allFailedMatchesInfo.json`,
      JSON.stringify(allFailedMatchesInfo)
    );
  } catch (err) {
    console.error("Error writing analysis.json", err);
  }
});
