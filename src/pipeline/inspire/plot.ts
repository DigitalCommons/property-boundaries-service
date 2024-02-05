import path from "path";
import { plot, Layout } from "nodeplotlib";
import fs from "fs";
import { StatsCollection, StatsForEachCouncil } from "./analyse-all";
// import { percentile } from "stats-lite";

const analysisPath = path.resolve("./analysis");
const histogramBarmode = "stack";
const barOpacity = 1;

const plotPercentageIntersects = (
  percentageIntersects: StatsForEachCouncil
) => {
  const data = Object.entries(percentageIntersects).reduce(
    (data, [council, stats]) => {
      data.push({
        x: stats,
        name: council,
        type: "histogram",
        opacity: barOpacity,
        xbins: {
          start: 0,
          // start: percentile(stats, 0.01), // Trim bottom 0.01% outliers
          end: 99.5,
          size: 1,
        },
      });

      return data;
    },
    []
  );

  const layout: Layout = {
    title:
      "Percentage intersects histogram (not including exact offset matches)",
    xaxis: { title: "%" },
    yaxis: { title: "Count" },
    barmode: histogramBarmode,
  };

  plot(data, layout);
};

const plotOffsetMeans = (offsetMeans: StatsForEachCouncil) => {
  const data = Object.entries(offsetMeans).reduce((data, [council, stats]) => {
    data.push({
      x: stats,
      name: council,
      type: "histogram",
      opacity: barOpacity,
      xbins: {
        start: 0,
        end: 4e-5,
        size: 1e-7,
      },
    });
    return data;
  }, []);

  const layout: Layout = {
    title: "Offset means histogram",
    xaxis: { title: "Mean offset (degrees lat/long)" },
    yaxis: { title: "Count" },
    barmode: histogramBarmode,
  };

  plot(data, layout);
};

const plotOffsetStds = (offsetStds: StatsForEachCouncil) => {
  const data = Object.entries(offsetStds).reduce((data, [council, stats]) => {
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
  }, []);

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
  path.resolve(`${analysisPath}/stats.json`),
  "utf8"
);
const allStats: StatsCollection = JSON.parse(json);
console.log("Plotting histograms...");
plotPercentageIntersects(allStats.percentageIntersects);
plotOffsetMeans(allStats.offsetMeans);
plotOffsetStds(allStats.offsetStds);
