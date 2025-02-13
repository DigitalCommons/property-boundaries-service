# TODO (roughly in priority order)

_Remove items from this file once a GitHub issues are created for them._

- Fully spec the desired behaviour of the pipeline, in particular the matching algorithm for INSPIRE
  polygons, and add unit tests to match this spec

  - Mocha is set up for this. I made a methods.test.ts file, using GitHub Copilot, inspired by the [Land Explorer backend](https://github.com/DigitalCommons/land-explorer-front-end/wiki/Automated-Testing#unit-tests), with UTs for the currently
    implemented matching algorithm.
  - We'll probably need to eventually modularise some of the long functions in the pipeline (e.g. the `comparePolygons` function) to make unit testing easier, and this will make the code more understandable too.
  - Maybe we need to plot some different polygon scenarios that can be visualised and used for different test cases in UTs.

- Once we have the above spec, systematically address parts of the pipeline that we want to improve. This will involve:

  1. manually looking at the most common failed matches
  1. adding to the research of cases in [pipeline.md](./pipeline.md#different-cases-of-data-changing) and identifying gaps in our algorithm
  1. stepping back to think about who will be using the app and which matches are most valuable for us to prioritise in order to preserve
     as much useful data as we can. Think about whether we need any other data sources to achieve this

- Add analytics and do profiling to find where the bottlenecks are in analysis script, so they can be optimised. For each council, the script currently takes about 5 mins to download and transform the data and 5 mins to do a simply analysis of all the polygons (skipping more complicated analysis of segmentations/merges). Tasks could maybe be parallelised using worker threads (see https://nodejs.org/api/worker_threads.html). Also decide which bits of the algorithm are most needed and remove some computation that isn't necessary. And allow pipelines to resume automatically if something goes wrong e.g. the server reboots, which is fairly likely since the pipeline is going to take a long time even if we optimise it really well (it's processing a huge amount of data!). We could maybe use Glitchtip (which we use for MM) for error and performamce tracking.

- Improve how the results of the analysis can be understood/visualised. It's currently a lot of data, and it's hard to know which matches to check individually.

- Enable strict Typescript checking in tsconfig.json and fixup existing checking failures. Use more modern Sequelize definitions so that we get types https://sequelize.org/docs/v7/models/defining-models/

- Address the various 'TODO' comments around the codebase
