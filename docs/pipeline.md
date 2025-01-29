# The Ownerships + INSPIRE updates pipeline

The purpose of the Ownerships + INSPIRE pipeline is to retrieve new data from open source government
datasets and use it to update the data in our PBS database, which can then be served to Land Explorer.

Note that we currently only have property data for England and Wales.

All of the pipeline-related code lives in the `src/pipeline` directory.

## Overview of the data

We store data in 2 databse tables:

- `land_ownerships` -
  each row in this table links a 'title' (i.e. a title deed for a single property in the Land Registry)
  to a company that owns it. It includes the 'tenure' (leasehold or freehold), when the title was added to the Land Registry, and various details about the company.
- `land_ownership_polygons` -
  each row in this table gives the geometry of a land boundary for a registered property. It has a `poly_id` (a.k.a. INSPIRE ID) and possibly a `title_id` to link the property to on ownership in the above table.

The pipeline obtains data from these open source datasets:

- INSPIRE - a set of polygons, purely land boundaries of freehold properties (but maybe not all freeholds?). Each has an INSPIRE ID. This data set does not link Title ID to these polygons. An updated full dataset is published each month, and there is no way
  to access historical data.

- Land Reg UK Companies - A list of all UK companies that own property, linking a company to a Title ID.

- Land Reg Overseas Companies - A list of overseas companies that own property, linking a company to a Title ID.

In the past, we also used the following closed source dataset:

- National Polygon Service (closed source) - Boundaries for leaseholds _AND_ freeholds, plus Titles IDs for _SOME_ of these freeholds/leaseholds (but some don’t seem to have matched titles).

We gained a copy of the National Polygon Service for evaluation purposes a few years back, but no longer have access. This means there is no longer a way to reliably link Titles to INSPIRE boundary polygons. The pipeline attempts to update ownership and boundary data, whilst preserving this link where possible.

_Note: We refer to poly_id and INSPIRE ID interchangeably because they are the same. The set of INSPIRE polygons is a subset of all polygons in the National Polygon Service, and they share the same ID in each dataset. See the dataset's [technical specification](https://use-land-property-data.service.gov.uk/datasets/nps/tech-spec/1) for more info._

## Stages of the pipeline

The main function that runs the pipeline is [`runPipeline()` in run.ts](../src/pipeline/run.ts).

It runs these tasks in sequential order:

1. `ownerships`: This task updates the `land_ownerships` table (see above), using the latest company
   ownership data. This stage is quite fast and non-destructive, since the government API provides all
   historical data since Nov 2017, so the new data is always written straight into the DB.

1. `downloadInspire`: This task

   1. downloads the latest INSPIRE data
   1. backs up this data to our Hetzner storage box
   1. unzips the downloaded GML data then, using GDAL, transforms it to the standard EPSG:4326
      coordinate system and inserts all polygons into the `pending_inspire_polygons` DB table

1. `analyseInspire`: This task has the following steps

   1. Loop one-by-one through the `pending_inspire_polygons`.

      - If the poly_id already exists in our `land_ownership_polygons` table, we compare the old and
        new polys and try to classify a match. e.g. they could be exactly the same, the polygon could
        be different but with a very big overlap with the old boundary. In some cases, the algorithm
        fails to classify the match, maybe because the polyon changed in an unexpected way. You can see
        descriptions of the match types in the [`Match enum` in
        methods.ts](../src/pipeline/inspire/methods.ts).
      - If the poly_id is new, we check that it's not overlapping with an existing polygon in our DB.

   1. Depending on how the match is classified, we mark each pending polygon as 'accepted' or
      'rejected'.
   1. If the `updateBoundaries` pipeline option was set to true, write all accepted `pending_inspire_polygons` into `land_ownership_polygons`, overwriting existing geometry data.

## How to run it

The pipeline can be triggered by an API request like this:

```
https://<PBS URL>/run-pipeline?secret=<secret>
```

The pipeline can be started with additional options (see [`PipelineOptions` in run.ts](../src/pipeline/run.ts) for details), e.g.:

```
https://<PBS URL>/run-pipeline?secret=<secret>&startAtTask=analyseInspire&maxCouncils=5
```

_Note: The new INSPIRE boundaries will remain in the `pending_inspire_polygons` table where they can be manually analysed (see below) and will not be written into the actual `land_ownership_polygons` table unless the `updateBoundaries` pipeline option is set to true._

## Analysing the pipeline output

After the `updateOwnerships` task is complete, the new data should be visible in LX for all users.

After the `downloadOwnerships` task, a LX super user can see the pending INSPIRE polygons that have been downloaded in a separate, secret data layer.

After the `analyseInspire` task has been run, the pending INSPIRE polygons will be marked 'accepted' if the matching algorithm thinks they are ready to be inserted into the main `land_ownership_polygons` DB table (either as a new row, or updating the geometry of an existing row if it has the same `poly_id`). If a pending polygon has been marked as 'accepted, this will be visible in the secret data layer on LX by (TODO: come up with a way of showing this).

Further detailed output for the pipeline can be found in the `analysis` folder in the project's root folder. This output can help you manually investigate something further e.g. if you want to investigate a failed match:

- find the details in `failed-matches.json` and copy a lng-lat of a vertex
- login to LX as a super user (to become a super user, update your record in MySQL on the server)
- enable the Pending Polygons data layer
- search for the lng-lat in the LX search bar, then click on the properties in view to find and the polygon(s) involved

Once you are satisfied that the `analyseInspire` task has marked the correct polygons as 'accepted', you can trigger the following API request to write them into the main DB table:

```
https://<PBS URL>/run-pipeline?secret=<secret>&resume=true&updateBoundaries=true
```
