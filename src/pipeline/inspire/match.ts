/**
 * These are the types of match_type in the pending_inspire_polygons table.
 *
 * Note that we have simplified the comparePolygons method in methods.ts, so we only detect the
 * first 4 types of match, and the rest are marked as a fail.
 */
export enum Match {
  /** Old and new polys have same vertices (to above precision decimal places) */
  Exact = "exact",
  /** Same vertices, each offset by the same lat and long (within distance and std thresholds) */
  ExactOffset = "exactOffset",
  /** Different vertices but with an overlap that meets the percentage intersect threshold */
  HighOverlap = "highOverlap",
  /** The polygon moved and matches with its associated title's new property address */
  Moved = "moved",
  /** The INSPIRE ID is new and distrinct from any existing polygon bounaries */
  NewBoundary = "newBoundary",
  //
  //#### The following types are not currently detected since we skip this part of the analysis ####
  //
  /** Polygon is in same place but it has expanded/shrunk and boundaries have sligtly shifted with
   * adjacent polys */
  BoundariesShifted = "boundariesShifted",
  /** Old polygon merged exactly with at least 1 old polygon, which we have identified */
  Merged = "merged",
  /** Old polygon merged with at least 1 old polygon, but we can't match *some* of the new boundary
   *  to an old polygon */
  MergedIncomplete = "mergedIncomplete",
  /** Old polygon was segmented into multiple new polygons, which we have identified */
  Segmented = "segmented",
  /** Old polygon segmented but we can't find (all of) the other segments */
  SegmentedIncomplete = "segmentedIncomplete",
  /** There was a combination of old boundaries merging and some segmentation into new boundaries */
  MergedAndSegmented = "mergedAndSegmented",
  /** The INSPIRE ID is new and the boundary is part of an old boundary that was segmented */
  NewSegment = "newSegment",
  /** Didn't meet any of the above matching criteria */
  Fail = "fail",
}
