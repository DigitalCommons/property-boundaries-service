# Our servers

We have a dev, staging, and prod version of the PBS hosted on Hetzner servers dev-2, staging-2, and prod-2.

The apps are deployed to https://dev.propertyboundaries.landexplorer.coop/, https://staging.propertyboundaries.landexplorer.coop/, and https://propertyboundaries.landexplorer.coop/.

Generally, we deploy the `development` branch to dev-2, where we can test new features/fixes that are in development, and the `main` branch to staging-2 for QA... and then finally also to prod-2.

# Deployment Instructions

1. Have your public ssh key added to the server, and on the Hetzner console.
1. `ssh root@<hetzner-server-ip>`
1. `su -l <PBS app user>`
1. `cd property-boundaries-service`
1. `git status` to check we are in the correct branch (e.g. 'main' on production)
1. `bash scripts/deploy.sh`. This will pull the latest code, install dependencies, build/transpile the code, and run any outstanding DB migration scripts.
