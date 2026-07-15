import chunk from "lodash.chunk";
import { RawOwnership } from "../gov-api/land-ownership-datasets.types.js";
import { LandOwnershipSnapshotModel } from "./models.js";
import { logger } from "../pipeline/logger.js";

// Each CSV row can expand into up to 4 snapshot rows (one per proprietor slot), so we cap the size
// of each bulkCreate call to avoid hitting MySQL's max_allowed_packet limit on large chunks.
const MAX_ROWS_PER_INSERT = 20000;

type SnapshotData = {
  title_no: string;
  snapshot_date: Date;
  property_address: string | null;
  district: string | null;
  county: string | null;
  region: string | null;
  postcode: string | null;
  proprietor_name: string | null;
  company_registration_no: string | null;
};

/**
 * Batch create each land ownership snapshot record.
 */
export const bulkCreateLandOwnershipSnapshots = async (
  ownerships: RawOwnership[],
  snapshotDate: Date,
  overseas: boolean,
  logging = false,
) => {
  const proprietorColumns: (keyof RawOwnership)[] = [
    "Proprietor Name (1)",
    "Proprietor Name (2)",
    "Proprietor Name (3)",
    "Proprietor Name (4)",
  ];
  const companyColumns: (keyof RawOwnership)[] = [
    "Company Registration No. (1)",
    "Company Registration No. (2)",
    "Company Registration No. (3)",
    "Company Registration No. (4)",
  ];

  const parsedOwnerships = ownerships.map((ownership) => {
    const rows: SnapshotData[] = [];

    if (!ownership["Title Number"]) {
      logger.error("Row missing title number, skipping...");
      return rows;
    }

    for (let i = 0; i < proprietorColumns.length; i++) {
      const proprietorName = ownership[proprietorColumns[i]];
      const companyRegNo = ownership[companyColumns[i]];

      if (proprietorName || companyRegNo) {
        rows.push({
          title_no: ownership["Title Number"],
          snapshot_date: snapshotDate,
          property_address: ownership["Property Address"] || null,
          district: ownership.District || null,
          county: ownership.County || null,
          region: ownership.Region || null,
          postcode: ownership.Postcode || null,
          proprietor_name: proprietorName || null,
          company_registration_no: companyRegNo || null,
          //proprietor_uk_based: !overseas,
        });
      }
    }
    return rows;
  });

  const snapshotRowChunks = chunk(parsedOwnerships.flat(), MAX_ROWS_PER_INSERT);
  for (const snapshotRowChunk of snapshotRowChunks) {
    await LandOwnershipSnapshotModel.bulkCreate(snapshotRowChunk, {
      logging: logging ? console.log : false,
      benchmark: true,
      ignoreDuplicates: true,
    });
  }
};
