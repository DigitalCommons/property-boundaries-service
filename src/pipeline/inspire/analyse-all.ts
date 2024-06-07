import path from "path";
import fs from "fs";
import {
  Match,
  getExistingPolygons,
  comparePolygons,
  findExistingContainingOrContainedPoly,
  coordsOverlapWithExistingPoly,
} from "./methods";
import {
  PendingPolygon,
  acceptPendingPolygon,
  deleteAllPolygonsPendingDeletion,
  getNextPendingPolygon,
  getPendingPolygon,
  insertAllAcceptedPendingPolygons,
  markPolygonDeletion,
  rejectPendingPolygon,
  resetPolygonsPendingDeletion,
  setPipelineLatestInspireData,
} from "../../queries/query";
import moment from "moment-timezone";
import stringTable from "nodestringtable";
import getLogger from "../logger";
import { Logger } from "pino";
import { getRunningPipelineKey } from "../util";
import { all } from "axios";

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
  newInspireId?: boolean;
  sameNumberVertices?: boolean;
  latMean?: number;
  longMean?: number;
  latStd?: number;
  longStd?: number;
  percentageIntersect?: number;
  oldLatLong?: number[];
  newLatLong: number[];
  oldMergedIds?: number[];
  newSegmentIds?: number[];
};

let allFailedMatchesInfo: FailedMatchInfo[];

type InspireIdChange = {
  oldInspireId: number;
  newInspireId: number;
  latLong: number[];
  oldTitleNo?: string;
};

let allInspireIdChanges: InspireIdChange[];

// Keep track of the offset for the previous successful polygon match, for each council. Nearby
// polygons in the dataset (which is the order they were inserted into the pending polygons table)
// tend to be in close geographical proximity so we can use this offset as a suggestion for cases
// where we are unable to calcualte the offset
let previousLatLongOffsets: {
  [council: string]: number[];
};

/** Reset all the objects we are using to track polygon matches */
const resetAnalysis = async () => {
  await resetPolygonsPendingDeletion();

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
  allInspireIdChanges = [];
  previousLatLongOffsets = {};
};

/**
 * Decide what to do for each type of match e.g. whether to accept the pending polygon's coords.
 */
const processMatch = async (
  match: Match,
  inspireId: number,
  oldMergedIds: number[],
  newSegmentIds: number[]
) => {
  switch (match) {
    /** Old and new polys have same vertices (to above precision decimal places) */
    case Match.Exact:
      await acceptPendingPolygon(inspireId);
      break;
    /** Same vertices but a different presentation order */
    case Match.SameVertices:
      await acceptPendingPolygon(inspireId);
      break;
    /** Same vertices, each offset by the same lat and long (within distance and std thresholds) */
    case Match.ExactOffset:
      await acceptPendingPolygon(inspireId);
      break;
    /** Different vertices but with an overlap that meets the percentage intersect threshold */
    case Match.HighOverlap:
      await acceptPendingPolygon(inspireId);
      break;
    /** Polygon is in same place but it has expanded/shrunk and boundaries have sligtly shifted with
     * adjacent polys */
    case Match.BoundariesShifted:
      await acceptPendingPolygon(inspireId);
      break;
    /** Old polygon merged exactly with at least 1 old polygon, which we have identified */
    case Match.Merged:
    /** Old polygon merged with at least 1 old polygon, but we can't match *some* of the new
     *  boundary to an old polygon */
    case Match.MergedIncomplete:
    /** Old polygon was segmented into multiple new polygons, which we have identified */
    case Match.Segmented:
    /** Old polygon segmented but we can't find (all of) the other segments */
    case Match.SegmentedIncomplete:
    /** There was a combination of old boundaries merging and some segmentation into new boundaries */
    case Match.MergedAndSegmented:
      // Accept the new coords, remove any old merged polys, and accept any new segments
      await acceptPendingPolygon(inspireId);
      for (const id of oldMergedIds) {
        await markPolygonDeletion(id);
        // TODO: check if old segments have matching title that still exists. If so, and the address
        // is the same, we should link new polygon to this title.
      }
      for (const id of newSegmentIds) {
        await acceptPendingPolygon(id);
        // TODO: can we get any other info about these new segments, that may help us link them to a
        // new title? Or are they part of the original title?
      }
      break;
    /** The polygon moved and matches with its associated title's property address */
    case Match.Moved:
      await acceptPendingPolygon(inspireId);
      break;
    /** Didn't meet any of the above matching criteria */
    case Match.Fail:
      // Reject for now. We will hopefully improve our algorithm and it may get processed and
      // accepted in a future run.
      await rejectPendingPolygon(inspireId);
      break;
  }
};

const analysePolygon = async (polygon: PendingPolygon): Promise<void> => {
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
    const oldCoords: number[][] = existingPolygon.geom.coordinates[0];
    const newCoords: number[][] = geom.coordinates[0];

    // Get address of matching title (if exists)
    const titleAddress = existingPolygon.property_address || undefined;

    // Try to find a match and classify it
    const {
      match,
      percentageIntersect,
      offsetStats,
      oldMergedIds,
      newSegmentIds,
    } = await comparePolygons(
      inspireId,
      inspireId,
      oldCoords,
      newCoords,
      previousLatLongOffsets[council] || [0, 0],
      titleAddress
    );

    // Record all the stats for us to analyse/plot later

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
          oldLatLong: oldCoords[0],
          newLatLong: newCoords[0],
          oldMergedIds,
          newSegmentIds,
        });
        break;
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
          inspireId,
          council,
          type: Match[match],
          oldMergedIds,
          newSegmentIds,
          latLong: newCoords[0],
          percentageIntersect,
        });
        break;
    }

    newSegmentIds.forEach((id) => {
      allIds.newSegmentIds.add(id);
      allIds.newInspireIds.delete(id); // in case we already added the ID to this set
    });

    processMatch(match, inspireId, oldMergedIds, newSegmentIds);
  } else {
    if (!allIds.newSegmentIds.has(inspireId)) {
      allIds.newInspireIds.add(inspireId);
    }
  }
};

