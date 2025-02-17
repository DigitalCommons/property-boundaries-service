import path from "path";
import fs from "fs";
import {
  getExistingInspirePolygons,
  comparePolygons,
  findOldContainingOrContainedPoly,
  coordsOverlapWithExistingPoly,
} from "./methods";
import {
  PendingPolygon,
  acceptPendingPolygon,
  deleteAllPolygonsPendingDeletion,
  getLastPipelineRun,
  getNextPendingPolygon,
  getPendingPolygon,
  getPendingPolygonCount,
  hitMaxRetriesForAPolygon,
  insertAllAcceptedPendingPolygons,
  markPolygonDeletion,
  rejectPendingPolygon,
  resetAllPendingPolygons,
  setPipelineLastPolyAnalysed,
  setPipelineLatestInspireData,
} from "../../queries/query";
import moment from "moment-timezone";
import stringTable from "nodestringtable";
import { logger } from "../logger";
import { getRunningPipelineKey, roundDecimalPlaces } from "../util";
import { Match } from "./match";

const analysisFolder = path.resolve("./analysis");

export type IdCollection = {
  [matchType in Match]?: Set<number>;
};

export type StatsForEachCouncil = {
  [council: string]: number[];
};

export type StatsCollection = {
  [statType: string]: StatsForEachCouncil;
};

let recordStats = false;

// Stats which we will be calculating
let allStats: StatsCollection;

// TODO: remove these in-memory lists and just use pending_inspire_polygons database directly. Check
// how much slower it is if we do this - probably worth it to avoid bugs due to having 2 sources of
// truth. Also, means we can resume pipeline without any inconsistency of algorithm's results
let allIds: IdCollection;

type MergeAndSegmentInstance = {
  inspireId: number;
  council: string;
  match: Match;
  oldMergedIds?: number[];
  newSegmentIds?: number[];
  lngLat: number[];
  percentageIntersect: number;
};

let allMergeAndSegmentInstances: MergeAndSegmentInstance[];

type FailedMatchInfo = {
  inspireId: number;
  council: string;
  newInspireId?: boolean;
  sameNumberVertices?: boolean;
  lngMean?: number;
  latMean?: number;
  lngStd?: number;
  latStd?: number;
  percentageIntersect?: number;
  oldLngLat?: number[];
  newLngLat: number[];
  oldMergedIds?: number[];
  newSegmentIds?: number[];
};

let allFailedMatchesInfo: FailedMatchInfo[];

type InspireIdChange = {
  oldInspireId: number;
  newInspireId: number;
  lngLat: number[];
  oldTitleNo?: string;
};

let allInspireIdChanges: InspireIdChange[];

// Keep track of the offset for the previous successful polygon match, for each council. Nearby
// polygons in the dataset (which is the order they were inserted into the pending polygons table)
// tend to be in close geographical proximity so we can use this offset as a suggestion for cases
// where we are unable to calcualte the offset
let previousLngLatOffsets: {
  [council: string]: number[];
};

/** Reset all the objects we are using to track polygon matches */
const resetAnalysis = async () => {
  allStats = {
    percentageIntersects: {},
    offsetMeans: {},
    offsetStds: {},
  };

  // Get types from the Match enum
  allIds = Object.fromEntries(
    Object.values(Match).map((key) => [key, new Set()])
  );

  allMergeAndSegmentInstances = [];
  allFailedMatchesInfo = [];
  allInspireIdChanges = [];
  previousLngLatOffsets = {};
};

/**
 * Decide what to do for each type of match e.g. whether to accept the pending polygon's coords.
 *
 * TODO: expand this based on the different cases we have research in docs/pipeline.md
 */
const processMatch = async (
  match: Match,
  inspireId: number,
  oldMergedIds?: number[],
  newSegmentIds?: number[]
) => {
  // See 'Match' enum for descriptions of each match type
  switch (match) {
    case Match.Exact:
    case Match.ExactOffset:
    case Match.HighOverlap:
    case Match.Moved:
    case Match.BoundariesShifted:
      await acceptPendingPolygon(inspireId, match);
      break;
    case Match.Merged:
    case Match.MergedIncomplete:
    case Match.Segmented:
    case Match.SegmentedIncomplete:
    case Match.MergedAndSegmented:
      // Accept the new coords, remove any old merged polys, and accept any new segments
      await acceptPendingPolygon(inspireId, match);
      for (const id of oldMergedIds) {
        await markPolygonDeletion(id);
        // TODO: check if old segments have a matching title that still exists. If so, and the
        // address is the same, we can probably link new merged polygon to this title.
      }
      for (const id of newSegmentIds) {
        await acceptPendingPolygon(id, Match.NewSegment);
        // TODO: can we get any other info about these new segments, that may help us link them to a
        // new title? Or are they sometimes part of the original title (probably not, can't see why
        // someone would split a freehold without getting a new title)
      }
      break;
    case Match.Fail:
      // Reject for now. We will hopefully improve our algorithm and it may get processed and
      // accepted in a future run.
      for (const id of [inspireId, ...(newSegmentIds ?? [])]) {
        await rejectPendingPolygon(id);
      }
      break;
  }
};

