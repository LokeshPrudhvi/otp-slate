import { NotFoundException } from "@nestjs/common";
import { fileURLToPath } from "node:url";
export const sampleCompanies = [
  "northstar-tech",
  "apex-digital",
  "meridian-systems",
  "vertex-labs",
];
const companyModelPapers = [
  "tcs",
  "infosys",
  "wipro",
  "hcl",
  "relianceindustrieslimited",
  "airtel",
  "swiggy",
  "zomato",
  "razorpay",
  "zerodha",
  "meta",
  "amazon",
  "netflix",
  "google",
];
export function isPlacementSampleUrl(value: string) {
  return (
    companyModelPapers.some(
      (name) => value === `/api/v1/placement-samples/${name}-model-paper.pdf`,
    ) ||
    sampleCompanies.some(
      (name) =>
        value === `/api/v1/placement-samples/${name}.svg` ||
        value === `/api/v1/placement-samples/${name}-model-paper.pdf`,
    )
  );
}
export function placementSamplePath(file: string) {
  if (!isPlacementSampleUrl(`/api/v1/placement-samples/${file}`))
    throw new NotFoundException("Sample resource not found.");
  return fileURLToPath(new URL(`../assets/pyq/${file}`, import.meta.url));
}
