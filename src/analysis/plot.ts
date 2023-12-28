import path from "path";
import { plot, Plot, Layout } from "nodeplotlib";
import fs from "fs";
import { AllStats, StatsForEachCouncil } from "./analyse";

const analysedPath = path.resolve("./analysed");
const histogramBarmode = "stack";
const barOpacity = 1;

const plotPercentageIntersects = (
  percentageIntersects: StatsForEachCouncil
) => {
  const data = Object.entries(percentageIntersects).reduce(
    (data: Plot[], [council, stats]) => {
      data.push({
        x: stats,
        name: council,
        type: "histogram",
        opacity: barOpacity,
        xbins: {
          start: 0,
          end: 100,
          size: 1,
        },
      });
      return data;
    },
    []
  );

  const layout: Layout = {
    title: "Percentage intersects histogram",
    xaxis: { title: "%" },
    yaxis: { title: "Count" },
    barmode: histogramBarmode,
  };

  plot(data, layout);
};

const plotOffsetMeans = (offsetMeans: StatsForEachCouncil) => {
  const data = Object.entries(offsetMeans).reduce(
    (data: Plot[], [council, stats]) => {
      data.push({
        x: stats,
        name: council,
        type: "histogram",
        opacity: barOpacity,
        xbins: {
          start: 0,
          end: 1e-4,
          size: 1e-7,
        },
      });
      return data;
    },
    []
  );

  const layout: Layout = {
    title: "Offset means histogram",
    xaxis: { title: "Mean offset (degrees lat/long)" },
    yaxis: { title: "Count" },
    barmode: histogramBarmode,
  };

  plot(data, layout);
};

const plotOffsetStds = (offsetStds: StatsForEachCouncil) => {
  const data = Object.entries(offsetStds).reduce(
    (data: Plot[], [council, stats]) => {
      data.push({
        x: stats,
        name: council,
        type: "histogram",
        opacity: barOpacity,
        xbins: {
          start: 0,
          end: 2e-8,
          size: 2e-10,
        },
      });
      return data;
    },
    []
  );

  const layout: Layout = {
    title: "Offset standard deviations histogram",
    xaxis: { title: "Std offset (degrees lat/long)" },
    yaxis: { title: "Count" },
    barmode: histogramBarmode,
  };

  plot(data, layout);
};

// Script:
const json = fs.readFileSync(
  path.resolve(`${analysedPath}/analysis.json`),
  "utf8"
);
const stats: AllStats = JSON.parse(json);
console.log("Plotting histograms...");
plotPercentageIntersects(stats.percentageIntersects);
plotOffsetMeans(stats.offsetMeans);
plotOffsetStds(stats.offsetStds);
