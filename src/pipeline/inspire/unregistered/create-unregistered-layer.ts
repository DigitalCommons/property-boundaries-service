import * as turf from "@turf/turf";
import { Feature, MultiPolygon, Polygon } from "geojson";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getPolygonsByIdInSearchArea } from "../../../queries/query";
import fs from "node:fs";

export const createUnregisteredLayer = async () => {
  // Convert OSMM TopographicArea layer from GML file to GeoJSON
  console.log("Convert OSMM to GeoJSON");
  const inputFile =
    "/Users/rohit/Documents/CodeOperative/DigitalCommons/code/Topography Layer -  England - GML/5436275-SX9090.gml";
  const osmmOutputFile = "./osmm.geojson";
  if (!fs.existsSync(osmmOutputFile))
    await promisify(exec)(
      `ogr2ogr -f GeoJSON -skipfailures -t_srs "+proj=longlat +datum=WGS84 +nadgrids=@OSTN15_NTv2_OSGBtoETRS.gsb" -lco RFC7946=YES "${osmmOutputFile}" "${inputFile}" TopographicArea`,
      {
        maxBuffer: 1024 * 1024 * 1024, // 1 GB should be enough
      }
    );

  // TODO: Import the GeoJSON file of UK country boundaries and then take union of England and Wales
  // features (countries BFC dataset https://geoportal.statistics.gov.uk/datasets/d4f6b6bdf58a45b093c0c189bdf92e9d_0/explore)

  // For now just take a sample bbox area, which matches with the sample OSMM data (in Exeter)
  const sampleArea = turf.bboxPolygon([-3.55703, 50.70152, -3.49235, 50.74353]);
  console.log("Area size m2: ", turf.area(sampleArea));

  // Loop over every INSPIRE polygon in land_ownership_polygons and remove its area from the sample area
  console.log("Loading INSPIRE polygons in the sample area");
  //   const inspirePolygons: any = await getPolygonsByIdInSearchArea(
  //     undefined,
  //     JSON.stringify(sampleArea),
  //     false
  //   );

  // Load from file for now, whilst in dev:
  const inspirePolygons: any = JSON.parse(
    fs.readFileSync("./inspire-polys.geojson", "utf8")
  );

  let workingArea: Feature<Polygon | MultiPolygon> = turf.difference(
    turf.featureCollection([
      sampleArea,
      ...inspirePolygons.map((p: any) => turf.feature(p.geom)),
    ])
  );

  console.log("Removed INSPIRE polygons from the area");
  console.log("Area size m2: ", turf.area(workingArea));
  console.log("Remove roads, rail and water");

  // Remove roads, rail and water from the big multi-polygon, by selecting them from the OSMM
  // polygons layer
  const osmmData = JSON.parse(fs.readFileSync(osmmOutputFile, "utf8"));
  const osmmRoadsRailWater = osmmData.features.filter(
    (f: any) =>
      f.properties.theme.includes("Roads Tracks And Paths") ||
      f.properties.theme.includes("Rail") ||
      f.properties.theme.includes("Water") ||
      f.properties.descriptiveGroup.includes("Road Or Track") ||
      f.properties.descriptiveGroup.includes("Rail") ||
      f.properties.descriptiveGroup.includes("Roadside") ||
      f.properties.descriptiveGroup.includes("Tidal Water") ||
      f.properties.descriptiveGroup.includes("Inland Water") ||
      f.properties.descriptiveGroup.includes("Inland Water") ||
      f.properties.descriptiveTerm.includes("Swimming Pool") ||
      f.properties.descriptiveTerm.includes("Well") ||
      f.properties.descriptiveTerm.includes("Fountain")
  );

  workingArea = turf.difference(
    turf.featureCollection([workingArea, ...osmmRoadsRailWater])
  );
  console.log("Area size m2: ", turf.area(workingArea));
};
