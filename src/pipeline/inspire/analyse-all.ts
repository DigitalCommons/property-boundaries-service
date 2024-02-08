import path from "path";
import fs from "fs";
import { Match, getExistingPolygons, comparePolygons } from "./methods";
import {
  PendingPolygon,
  acceptPendingPolygon,
  getNextPendingPolygon,
  insertAllAcceptedPendingPolygons,
  setPipelineLatestInspireData,
} from "../../queries/query";
import moment from "moment-timezone";
import stringTable from "nodestringtable";
import getLogger from "../logger";
import { Logger } from "pino";

let logger: Logger;
const analysisFolder = path.resolve("./analysis");

export type IdCollection = {
  [idType: string]: Set<number>;
};

export type StatsForEachCouncil = {
  [council: string]: number[];
};

export type StatsCollection = {
  [statType: string]: StatsForEachCouncil;
};

// Stats which we will be calculating
let allStats: StatsCollection;

let allIds: IdCollection;

type MergeAndSegmentInstance = {
  inspireId: number;
  council: string;
  type: string;
  oldMergedIds?: number[];
  newSegmentIds?: number[];
  latLong: number[];
  percentageIntersect: number;
};

let allMergeAndSegmentInstances: MergeAndSegmentInstance[];

type FailedMatchInfo = {
  inspireId: number;
  council: string;
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

let allFailedMatchesInfo: FailedMatchInfo[];

// Keep track of the offset for the previous successful polygon match, for each council. Nearby
// polygons in the dataset (which is the order they were inserted into the pending polygons table)
// tend to be in close geographical proximity so we can use this offset as a suggestion for cases
// where we are unable to calcualte the offset
let previousLatLongOffsets: {
  [council: string]: number[];
};

/** Reset all the objects we are using to track polygon matches */
const resetAnalysis = () => {
  allStats = {
    percentageIntersects: {},
    offsetMeans: {},
    offsetStds: {},
  };

  allIds = {
    exactMatchIds: new Set(),
    sameVerticesIds: new Set(),
    exactOffsetIds: new Set(),
    highOverlapIds: new Set(),
    boundariesShiftedIds: new Set(),
    mergedIds: new Set(),
    mergedIncompleteIds: new Set(),
    segmentedIds: new Set(),
    segmentedIncompleteIds: new Set(),
    mergedAndSegmentedIds: new Set(),
    newSegmentIds: new Set(),
    movedIds: new Set(),
    failedMatchIds: new Set(),
    newInspireIds: new Set(),
  };

  allMergeAndSegmentInstances = [];
  allFailedMatchesInfo = [];
  previousLatLongOffsets = {};
};

const analysePolygon = async (polygon: PendingPolygon): Promise<number> => {
  const { poly_id: inspireId, geom, council } = polygon;

  if (!allStats.percentageIntersects[council]) {
    allStats.percentageIntersects[council] = [];
  }
  if (!allStats.offsetMeans[council]) {
    allStats.offsetMeans[council] = [];
  }
  if (!allStats.offsetStds[council]) {
    allStats.offsetStds[council] = [];
  }

  const existingPolygon: any = (await getExistingPolygons([inspireId]))[0];

  if (existingPolygon) {
    const newCoords: number[][] = geom.coordinates[0];
    const oldCoords: number[][] = existingPolygon.geom.coordinates[0];
    // // Our DB is in lat-long format and INSPIRE (GeoJSON) is in long-lat format.
    // // Reverse old ones since turf uses long-lat
    // for (const vertex of oldCoords) {
    //   vertex.reverse();
    // }

    // Get address of matching title (if exists)
    const titleAddress = existingPolygon.property_address || undefined;

    const {
      match,
      percentageIntersect,
      offsetStats,
      oldMergedIds,
      newSegmentIds,
    } = await comparePolygons(
      logger,
      inspireId,
      oldCoords,
      newCoords,
      previousLatLongOffsets[council] || [0, 0],
      titleAddress
    );

    allStats.percentageIntersects[council].push(percentageIntersect);
    if (offsetStats?.sameNumberVertices) {
      // If offset could be calculated
      allStats.offsetMeans[council].push(
        Math.max(
          // Choose max of either long or lat i.e. the worst case
          Math.abs(offsetStats.latMean),
          Math.abs(offsetStats.longMean)
        )
      );
      allStats.offsetStds[council].push(
        Math.max(offsetStats.latStd, offsetStats.longStd)
      );
    }

    switch (match) {
      case Match.Exact:
        allIds.exactMatchIds.add(inspireId);
        break;
      case Match.SameVertices:
        allIds.sameVerticesIds.add(inspireId);
        break;
      case Match.ExactOffset:
        allIds.exactOffsetIds.add(inspireId);
        previousLatLongOffsets[council] = [
          offsetStats.latMean,
          offsetStats.longMean,
        ];
        break;
      case Match.HighOverlap:
        allIds.highOverlapIds.add(inspireId);
        break;
      case Match.BoundariesShifted:
        allIds.boundariesShiftedIds.add(inspireId);
        break;
      case Match.Merged:
        allIds.mergedIds.add(inspireId);
        break;
      case Match.MergedIncomplete:
        allIds.mergedIncompleteIds.add(inspireId);
        break;
      case Match.Segmented:
        allIds.segmentedIds.add(inspireId);
        break;
      case Match.SegmentedIncomplete:
        allIds.segmentedIncompleteIds.add(inspireId);
        break;
      case Match.MergedAndSegmented:
        allIds.mergedAndSegmentedIds.add(inspireId);
        break;
      case Match.Moved:
        allIds.movedIds.add(inspireId);
        break;
      case Match.Fail:
        allIds.failedMatchIds.add(inspireId);
        allFailedMatchesInfo.push({
          inspireId: inspireId,
          council,
          ...offsetStats,
          percentageIntersect,
          oldLatLong: [oldCoords[0][1], oldCoords[0][0]],
          newLatLong: [newCoords[0][1], newCoords[0][0]],
          oldMergedIds,
          newSegmentIds,
        });
        // Move on to the next polygon and skip updating the database
        return;
      default:
        logger.error(
          `We shouldn't hit this, all cases should be handled. INSPIRE ID: ${inspireId}`
        );
        break;
    }

    switch (match) {
      case Match.Merged:
      case Match.MergedIncomplete:
      case Match.Segmented:
      case Match.SegmentedIncomplete:
      case Match.MergedAndSegmented:
        allMergeAndSegmentInstances.push({
          inspireId: inspireId,
          council,
          type: Match[match],
          oldMergedIds,
          newSegmentIds,
          latLong: [newCoords[0][1], newCoords[0][0]],
          percentageIntersect,
        });
        newSegmentIds.forEach((id) => {
          allIds.newSegmentIds.add(id);
          allIds.newInspireIds.delete(id); // in case we already added the ID to this set
        });
        break;
    }
  } else {
    if (!allIds.newSegmentIds.has(inspireId)) {
      allIds.newInspireIds.add(inspireId);
    }
  }

  // Update the database to mark pending polygon as accepted (we don't reach here if the match failed)
  await acceptPendingPolygon(inspireId);
};

/**
 * Loop through all the pending polygons in the pending_inspire_polygons table, trying to find a
 * match with our existing polygons. If the match is successful, mark the pending polygon as
 * accepted. Then, if 'updateMainDbTable' is true, copy all of the accepted pending polygons into
 * the main land_ownership_polygons table and overwrite existing geometry data.
 *
 * Log a summary of the results of the analysis and store the full results in the
 * following JSONs in the analysis folder:
 *  - ids.json contains a list of IDs for each type of polygon match
 *  - stats.json contains statistics for each polygon match, grouped by council
 *  - merges-and-segments.json contains info about merges and segmentations that were found
 *  - failed-matches.json contains info about all the polygon changes that we failed to match
 *
 * @param updateMainDbTable whether to overwrite existing data with pending polygons that we accept
 * @param maxPolygons max number of pending polygons we will analyse, default to all
 * @returns a summary table that can be printed of the final data counts
 */
export const analyseAllPendingPolygons = async (
  pipelineUniqueKey: string,
  updateMainDbTable: boolean,
  maxPolygons: number = 1e9
): Promise<string> => {
  logger = getLogger(pipelineUniqueKey);
  resetAnalysis();

  if (maxPolygons !== 1e9) {
    logger.info(`Analyse first ${maxPolygons} polygons`);
  }
  let totalNumPolygonsAnalysed = 0;

  // Analyse each row in pending_inspire_polygons
  let polygon: PendingPolygon = await getNextPendingPolygon(1);

  while (polygon && totalNumPolygonsAnalysed < maxPolygons) {
    analysePolygon(polygon);
    totalNumPolygonsAnalysed += 1;

    if (totalNumPolygonsAnalysed % 5000 === 0) {
      logger.info(
        `Polygon ${totalNumPolygonsAnalysed}, Council: ${polygon.council}`
      );
    }
    polygon = await getNextPendingPolygon(polygon.id + 1);
  }

  // Convert sets of IDs to arrays so they can be stored in JSON
  const allIdsArrays = {};
  for (const idType in allIds) {
    allIdsArrays[idType] = Array.from(allIds[idType]);
  }

  // Store full results which we can analyse more thoroughly
  logger.info("Storing results in analysis folder");
  const currentDateString = moment()
    .tz("Europe/London")
    .format("YYYY-MM-DD_HHMMSS");
  const analysisPath = `${analysisFolder}/${currentDateString}_${pipelineUniqueKey}`;

  try {
    fs.mkdirSync(analysisPath, { recursive: true });
    fs.writeFileSync(`${analysisPath}/ids.json`, JSON.stringify(allIdsArrays));
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
    logger.error(err, "Error writing analysis files");
    throw err;
  }

  // Sanity check that all data has been analysed and print summary of results
  const finalDataPolygonCount = Object.values(allIdsArrays).flat().length;

  const finalDataCounts = {};
  for (const [matchType, ids] of Object.entries(allIds)) {
    const count = ids.size;
    finalDataCounts[matchType] = {
      count,
      "%": Math.round((10000 * count) / finalDataPolygonCount) / 100, // round to 2 d.p.
    };
  }
  logger.info(`Total polygons in final data: ${finalDataPolygonCount}`);
  logger.info(finalDataCounts);

  if (finalDataPolygonCount !== totalNumPolygonsAnalysed) {
    throw new Error(
      `Unexpected number of polygons: ${totalNumPolygonsAnalysed} analysed, but ${finalDataPolygonCount} in final count`
    );
  }

  if (updateMainDbTable) {
    // Insert all accepted pending polygons into the main land_ownership_polygons table
    await insertAllAcceptedPendingPolygons();

    if (maxPolygons === 1e9) {
      // All polygons were analysed so mark that the pipeline has updated all INSPIRE polygons
      await setPipelineLatestInspireData(
        pipelineUniqueKey,
        currentDateString.split("_")[0]
      );
    }
  }

  return stringTable(finalDataCounts);
};
