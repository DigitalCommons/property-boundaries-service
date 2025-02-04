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
  each row in this table gives the geometry of a land boundary for a registered property. It has a `poly_id` (a.k.a. INSPIRE ID) and possibly a `title_no` to link the property to on ownership in the above table.

The pipeline obtains data from these open source datasets:

- INSPIRE - a set of polygons, purely land boundaries of **freehold** properties (but maybe not a complete set?). Each has an INSPIRE ID. This data set does not link Title Number to these polygons. An updated full dataset is published each month, and there is no way
  to access historical data.

- Land Reg UK Companies - A list of all UK companies that own property, linking a company to a Title Number.

- Land Reg Overseas Companies - A list of overseas companies that own property, linking a company to a Title Number.

In the past, we also used the following closed source dataset:

- National Polygon Service (closed source) - Boundaries for leaseholds _AND_ freeholds, plus Title Numbers for _MOST_ of these freeholds/leaseholds (the spec says all should have matched titles but some don’t seem to have them). A Title Number is unique to that property and [doesn't change between owners](https://www.brecher.co.uk/news/the-title-register-a-quick-explainer/). Also, [a single title may have multiple linked polygons](https://blog.wheregeospatial.com/2019/02/07/land-registry-and-inspire-index-polygons-interview-andrew-trigg/) with separate poly_ids e.g. when garages are in blocks separate from housing.

_Note: We refer to poly_id and INSPIRE ID interchangeably because they are the same. The set of INSPIRE polygons is a subset of all polygons in the National Polygon Service, and they share the same ID in each dataset. See the dataset's [technical specification](https://use-land-property-data.service.gov.uk/datasets/nps/tech-spec/1) for more info._

### The crux of the issue

We gained a copy of the National Polygon Service for evaluation purposes a few years back, but no
longer have access. This means there is no longer a way to reliably link Titles to INSPIRE boundary
polygons. The **purpose of the pipeline** is therefore to attempt to **update ownership and boundary data,
whilst preserving the link between titles and polygons where possible.**

### Different cases of data changing

In order to achive the above purpose, we need to understand how & why the data might change, so that
we can recognise these cases and know how to procede in our pipeline.

Here is a list of cases (W.I.P.):

- The ownership of a title changes in one of the company ownership datasets

  - Since a Title Number is unique to that property, we can assume that any polygons linked to that
    title are now owned by the new company.

- A title is removed from the company ownership datasets.

  - This indicates that the title has been sold to a private individual. If the title had linked
    polygon(s) which are unchanged, we can keep the link to the title number. There's a chance it
    will be sold to a company in the future, so more ownership info will be visible again.
  - _OR_ if it was a freehold, the lease may have been closed by a [merger](https://hmlandregistry.blog.gov.uk/2024/03/27/amalgamation-or-merger-whats-the-difference/) if the company also owns the freehold. We don't have
    enough info to tell if this happened, but may be able to use the [Registered Leases](https://use-land-property-data.service.gov.uk/datasets/leases/tech-spec) or [Price Paid Data](https://www.gov.uk/guidance/about-the-price-paid-data) datasets
    in the future to help with this.

- An INSPIRE polygon's boundary changes very slightly

  - This indicates that there has been a new survey by the local authority and any freehold title
    will still be linked to that property, so we can go ahead and alter the polygon's coordinates in our
    database.
  - Since INSPIRE doesn't include leasehold polygons, we should maybe also alter polygons linked
    to leaseholds within the same boundary, especially ones that cover exact the same area (**TODO**)

- An INSPIRE polygon's boundary moves a larger distance

  - This is unexpected, since usually a new INSPIRE ID would just be made. We should examine these
    instances manually (**TODO**). If the polygon has an associated company-owned title, we can geocode the title's
    address and check whether the new location matches.

- An INSPIRE polygon splits into two or more parts

  - When freehold titles are split, the owner will usually be selling off a portion of the property
    (otherwise it usually makes more sense for them to split into leaseholds). More info [here](https://lawdit.co.uk/readingroom/splitting-your-propertys-freehold-title) and [here](https://customerhelp.landregistry.gov.uk/forums/register-and-title-plan/f7bd9ec5-cc7c-ef11-a4e5-6045bdfc7a75). The portion that they keep will retain the old Title Number
    and the new segment of land will be assigned a new Title Number. So maybe when this happens, we
    can check for new company-owned titles with the same or adjacent address and link them (**TODO**).

- Two or more INSPIRE polygons merge

  - Freeholds can be [amalgamated](https://hmlandregistry.blog.gov.uk/2024/03/27/amalgamation-or-merger-whats-the-difference/) if they're owned by the same proprietor. Usually, the largest property's Title Number will be chosen for the new amalgamated title - see section 14.7.1 of [this guide](https://rosdev.atlassian.net/wiki/spaces/79RM/pages/76155396/L14+Amalgamation+and+Absorption+Guide). We can try to cross-reference with the company-owned titles data to see if this is the case. If the titles were company-owned, we'll hopefully see
    that all amalgamated titles apart from one are removed from the dataset, and that the old ones had the same proprietor (**TODO**).

## Stages of the pipeline

The main function that runs the pipeline is [`runPipeline()` in
run.ts](https://github.com/DigitalCommons/property-boundaries-service/blob/development/src/pipeline/run.ts){target="\_blank"}.

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
        new polys and try to classify a match. i.e. one of the scenarios in the [above section](#different-cases-of-data-changing).
        In some cases, the algorithm fails to classify the match, maybe because the polyon changed in an unexpected
        way. You can see descriptions of the match types implemented so far in [`match.ts`](https://github.com/DigitalCommons/property-boundaries-service/blob/development/src/pipeline/inspire/match.ts){target="\_blank"}.
      - If the poly_id is new, we check that it's not overlapping with an existing polygon in our DB. We have some
        rough 'amalgamation' detection code but haven't implemented it yet.

      _Note: The plan is to improve these algorithms over time, based on manual review of our pipeline's
      results and research of different scenarios (in the above section). So it will eventually identify
      and classify more scenarios, rather than just marking them as failed matches._

   1. Depending on how the match is classified, we mark pending polygons as 'accepted' or
      'rejected', and maybe mark existing polygons to be deleted.
   1. If the `updateBoundaries` pipeline option was set to true, write all accepted
      `pending_inspire_polygons` into `land_ownership_polygons` (overwriting existing geometry data)
      and delete all polygons listed in `pending_polygon_deletions`.

## How to run it

### Manually

The pipeline can be triggered by an API request like this:

```
https://<PBS URL>/run-pipeline?secret=<secret>
```

The pipeline can be started with additional options (see [`PipelineOptions` in
run.ts](https://github.com/DigitalCommons/property-boundaries-service/blob/development/src/pipeline/run.ts){target="\_blank"}
for details), e.g.:

```
https://<PBS URL>/run-pipeline?secret=<secret>&startAtTask=analyseInspire&maxCouncils=5
```

_Note: The new INSPIRE boundaries will remain in the `pending_inspire_polygons` table where they can be manually analysed (see below) and will not be written into the actual `land_ownership_polygons` table unless the `updateBoundaries` pipeline option is set to true._

### Automatic runs

At DCC, we have automatic scripts to hit the API described above, so that the pipeline runs automatically.

They are scheduled to run after a Borg backup of the production database has been completed, which
itself is scheduled to run on the 8th night of each month (to ensure it's after the month's INSPIRE
data has been published on the first Sunday of the month). To avoid getting into too many details that
are specific to DCC infrastructure, see [this GitHub issue](https://github.com/DigitalCommons/technology-and-infrastructure/issues/116#issuecomment-2163420776){target="\_blank"} for more details, and [deployment.md](./deployment.md#dcc-servers) for a rough overview of our DCC deployment.

## Analysing the pipeline output

After the `updateOwnerships` task is complete, the new data should be visible in LX for all users.

After the `downloadOwnerships` task, a LX super user can see the pending INSPIRE polygons that have been downloaded in a separate, secret data layer.

After the `analyseInspire` task has been run, the pending INSPIRE polygons will be marked 'accepted' if the matching algorithm thinks they are ready to be inserted into the main `land_ownership_polygons` DB table (either as a new row, or updating the geometry of an existing row if it has the same `poly_id`). If a pending polygon has been marked as 'accepted', this will be visible in the secret data layer on LX as a
green boundary. Non-accepted polys will appear as yellow.

Further detailed output for the pipeline can be found in the `analysis` folder in the project's root folder. This output can help you manually investigate something further e.g. if you want to investigate a failed match:

- find the details in `failed-matches.json` and copy a lng-lat of a vertex
- login to LX as a super user (to become a super user, update your record in MySQL on the server)
- enable the Pending Polygons data layer
- search for the lng-lat in the LX search bar, then click on the properties in view to find and the polygon(s) involved

Once you are satisfied that the `analyseInspire` task has marked the correct polygons as 'accepted', you can trigger the following API request to write them into the main DB table:

```
https://<PBS URL>/run-pipeline?secret=<secret>&resume=true&updateBoundaries=true
```
