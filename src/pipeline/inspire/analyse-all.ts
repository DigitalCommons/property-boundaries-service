import path from "path";
import { readFile } from "fs/promises";
import fs from "fs";
import { Match, getExistingPolygons, comparePolygons } from "./methods";
import { FeatureCollection, Polygon } from "@turf/turf";
import {
  createOrUpdatePolygonGeom,
  setPipelineLatestInspireData,
} from "../../queries/query";
import moment from "moment-timezone";
import stringTable from "nodestringtable";

const geojsonPath = path.resolve("./geojson");
const analysisFolder = path.resolve("./analysis");

export type StatsForEachCouncil = {
  [council: string]: number[];
};

export type StatsCollection = {
  [statType: string]: StatsForEachCouncil;
};

type MergeAndSegmentInstance = {
  inspireId: number;
  type: string;
  oldMergedIds?: number[];
  newSegmentIds?: number[];
  latLong: number[];
  percentageIntersect: number;
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

// Stats which we will be calculating
let allStats: StatsCollection;

let allIds: StatsCollection;

let allMergeAndSegmentInstances: {
  [council: string]: MergeAndSegmentInstance[];
};

let allFailedMatchesInfo: {
  [council: string]: FailedMatchInfo[];
};

/** Reset all the objects we are using to track polygon matches */
const resetAnalysis = () => {
  allStats = {
    percentageIntersects: {},
    offsetMeans: {},
    offsetStds: {},
  };

  allIds = {
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
    newSegmentIds: {},
    movedIds: {},
    failedMatchIds: {},
    newInspireIds: {},
  };

  allMergeAndSegmentInstances = {};
  allFailedMatchesInfo = {};
};

/**
 * @returns number of polygons that were analysed in the input data
 */
const analysePolygonsInJSON = async (
  filename: string,
  maxPolygons: number,
  updateDb: boolean
): Promise<number> => {
  const data: FeatureCollection<Polygon> = JSON.parse(
    await readFile(path.resolve(`${geojsonPath}/${filename}`), "utf8")
  );
  const councilName = path.parse(filename).name;
  console.log(`Number of polygons in ${councilName}:`, data.features.length);
  const sampleData = data.features.slice(0, maxPolygons);
  const sampleDataSize = sampleData.length;
  console.log(`Analyse first ${sampleDataSize} polygons`);

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
  // we might add IDs of other polygons to allNewSegmentIds in a single iteration, so prevent duplication
  const allNewSegmentIds: Set<number> = new Set();
  const mergedAndSegmentedIds: number[] = [];
  const movedIds: number[] = [];
  const failedMatchIds: number[] = [];
  const newInspireIds: Set<number> = new Set();
  const percentageIntersects: number[] = [];
  const offsetMeans: number[] = [];
  const offsetStds: number[] = [];
  const mergeAndSegmentInstances: MergeAndSegmentInstance[] = [];
  const failedMatchesInfo: FailedMatchInfo[] = [];

  // Keep track of the offset for the previous successful polygon match. Nearby polygons in the
  // dataset tend to be in close geographical proximity so we can use this offset as a suggestion
  // for cases where we are unable to calcualte the offset
  let previousLatLongOffset: number[] = null;

  // Iterate over polygons
  for (const [index, newFeature] of sampleData.entries()) {
    if ((index + 1) % 1000 === 0) {
      console.log(`Polygon ${index + 1}/${sampleDataSize}, ${councilName}`);
    }

    const inspireId = newFeature.properties.INSPIREID;
    const existingPolygon = existingPolygons.find(
      (polygon) => polygon.poly_id === inspireId
    );

    if (existingPolygon) {
      const newCoords: number[][] = newFeature.geometry.coordinates[0];
      const oldCoords: number[][] = existingPolygon.geom.coordinates[0];
      // Our DB is in lat-long format and INSPIRE (GeoJSON) is in long-lat format.
      // Reverse old ones since turf uses long-lat
      for (const vertex of oldCoords) {
        vertex.reverse();
      }

      // Get address of matching title (if exists)
      const titleAddress = existingPolygon.property_address || undefined;

      const firstNearbyPolygonIndex = Math.max(
        0,
        data.features.length - sampleDataSize + index - 500
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
          break;
        case Match.SegmentedIncomplete:
          segmentedIncompleteIds.push(inspireId);
          break;
        case Match.MergedAndSegmented:
          mergedAndSegmentedIds.push(inspireId);
          break;
        case Match.Moved:
          movedIds.push(inspireId);
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
          // Move on to the next polygon and skip updating the database
          continue;
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
          mergeAndSegmentInstances.push({
            inspireId,
            type: Match[match],
            oldMergedIds,
            newSegmentIds,
            latLong: newCoords[0].reverse(),
            percentageIntersect,
          });
          newSegmentIds.forEach((id) => {
            allNewSegmentIds.add(id);
            newInspireIds.delete(id); // in case we already added the ID to this set
          });
          break;
      }
    } else {
      if (!allNewSegmentIds.has(inspireId)) {
        newInspireIds.add(inspireId);
      }
    }

    // Update the database (we don't reach here if the match failed)
    if (updateDb) {
      await createOrUpdatePolygonGeom(inspireId, newFeature.geometry);
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
  allIds.newSegmentIds[councilName] = Array.from(allNewSegmentIds);
  allIds.movedIds[councilName] = movedIds;
  allIds.failedMatchIds[councilName] = failedMatchIds;
  allIds.newInspireIds[councilName] = Array.from(newInspireIds);
  allStats.percentageIntersects[councilName] = percentageIntersects;
  allStats.offsetMeans[councilName] = offsetMeans;
  allStats.offsetStds[councilName] = offsetStds;
  allMergeAndSegmentInstances[councilName] = mergeAndSegmentInstances;
  allFailedMatchesInfo[councilName] = failedMatchesInfo;

  return sampleDataSize;
};

/**
 * Loop through the geojson folder and analyse each council's data (one at a time to prevent OOM
 * errors).
 *
 * Print a summary of the results of the analysis to the console, and store the full results in the
 * following JSONs in the analysis folder, each of the files' data grouped by council:
 *  - ids.json contains a list of IDs for each type of polygon match
 *  - stats.json contains statistics for each polygon match
 *  - merges-and-segments.json contains info about merges and segmentations that were found
 *  - failed-matches.json contains info about all the polygon changes that we failed to match
 *
 * @param maxCouncils max number of council JSON files we will analyse, default to all
 * @param maxPolygons max number of polygons in each file we will analyse, default to all
 * @returns a summary table that can be printed of the final data counts
 */
export const analyseAllGeoJSONs = async (
  pipelineUniqueKey: string,
  updateDb: boolean,
  maxCouncils: number = 1e4,
  maxPolygons: number = 1e7
): Promise<string> => {
  resetAnalysis();

  // Get list of GeoJSON files to analyse
  const files = fs
    .readdirSync(geojsonPath)
    .filter((f) => f.includes(".json"))
    .slice(0, maxCouncils);

  let totalNumPolygonsAnalysed = 0;
  // Analyse each GeoJSON file
  for (const filename of files) {
    const numPolygonsAnalysed = await analysePolygonsInJSON(
      filename,
      maxPolygons,
      updateDb
    );
    totalNumPolygonsAnalysed += numPolygonsAnalysed;
  }

  // Store full results which we can analyse more thoroughly
  console.log("Storing results in analysis folder");
  const currentDateString = moment()
    .tz("Europe/London")
    .format("YYYY-MM-DD_HHMMSS");
  const analysisPath = `${analysisFolder}/${currentDateString}_${pipelineUniqueKey}`;

  try {
    fs.mkdirSync(analysisPath, { recursive: true });
    fs.writeFileSync(`${analysisPath}/ids.json`, JSON.stringify(allIds));
    fs.writeFileSync(`${analysisPath}/stats.json`, JSON.stringify(allStats));
    fs.writeFileSync(
      `${analysisPath}/merges-and-segments.json`,
      JSON.stringify(allMergeAndSegmentInstances)
    );
    fs.writeFileSync(
      `${analysisPath}/failed-matches.json`,
      JSON.stringify(allFailedMatchesInfo)
    );
  } catch (err) {
    console.error("Error writing analysis files", err);
    throw err;
  }

  // Sanity check that all data has been analysed and print summary of results
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

  // Print summary table
  const summaryTable = stringTable(finalDataCounts);
  console.log(summaryTable);

  if (finalDataPolygonCount !== totalNumPolygonsAnalysed) {
    throw new Error(
      `Unexpected number of polygons: ${totalNumPolygonsAnalysed} analysed, but ${finalDataPolygonCount} in final count`
    );
  }

  if (updateDb && maxCouncils === 1e4 && maxPolygons === 1e7) {
    // Mark that the INSPIRE polygons in the DB have been updated, if all polygons were analysed
    await setPipelineLatestInspireData(
      pipelineUniqueKey,
      currentDateString.split("_")[0]
    );
  }

  return summaryTable;
};

// analyseAllGeoJSONs("test", false, 1, 100);
