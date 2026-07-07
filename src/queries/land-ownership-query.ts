import { LandOwnershipModel } from "./models.js";

export type RawOwnership = {
  "Title Number": string;
  Tenure: string;
  "Property Address"?: string;
  District?: string;
  County?: string;
  Region?: string;
  Postcode?: string;
  "Multiple Address Indicator"?: string;
  "Price Paid"?: string;
  "Proprietor Name (1)"?: string;
  "Company Registration No. (1)"?: string;
  "Proprietorship Category (1)"?: string;
  "Proprietor (1) Address (1)"?: string;
  "Proprietor (1) Address (2)"?: string;
  "Proprietor (1) Address (3)"?: string;
  "Proprietor Name (2)"?: string;
  "Company Registration No. (2)"?: string;
  "Proprietorship Category (2)"?: string;
  "Proprietor (2) Address (1)"?: string;
  "Proprietor (2) Address (2)"?: string;
  "Proprietor (2) Address (3)"?: string;
  "Proprietor Name (3)"?: string;
  "Company Registration No. (3)"?: string;
  "Proprietorship Category (3)"?: string;
  "Proprietor (3) Address (1)"?: string;
  "Proprietor (3) Address (2)"?: string;
  "Proprietor (3) Address (3)"?: string;
  "Proprietor Name (4)"?: string;
  "Company Registration No. (4)"?: string;
  "Proprietorship Category (4)"?: string;
  "Proprietor (4) Address (1)"?: string;
  "Proprietor (4) Address (2)"?: string;
  "Proprietor (4) Address (3)"?: string;
  "Date Proprietor Added"?: string;
  "Additional Proprietor Indicator"?: string;
  "Change Indicator"?: string;
};

/**
 * Create or update a land ownership record.
 * @param ownership ownership object with the same keys as provided by the gov,
 * documented here: https://use-land-property-data.service.gov.uk/datasets/ccod/tech-spec (note that
 * some bad records don't match this spec though)
 * @param overseas boolean flag to denote whether the land record is overseas
 * @param logging whether to log out the SQL queries to the console
 */
export const createOrUpdateLandOwnership = async (
  ownership: RawOwnership,
  overseas: boolean,
  logging = false,
) => {
  await bulkCreateOrUpdateLandOwnerships([ownership], overseas, logging);
};

/**
 * Create each land ownership record if the title number doesn't already exist. If the title number
 * already exists, update the existing record with the new values.
 *
 * @param ownerships array of ownership objects with the same keys as provided by the gov,
 * documented here: https://use-land-property-data.service.gov.uk/datasets/ccod/tech-spec (note that
 * some bad records don't match this spec though)
 */