const analyseNewInspireId = async (inspireId: number) => {
  const polygon: PendingPolygon = await getPendingPolygon(inspireId);
  const newCoords: number[][] = polygon.geom.coordinates[0];
  const latLongOffset = previousLatLongOffsets[polygon.council] || [0, 0];

  // Remove suggested offset from new polygon, to improve matching against existing polygons
  const newCoordsMinusOffset = newCoords.map((coords) => [
    coords[0] - latLongOffset[0],
    coords[1] - latLongOffset[1],
  ]);

  if (!coordsOverlapWithExistingPoly(newCoordsMinusOffset)) {
    // Can just accept this new poly since it doensn't have any conflicts
    await acceptPendingPolygon(inspireId);
    return;
  }

  const existingPoly =
    await findExistingContainingOrContainedPoly(newCoordsMinusOffset);

  if (!existingPoly) {
    // There is overlap but not a clean merge/segment to mark as a fail
    allIds.newInspireIds.delete(inspireId);
    allIds.failedMatchIds.add(inspireId);
    allFailedMatchesInfo.push({
      inspireId,
      council: polygon.council,
      newInspireId: true,
      newLatLong: newCoords[0],
    });
    await rejectPendingPolygon(inspireId);
    return;
  }

  // Compare against this contained/containing polygon, returning the match type
  const { match, percentageIntersect, oldMergedIds, newSegmentIds } =
    await comparePolygons(
      existingPoly.inspireId,
      inspireId,
      existingPoly.coords,
      newCoords,
      latLongOffset
    );

  switch (match) {
    case Match.Exact:
    case Match.SameVertices:
    case Match.ExactOffset:
    case Match.HighOverlap:
    case Match.BoundariesShifted:
      // The INSPIRE
      logger.info(
        `INSPIRE ID of polygon has changed from ${existingPoly.inspireId} to ${inspireId}`
      );
      allInspireIdChanges.push({
        oldInspireId: existingPoly.inspireId,
        newInspireId: inspireId,
        latLong: newCoords[0],
        oldTitleNo: existingPoly.titleNo,
      });
      await markPolygonDeletion(existingPoly.inspireId);
      // TODO: can we link the old title to the new polygon?
      break;
    case Match.Merged:
    case Match.MergedIncomplete:
    case Match.Segmented:
    case Match.SegmentedIncomplete:
    case Match.MergedAndSegmented:
      allMergeAndSegmentInstances.push({
        inspireId: inspireId,
        council: polygon.council,
        type: Match[match],
        oldMergedIds: [...oldMergedIds, existingPoly.inspireId],
        newSegmentIds,
        latLong: newCoords[0],
        percentageIntersect,
      });
      [...newSegmentIds, inspireId].forEach((id) => {
        allIds.newSegmentIds.add(id);
        allIds.newInspireIds.delete(id); // we don't need to analyse this new INSPIRE ID again
      });
      break;
    case Match.Moved:
      // We won't hit this since we didn't supply a title address anyway. It doesn't make sense
      // for this scenario where the INSPIRE ID is different.
      break;
    case Match.Fail:
      allIds.newInspireIds.delete(inspireId);
      allIds.failedMatchIds.add(inspireId);
      allFailedMatchesInfo.push({
        inspireId,
        council: polygon.council,
        newInspireId: true,
        newLatLong: newCoords[0],
      });
      break;
  }

  processMatch(
    match,
    inspireId,
    [...oldMergedIds, existingPoly.inspireId],
    newSegmentIds
  );
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
 * @param updateBoundaries
 * @param maxPolygons
 * @returns a summary table that can be printed of the final data counts
 */
export const analyseAllPendingPolygons = async (
  options: any
): Promise<string> => {
  // Max number of pending polygons we will analyse, default to all
  const maxPolygons: number = options.maxPolygons || 1e9;
  // Whether to overwrite existing boundary data with pending polygons that we accept, default yes.
  const updateBoundaries: boolean = options.updateBoundaries || true;

  logger = getLogger();
  await resetAnalysis();

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

  // Process the complete list of polygons with new INSPIRE IDs (which aren't part of a segmentation
  // that we previously identified)
  for (const inspireId of allIds.newInspireIds) {
    await analyseNewInspireId(inspireId);
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
  const analysisPath = `${analysisFolder}/${currentDateString}_${getRunningPipelineKey()}`;

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
    fs.writeFileSync(
      `${analysisPath}/inspire-id-changes.json`,
      JSON.stringify(allInspireIdChanges)
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

  if (updateBoundaries) {
    await deleteAllPolygonsPendingDeletion();
    await insertAllAcceptedPendingPolygons();

    if (maxPolygons === 1e9) {
      // All polygons were analysed so mark that the pipeline has updated all INSPIRE polygons
      await setPipelineLatestInspireData(currentDateString.split("_")[0]);
    }
  }

  return stringTable(finalDataCounts);
};
