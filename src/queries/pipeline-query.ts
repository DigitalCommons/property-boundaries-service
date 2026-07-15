import { Op } from "sequelize";
import { PipelineRunModel } from "./models.js";
import { getRunningPipelineKey } from "../pipeline/util.js";

/**
 * Return the date of the latest ownership snapshot data that was processed by the latest pipeline run, or
 * null if no pipeline has completed yet.
 */
export const getLatestOwnershipSnapshotDataDate = async () => {
  const latestRun: any = await PipelineRunModel.findOne({
    //TODO FIX THE ANY
    where: { latest_snapshot_ownership_data: { [Op.ne]: null } },
    order: [["startedAt", "DESC"]],
  });
  return latestRun ? new Date(latestRun.latest_snapshot_ownership_data) : null;
};

/**
 * Set latest ownership data date for a pipeline run.
 * @param date the lastest snapshot date
 */
export const setPipelineLatestOwnershipSnapshotData = async (date: Date) => {
  await PipelineRunModel.update(
    { latest_snapshot_ownership_data: date },
    {
      where: {
        unique_key: getRunningPipelineKey(),
      },
    },
  );
};
