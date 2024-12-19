# Our servers

We have a dev, staging, and prod version of the PBS hosted on Hetzner servers dev-2, staging-2, and prod-2.

The apps are deployed to https://dev.propertyboundaries.landexplorer.coop/, https://staging.propertyboundaries.landexplorer.coop/, and https://propertyboundaries.landexplorer.coop/.

Generally, we deploy the `development` branch to dev-2, where we can test new features/fixes that are in development, and the `main` branch to staging-2 for QA... and then finally also to prod-2.

See more details in [this GitHub comment](https://github.com/DigitalCommons/technology-and-infrastructure/issues/116#issuecomment-2163420776).

# Deployment Instructions

## Requirements

- NodeJS
- MySQL
- [GDAL tools](https://gdal.org/download.html) (includes the `ogr2ogr` command line tool)
- PM2

## First install

1. Set up requirements on the remote machine you want to deply the PBS on. At DCC, we do this by running an Ansible playbook (see [technology-and-infrastructure](https://github.com/DigitalCommons/technology-and-infrastructure/tree/master))
2. Run the `install-remote.sh` script from your local machine to install the application on the desired remote user@hostname. e.g.:

```
bash install-remote.sh -u aubergine root@prod-2.digitalcommons.coop
```

_Note: that this will only succeed once you have uploaded its public SSH key to GitHub SSH (explained in the script's output)._

3. Log into the server and, in the codebase, copy `.env.example` to `.env`.
4. Fill in `.env` with the credentials and API keys (in BitWarden or the password-store).
5. `bash scripts/deploy.sh` to install dependencies, run the DB migration scripts, build and serve the app with PM2

## Subsequent updates

Checkout the code that you wish to deploy then `bash scripts/deploy.sh`.