export const bulkCreateOrUpdateLandOwnerships = async (
  ownerships: RawOwnership[],
  overseas: boolean,
  logging = false,
) => {
  const parsedOwnerships = ownerships.map((ownership) => ({
    title_no: ownership["Title Number"],
    tenure: ownership.Tenure,
    property_address: ownership["Property Address"] || null,
    district: ownership.District || null,
    county: ownership.County || null,
    region: ownership.Region || null,
    postcode: ownership.Postcode || null,
    multiple_address_indicator: ownership["Multiple Address Indicator"] || null,
    price_paid: ownership["Price Paid"] || null,
    proprietor_name_1: ownership["Proprietor Name (1)"] || null,
    company_registration_no_1:
      ownership["Company Registration No. (1)"] || null,
    proprietor_category_1: ownership["Proprietorship Category (1)"] || null,
    proprietor_1_address_1: ownership["Proprietor (1) Address (1)"] || null,
    proprietor_1_address_2: ownership["Proprietor (1) Address (2)"] || null,
    proprietor_1_address_3: ownership["Proprietor (1) Address (3)"] || null,
    proprietor_name_2: ownership["Proprietor Name (2)"] || null,
    company_registration_no_2:
      ownership["Company Registration No. (2)"] || null,
    proprietor_category_2: ownership["Proprietorship Category (2)"] || null,
    proprietor_2_address_1: ownership["Proprietor (2) Address (1)"] || null,
    proprietor_2_address_2: ownership["Proprietor (2) Address (2)"] || null,
    proprietor_2_address_3: ownership["Proprietor (2) Address (3)"] || null,
    proprietor_name_3: ownership["Proprietor Name (3)"] || null,
    company_registration_no_3:
      ownership["Company Registration No. (3)"] || null,
    proprietor_category_3: ownership["Proprietorship Category (3)"] || null,
    proprietor_3_address_1: ownership["Proprietor (3) Address (1)"] || null,
    proprietor_3_address_2: ownership["Proprietor (3) Address (2)"] || null,
    proprietor_3_address_3: ownership["Proprietor (3) Address (3)"] || null,
    proprietor_name_4: ownership["Proprietor Name (4)"] || null,
    company_registration_no_4:
      ownership["Company Registration No. (4)"] || null,
    proprietor_category_4: ownership["Proprietorship Category (4)"] || null,
    proprietor_4_address_1: ownership["Proprietor (4) Address (1)"] || null,
    proprietor_4_address_2: ownership["Proprietor (4) Address (2)"] || null,
    proprietor_4_address_3: ownership["Proprietor (4) Address (3)"] || null,
    date_proprietor_added:
      // convert DD-MM-YYYY to YYYY-MM-DD
      ownership["Date Proprietor Added"]?.split("-").reverse().join("-") ||
      null,
    additional_proprietor_indicator:
      ownership["Additional Proprietor Indicator"] || null,
    proprietor_uk_based: !overseas,
  }));

  await LandOwnershipModel.bulkCreate(parsedOwnerships, {
    logging: logging ? console.log : false,
    benchmark: true,
    updateOnDuplicate: [
      "tenure",
      "property_address",
      "district",
      "county",
      "region",
      "postcode",
      "multiple_address_indicator",
      "price_paid",
      "proprietor_name_1",
      "company_registration_no_1",
      "proprietor_category_1",
      "proprietor_1_address_1",
      "proprietor_1_address_2",
      "proprietor_1_address_3",
      "proprietor_name_2",
      "company_registration_no_2",
      "proprietor_category_2",
      "proprietor_2_address_1",
      "proprietor_2_address_2",
      "proprietor_2_address_3",
      "proprietor_name_3",
      "company_registration_no_3",
      "proprietor_category_3",
      "proprietor_3_address_1",
      "proprietor_3_address_2",
      "proprietor_3_address_3",
      "proprietor_name_4",
      "company_registration_no_4",
      "proprietor_category_4",
      "proprietor_4_address_1",
      "proprietor_4_address_2",
      "proprietor_4_address_3",
      "date_proprietor_added",
      "additional_proprietor_indicator",
      "proprietor_uk_based",
    ],
  });
};

/**
 * Bulk delete land ownership records for the given title numbers. This is used when processing
 * ownership change files, where we delete the old records for a title number before adding the new
 * records.
 * @param titleNumbers title numbers to delete the land ownership records for
 * @param logging whether to log out the SQL queries to the console
 */
export const bulkDeleteLandOwnerships = async (
  titleNumbers: string[],
  logging = false,
) => {
  await LandOwnershipModel.destroy({
    logging: logging ? console.log : false,
    where: {
      title_no: titleNumbers,
    },
  });
};

/**
 * Delete all land ownership records. This is used when processing the full ownership data files, where
 * we delete all existing records before adding the new records.
 */
export const deleteAllLandOwnerships = async () => {
  await LandOwnershipModel.truncate();
};

/**
 * Retrieve a land ownership record by its title number.
 * @param title_no the title number of the land ownership record to retrieve
 * @returns the land ownership record, or null if not found
 */
export async function getLandOwnership(title_no: string) {
  const landOwnership = await LandOwnershipModel.findOne({
    where: {
      title_no: title_no,
    },
    raw: true,
  });

  return landOwnership;
}
