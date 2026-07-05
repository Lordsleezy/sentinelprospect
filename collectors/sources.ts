import { SourceCollector } from "./SourceCollector";
import type { CollectorConfig } from "./types";

export const collectorConfigs: CollectorConfig[] = [
  {
    sourceName: "Sacramento County Public Records",
    sourceType: "County Permit and Planning Portal",
    baseUrl: "https://actonline.saccounty.gov",
    jurisdiction: "Sacramento County",
    enabled: false,
    notes: "Target permits, parcel activity, planning applications, CEQA notices, and county project records.",
  },
  {
    sourceName: "Placer County Public Records",
    sourceType: "County Permit and Planning Portal",
    baseUrl: "https://aca-prod.accela.com/PLACER",
    jurisdiction: "Placer County",
    enabled: false,
    notes: "Target permits, subdivision activity, planning records, parcel splits, and utility-related signals.",
  },
  {
    sourceName: "Roseville Development Services",
    sourceType: "City Permit and Planning Portal",
    baseUrl: "https://permitsonline.roseville.ca.us",
    jurisdiction: "Roseville",
    enabled: false,
    notes: "Target building permits, planning entitlements, design review, subdivision, and infrastructure records.",
  },
  {
    sourceName: "Rocklin Community Development",
    sourceType: "City Permit and Planning Portal",
    baseUrl: "https://www.rocklin.ca.us/community-development",
    jurisdiction: "Rocklin",
    enabled: false,
    notes: "Target planning agendas, development applications, permits, and public works project references.",
  },
  {
    sourceName: "Folsom Community Development",
    sourceType: "City Permit and Planning Portal",
    baseUrl: "https://www.folsom.ca.us/government/community-development",
    jurisdiction: "Folsom",
    enabled: false,
    notes: "Target planning applications, permits, CEQA documents, capital projects, and subdivision records.",
  },
  {
    sourceName: "Elk Grove Development Services",
    sourceType: "City Permit and Planning Portal",
    baseUrl: "https://www.elkgrovecity.org/city_hall/departments_divisions/development_services",
    jurisdiction: "Elk Grove",
    enabled: false,
    notes: "Target permits, planning commission packets, development applications, CEQA, and developer activity.",
  },
  {
    sourceName: "SAM.gov Contract Opportunities",
    sourceType: "Federal Bid Portal",
    baseUrl: "https://sam.gov/content/opportunities",
    jurisdiction: "Federal",
    enabled: false,
    notes: "Target active bid opportunities and award notices relevant to fencing, site work, construction, and public facilities.",
  },
];

export function createCollectors() {
  return collectorConfigs.map((config) => new SourceCollector(config));
}
