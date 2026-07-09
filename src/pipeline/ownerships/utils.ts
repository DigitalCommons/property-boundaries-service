export const convertDateToYYYYMMDD = (date: string): string => {
  return date.split("-").reverse().join("-");
};