const analysePolygon = async (polygon: PendingPolygon): Promise<void> => {
  const { poly_id: inspireId, geom, council } = polygon;

  // Skip if already marked as failed (e.g. a new segment of a failed match)
  if (allIds.fail.has(inspireId)) {
    return;
  }

  if (!allStats.percentageIntersects[council]) {
    allStats.percentageIntersects[council] = [];
  }
  if (!allStats.offsetMeans[council]) {
    allStats.offsetMeans[council] = [];
  }
  if (!allStats.offsetStds[council]) {
    allStats.offsetStds[council] = [];
  }

  // TODO: handle instances that we have a multi-polygon e.g. poly 60674447 in Halton_Borough_Council
  if (geom.type !== "Polygon") {
    allIds.fail.add(inspireId);
    allIds.newBoundary.delete(inspireId); // in case we already added the ID to this set
    await processMatch(Match.Fail, inspireId);
    return;
  }

  const existingPolygon: any = (
    await getExistingInspirePolygons([inspireId])
  )[0];

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
      previousLngLatOffsets[council] || [0, 0],
      titleAddress
    );

    // Record all the stats for us to analyse/plot later
    if (recordStats) {
      allStats.percentageIntersects[council].push(percentageIntersect);
      if (offsetStats?.sameNumberVertices) {
        // If offset could be calculated
        allStats.offsetMeans[council].push(
          Math.max(
            // Choose max of either lng or lat i.e. the worst case
            Math.abs(offsetStats.latMean),
            Math.abs(offsetStats.lngMean)
          )
        );
        allStats.offsetStds[council].push(
          Math.max(offsetStats.latStd, offsetStats.lngStd)
        );
      }
    }

    switch (match) {
      case Match.Exact:
      case Match.HighOverlap:
      case Match.BoundariesShifted:
      case Match.Merged:
      case Match.MergedIncomplete:
      case Match.Segmented:
      case Match.SegmentedIncomplete:
      case Match.MergedAndSegmented:
      case Match.Moved:
        allIds[match].add(inspireId);
        break;
      case Match.ExactOffset:
        allIds[match].add(inspireId);
        previousLngLatOffsets[council] = [
          offsetStats.lngMean,
          offsetStats.latMean,
        ];
        break;
      case Match.Fail:
        [inspireId, ...newSegmentIds].forEach((id) => {
          allIds.fail.add(id);
          allIds.newBoundary.delete(id); // in case we already added the ID to this set
        });
        allFailedMatchesInfo.push({
          inspireId: inspireId,
          council,
          ...offsetStats,
          percentageIntersect,
          oldLngLat: oldCoords[0],
          newLngLat: newCoords[0],
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
          match,
          oldMergedIds,
          newSegmentIds,
          lngLat: newCoords[0],
          percentageIntersect,
        });
        newSegmentIds?.forEach((id) => {
          allIds.newSegment.add(id);
          allIds.newBoundary.delete(id); // in case we already added the ID to this set
        });
        break;
    }

    await processMatch(match, inspireId, oldMergedIds, newSegmentIds);
  } else {
    if (!allIds.newSegment.has(inspireId)) {
      allIds.newBoundary.add(inspireId);
      await analyseNewInspireId(inspireId);
    }
  }
};

