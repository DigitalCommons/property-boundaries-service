// This type represents the columns from the land ownership datasets provided by the UK government.
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
  "Change Indicator"?: string; //Only exists on COU file raw data
  "Change Date"?: string; //Only exists on COU file raw data
};
