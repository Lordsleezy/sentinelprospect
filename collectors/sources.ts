import { SourceCollector } from "./SourceCollector";
import type { CollectorConfig } from "./types";

export const collectorConfigs: CollectorConfig[] = [
  {
    sourceName: "Sacramento County Public Records",
    sourceType: "County Permit and Planning Portal",
    baseUrl: "https://mapservices.gis.saccounty.gov/arcgis/rest/services/PLANNING_PROJECTS/MapServer",
    jurisdiction: "Sacramento County",
    enabled: true,
    notes: "Live PLANNING_PROJECTS MapServer powers planningdocuments.saccounty.net. Run npm run collect:planning.",
  },
  {
    sourceName: "Placer County Public Records",
    sourceType: "County Permit and Planning Portal",
    baseUrl: "https://services6.arcgis.com/PArfeTGcwA9RGNzN/arcgis/rest/services/All_Active_Planning_Projects/FeatureServer",
    jurisdiction: "Placer County",
    enabled: true,
    notes: "Live All_Active_Planning_Projects + Major Pre-Development layers. Run npm run collect:planning.",
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