const analyseNewInspireId = async (inspireId: number) => {
  if (allIds.fail.has(inspireId) || !allIds.newBoundary.has(inspireId)) {
    // Already processed this new INSPIRE ID
    return;
  }

  const polygon: PendingPolygon = await getPendingPolygon(inspireId);
  const newCoords: number[][] = polygon.geom.coordinates[0];
  const lngLatOffset = previousLngLatOffsets[polygon.council] || [0, 0];

  // Remove suggested offset from new polygon, to improve matching against existing polygons
  const newCoordsMinusOffset = newCoords.map((coords) => [
    coords[0] - lngLatOffset[0],
    coords[1] - lngLatOffset[1],
  ]);

  const coordsOverlapWithExisting =
    await coordsOverlapWithExistingPoly(newCoordsMinusOffset);
  if (!coordsOverlapWithExisting) {
    // Can just accept this new poly since it doensn't have any conflicts
    await acceptPendingPolygon(inspireId, Match.NewBoundary);
    return;
  }

  // Skip the rest for now. INSPIRE IDs shouldn't totally change in the Land Registry so this
  // happening is an edge case. We should do more investigation and add tests before re-adding this.
  await processMatch(Match.Fail, inspireId);
  return;

  const oldPoly = await findOldContainingOrContainedPoly(newCoordsMinusOffset);

  if (!oldPoly) {
    // There is overlap (determined previously) but not a clean merge/segment, or the poly still
    // exists, so mark as a fail.
    allIds.newBoundary.delete(inspireId);
    allIds.fail.add(inspireId);
    allFailedMatchesInfo.push({
      inspireId,
      council: polygon.council,
      newInspireId: true,
      newLngLat: newCoords[0],
    });
    await rejectPendingPolygon(inspireId);
    return;
  }

  // Compare against this contained/containing polygon, returning the match type
  const { match, percentageIntersect, oldMergedIds, newSegmentIds } =
    await comparePolygons(
      oldPoly.inspireId,
      inspireId,
      oldPoly.coords,
      newCoords,
      lngLatOffset
    );

  switch (match) {
    case Match.Exact:
    case Match.ExactOffset:
    case Match.HighOverlap:
    case Match.BoundariesShifted:
      logger.debug(
        {
          oldInspireId: oldPoly.inspireId,
          newInspireId: inspireId,
          lngLat: newCoords[0],
          percentageIntersect,
        },
        `INSPIRE ID of polygon has changed`
      );
      allInspireIdChanges.push({
        oldInspireId: oldPoly.inspireId,
        newInspireId: inspireId,
        lngLat: newCoords[0],
        oldTitleNo: oldPoly.titleNo,
      });
      allIds.newBoundary.delete(inspireId);
      allIds.newSegment.delete(inspireId);
      // TODO: Add match type?
      // allIds.changedInspireIds.add(inspireId);
      await markPolygonDeletion(oldPoly.inspireId);
      // TODO: can/should we link the old title to the new polygon?
      break;
    case Match.Merged:
    case Match.MergedIncomplete:
    case Match.Segmented:
    case Match.SegmentedIncomplete:
    case Match.MergedAndSegmented:
      allMergeAndSegmentInstances.push({
        inspireId: oldPoly.inspireId,
        council: polygon.council,
        match,
        oldMergedIds,
        newSegmentIds: [...newSegmentIds, inspireId],
        lngLat: newCoords[0],
        percentageIntersect,
      });
      [...newSegmentIds, inspireId].forEach((id) => {
        // if (!allIds.changedInspireIds.has(id)) {
        //   allIds.newSegmentIds.add(id);
        //   allIds.failedMatchIds.delete(id);
        //   allIds.newBoundaryIds.delete(id); // we don't need to analyse these new INSPIRE IDs again
        // }
      });
      break;
    case Match.Moved:
      // We won't hit this since we didn't supply a title address anyway. It doesn't make sense
      // for this scenario where the INSPIRE ID is different.
      break;
    case Match.Fail:
      [inspireId, ...newSegmentIds].forEach((id) => {
        allIds.fail.add(id);
        allIds.newBoundary.delete(id);
        allIds.newSegment.delete(id);
      });
      allFailedMatchesInfo.push({
        inspireId,
        council: polygon.council,
        newInspireId: true,
        newLngLat: newCoords[0],
      });
      break;
  }

  await processMatch(
    match,
    inspireId,
    oldMergedIds?.concat([oldPoly.inspireId]),
    newSegmentIds
  );
};

