# TODO (roughly in priority order)

_Remove item from this file once a GitHub issue is created for it._

- Step back and think about what we want the pipeline to achieve, and what info we want to try to save as boundaries gradually change. Prioritise and try to narrow the scope. And think about whether we need any other data sources to achieve this. The output of this task should go into a `pipeline.md` doc.

- What do we do about leaseholds? INSPIRE only has data for freeholds, so we have no way of updating leaseholds that don't share the same boundary as a freehold INSPIRE polygon. Does this ever happen? We need to investigate.

- Add analytics and do profiling to find where the bottlenecks are in analysis script, so they can be optimised. For each council, the script currently takes about 5 mins to download and transform the data and 5 mins to do a simply analysis of all the polygons (skipping more complicated analysis of segmentations/merges). Tasks could maybe be parallelised using worker threads (see https://nodejs.org/api/worker_threads.html). Also decide which bits of the algorithm are most needed and remove some computation that isn't necessary. And allow pipelines to resume automatically if something goes wrong e.g. the server reboots, which is fairly likely since the pipeline is going to take a long time even if we optimise it really well (it's processing a huge amount of data!). We could maybe use Glitchtip (which we use for MM) for error and performamce tracking.

- Fully spec the behaviour of the pipeline, in particular the matching algorithm for INSPIRE
  polygons, then add unit tests to match this spec

  - Mocha is set up for this. I made a methods.test.ts file, using GitHub Copilot, inspired by the [Land Explorer backend](https://github.com/DigitalCommons/land-explorer-front-end/wiki/Testing#unit-tests)
  - Add these tests to a Github CI pipeline, like on LX backend
  - We'll need to modularise some of the long functions in the pipeline a bit more (e.g. the `comparePolygons` function) to make unit testing easier
  - Maybe we need to plot some different polygon scenarios that can be visualised and used for different edge cases.

- Address the various 'TODO' comments around the codebase

- Add some docs to `/docs` to give a high-level overview of what the pipeline is doing. But wherever possible,
  especially for low-level details, prefer Mocha specs over written
  documentation. Docs can be ignored but specs with unit tests can't.

- Improve how the results of the analysis can be understood/visualised. It's currently a lot of data, and it's hard to know which matches to check individually.

- Enable strict Typescript checking in tsconfig.json and fixup existing checking failures. Use more modern Sequelize definitions so that we get types https://sequelize.org/docs/v7/models/defining-models/
