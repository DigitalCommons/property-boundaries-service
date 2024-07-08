import { hostname } from "os";
import axios from "axios";
import moment from "moment-timezone";

/** Use this to store the current pipeline key */
let pipelineKey: string;

export const getRunningPipelineKey = () => {
  return pipelineKey || "NO_PIPELINE_KEY_FOUND";
};

export const setRunningPipelineKey = (key: string) => {
  pipelineKey = key;
};

export const notifyMatrix = async (message: string) => {
  const matrixWebhookUrl = process.env.MATRIX_WEBHOOK_URL;
  if (matrixWebhookUrl) {
    await axios.post(matrixWebhookUrl, {
      msgtype: "m.text",
      body: `[${hostname()}] [property_boundaries] ${message}`,
    });
  }
};

/**
 * INSPIRE data is published on the first Sunday of every month. This function works out the date
 * of the latest available data in YYYY-MM format, choosing the 23:59:59 on Sunday to be safe.
 */
export const getLatestInspirePublishDate = (): Date => {
  const date = moment().tz("Europe/London").startOf("month");
  date.day(7); // the next sunday
  if (date.date() > 7) {
    // if the date is now after 7th, go back one week
    date.day(-7);
  }
  date.endOf("day");

  const today = moment().tz("Europe/London");
  if (date.isSame(today, "date")) {
    throw new Error(
      "Today is first Sunday of the month. Wait until tomorrow to run pipeline, to avoid data inconsistency problems"
    );
  }
  if (date.isAfter(today, "date")) {
    // Data for this month hasn't been published yet so subtract a month
    date.subtract(1, "month");
  }
  return date.toDate();
};

/**
 * INSPIRE data is published on the first Sunday of every month. This function works out the month
 * of the latest available data in YYYY-MM format.
 */
export const getLatestInspirePublishMonth = (): string => {
  return getLatestInspirePublishDate().toISOString().slice(0, 7);
};