/**
 * Loop through all the pending polygons in the pending_inspire_polygons table, trying to find a
 * match with our existing polygons. If the match is successful, mark the pending polygon as
 * accepted. Then, if 'updateBoundaries' is true, copy all of the accepted pending polygons into
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
  const resume = options.resume;
  // Max number of pending polygons we will analyse, default to all
  const maxPolygons: number = options.maxPolygons || 1e9;
  // Whether to record detailed stats for each polygon match.
  recordStats = options.recordStats;

  await resetAnalysis();
  if (!resume) {
    await resetAllPendingPolygons();
  }

  if (options.maxPolygons) {
    logger.info(`Analyse first ${maxPolygons} polygons`);
  }

  // Analyse each row in pending_inspire_polygons. If we are resuming, start after the
  // last polygon analysed, otherwise start from the first row.
  // However, if the pipelines keep failing with an interruption at the same polygon and we have
  // hit our max retries, we should skip that polygon and move on to the next one.
  const latestPipelineRun = await getLastPipelineRun();
  const hitMaxRetries = await hitMaxRetriesForAPolygon();
  const startingId: number = resume
    ? (latestPipelineRun?.last_poly_analysed ?? 0) + (hitMaxRetries ? 1 : 0) + 1
    : 1;

  if (hitMaxRetries) {
    logger.warn(
      `Pipeline has hit max retries for polygon id ${
        latestPipelineRun?.last_poly_analysed + 1
      }, so skipping it`
    );
  }
  logger.info(`Starting analysis from pending poly with id ${startingId}`);

  // Check how many polygons were already analysed (if we are resuming a pipeline)
  const polygonsAnalysedPreviously = await getPendingPolygonCount(startingId);
  const totalPendingPolygons = await getPendingPolygonCount();
  let polygon: PendingPolygon = await getNextPendingPolygon(startingId);
  let numPolygonsAnalysed = 0;

  while (polygon && numPolygonsAnalysed < maxPolygons) {
    await analysePolygon(polygon);
    await setPipelineLastPolyAnalysed(polygon.id);

    numPolygonsAnalysed += 1;
    if ((polygonsAnalysedPreviously + numPolygonsAnalysed) % 5000 === 0) {
      logger.info(
        `Analysed polygon ${(
          polygonsAnalysedPreviously + numPolygonsAnalysed
        ).toLocaleString("en-US")} of ${totalPendingPolygons.toLocaleString(
          "en-US"
        )} (from ${polygon.council})`
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
  const analysisPath = `${analysisFolder}/${currentDateString}_${getRunningPipelineKey()}`;

  try {
    fs.mkdirSync(analysisPath, { recursive: true });
    fs.writeFileSync(
      `${analysisPath}/ids.json`,
      JSON.stringify(allIdsArrays, null, "  ")
    );
    fs.writeFileSync(
      `${analysisPath}/stats.json`,
      JSON.stringify(allStats, null, "  ")
    );
    fs.writeFileSync(
      `${analysisPath}/merges-and-segments.json`,
      JSON.stringify(allMergeAndSegmentInstances, null, "  ")
    );
    fs.writeFileSync(
      `${analysisPath}/failed-matches.json`,
      JSON.stringify(allFailedMatchesInfo, null, "  ")
    );
    fs.writeFileSync(
      `${analysisPath}/inspire-id-changes.json`,
      JSON.stringify(allInspireIdChanges, null, "  ")
    );
  } catch (err) {
    logger.error(err, "Error writing analysis files");
    throw err;
  }

  // Sanity check that all data has been analysed and print summary of results
  const finalDataPolygonCount = Object.values(allIdsArrays).flat().length;

  // If we are resuming a previous full run, include separate stats for this run and all the data
  const printWholeDataStats = resume && startingId > 1 && !options.maxPolygons;

  const finalDataCounts = {};
  for (const [matchType, ids] of Object.entries(allIds)) {
    const count = ids.size;
    finalDataCounts[matchType] = {
      "count (this run)": count.toLocaleString("en-US"),
      "% (this run)": roundDecimalPlaces(
        (count / (finalDataPolygonCount || 1)) * 100,
        3
      ),
    };

    if (printWholeDataStats) {
      // add counts from the database to include previous pipeline runs over the same data
      const wholeCount = await getPendingPolygonCount(
        undefined,
        matchType as Match
      );
      finalDataCounts[matchType] = {
        ...finalDataCounts[matchType],
        "count (all data)": wholeCount.toLocaleString("en-US"),
        "% (all data)": roundDecimalPlaces(
          (wholeCount / totalPendingPolygons) * 100,
          3
        ),
      };
    }
  }
  finalDataCounts["Total"] = {
    "count (this run)": finalDataPolygonCount.toLocaleString("en-US"),
    "% (this run)": 100,
  };

  if (printWholeDataStats) {
    finalDataCounts["Total"] = {
      ...finalDataCounts["Total"],
      "count (all data)": totalPendingPolygons.toLocaleString("en-US"),
      "% (all data)": 100,
    };
  }
  logger.info(finalDataCounts);

  if (finalDataPolygonCount !== numPolygonsAnalysed) {
    throw new Error(
      `Unexpected number of polygons: ${numPolygonsAnalysed.toLocaleString(
        "en-US"
      )} analysed, but ${finalDataPolygonCount.toLocaleString(
        "en-US"
      )} in final count`
    );
  }

  if (options.updateBoundaries) {
    logger.info("Updating main land_ownership_polygons table");
    await deleteAllPolygonsPendingDeletion();
    await insertAllAcceptedPendingPolygons();

    if (
      options.maxPolygons === undefined &&
      options.maxCouncils === undefined &&
      options.afterCouncil === undefined
    ) {
      // All polygons were analysed so mark that the pipeline has updated all INSPIRE polygons
      await setPipelineLatestInspireData(currentDateString.split("_")[0]);
    }
  }

  return stringTable(finalDataCounts).replaceAll("'", " "); // remove quotes from strings
};
