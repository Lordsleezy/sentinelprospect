import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const featureServiceUrl = "https://services6.arcgis.com/PArfeTGcwA9RGNzN/arcgis/rest/services/ActiveBuildingPermits/FeatureServer/0/query";
const sourceRecordUrl = "https://gis-placercounty.opendata.arcgis.com/maps/7a3b4d080af04cdaa9f2c41b7ae0f55a";
const outputPath = resolve("data/placer-county-records.json");

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? "true"];
}));
const recordLimit = Number(args.get("limit") ?? 75);

const params = new URLSearchParams({
  where: "1=1",
  outFields: "*",
  orderByFields: "OBJECTID DESC",
  resultRecordCount: String(recordLimit),
  outSR: "4326",
  f: "json",
});

const response = await fetch(`${featureServiceUrl}?${params.toString()}`);
if (!response.ok) throw new Error(`Placer County ArcGIS request failed: ${response.status}`);
const payload = await response.json();
if (payload.error) throw new Error(payload.error.message ?? "Placer County ArcGIS returned an error.");

const capturedAt = new Date().toISOString();
const records = (payload.features ?? []).map((feature) => {
  const attributes = feature.attributes ?? {};
  const application = text(attributes.ActiveBuilding_ExcelToTable_B1_, `OBJECTID-${attributes.OBJECTID}`);
  const normalized = normalizeRecord(attributes, feature.geometry ?? {}, capturedAt);
  return {
    sourceId: `placer-active-permit-${application}-${attributes.OBJECTID}`,
    sourceName: "Placer County Active Building Permits",
    sourceUrl: sourceRecordUrl,
    capturedAt,
    payload: {
      ...attributes,
      longitude: feature.geometry?.x ?? null,
      latitude: feature.geometry?.y ?? null,
    },
    normalized,
  };
});

const artifact = {
  sourceName: "Placer County Active Building Permits",
  sourceType: "ArcGIS Feature Service",
  sourceUrl: featureServiceUrl,
  capturedAt,
  query: { recordLimit },
  sourceNotes: [
    "Uses Placer County public ArcGIS Active Building Permits layer.",
    "Placer County planning documents and Citizen Access are public references, but this runner only ingests the queryable active permits layer.",
  ],
  records,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Stored ${records.length} Placer County source records at ${outputPath}`);
console.log(`Generated ${records.length} signals and ${records.reduce((total, record) => total + record.normalized.inferredTrades.length, 0)} inferred trade opportunities.`);

function normalizeRecord(attributes, geometry, capturedAt) {
  const application = text(attributes.ActiveBuilding_ExcelToTable_B1_);
  const status = inferStatus(text(attributes.ActiveBuilding_ExcelToTable_Sta));
  const inferredTrades = inferTrades(attributes);
  const description = buildDescription(attributes);
  const projectId = `placer-${application.toLowerCase()}-${attributes.OBJECTID}`;
  return {
    project: {
      id: projectId,
      external_id: `${application}-${attributes.OBJECTID}`,
      name: text(attributes.ActiveBuilding_ExcelToTable_Pro) || `${text(attributes.ActiveBuilding_ExcelToTable_Sco, "Permit")} at ${text(attributes.ActiveBuilding_ExcelToTable_Add, "Placer County")}`,
      description,
      project_type: inferProjectType(attributes),
      status,
      city: inferCity(attributes),
      county: "Placer County",
      state: "CA",
      address: text(attributes.ActiveBuilding_ExcelToTable_Add, "Placer County, CA"),
      latitude: number(geometry.y) ?? 38.8966,
      longitude: number(geometry.x) ?? -121.0769,
      estimated_units: null,
      estimated_value: null,
      source_url: sourceRecordUrl,
      source_name: "Placer County Active Building Permits",
      created_at: capturedAt,
      updated_at: capturedAt,
    },
    permit: {
      id: `placer-permit-${application.toLowerCase()}-${attributes.OBJECTID}`,
      permit_number: application,
      permit_type: text(attributes.ActiveBuilding_ExcelToTable_Sco, "Building Permit"),
      permit_status: text(attributes.ActiveBuilding_ExcelToTable_Sta, "Active"),
      permit_date: capturedAt.slice(0, 10),
      permit_value: null,
      source_url: sourceRecordUrl,
      created_at: capturedAt,
    },
    signal: {
      id: `placer-signal-${application.toLowerCase()}-${attributes.OBJECTID}`,
      signal_type: inferSignalType(attributes, status),
      signal_date: capturedAt.slice(0, 10),
      description: `Placer County active permit ${application}: ${description}`,
      source: "Placer County Active Building Permits",
      source_url: sourceRecordUrl,
      external_id: application,
      parcel_number: text(attributes.ActiveBuilding_ExcelToTable_APN) || text(attributes.ASSESSORS_Parcel_point_APN) || null,
      jurisdiction: text(attributes.ASSESSORS_Parcel_point_JURISDIC, "Placer County"),
      importance_score: inferImportance(attributes, status),
    },
    evidence: {
      id: `placer-evidence-${application.toLowerCase()}-${attributes.OBJECTID}`,
      record_type: "source_record",
      record_id: application,
      source_name: "Placer County Active Building Permits",
      source_url: sourceRecordUrl,
      title: `${application} ${text(attributes.ActiveBuilding_ExcelToTable_Sco, "Building Permit")}`,
      summary: description,
      captured_at: capturedAt,
      confidence: 0.82,
      metadata: {
        source: "Placer County Active Building Permits ArcGIS FeatureServer",
        application,
        application_status: attributes.ActiveBuilding_ExcelToTable_Sta,
        parcel_number: attributes.ActiveBuilding_ExcelToTable_APN,
        jurisdiction: attributes.ASSESSORS_Parcel_point_JURISDIC,
        inferred_trades: inferredTrades,
        revenue_windows: {},
        raw: attributes,
      },
    },
    contactCompany: null,
    inferredTrades,
    revenueWindows: {},
  };
}

function inferTrades(attributes) {
  const blob = `${text(attributes.ActiveBuilding_ExcelToTable_Sco)} ${text(attributes.ActiveBuilding_ExcelToTable_Pro)} ${text(attributes.ActiveBuilding_ExcelToTable_Des)}`.toLowerCase();
  const trades = new Set();
  if (hasStrongFenceSignal(blob)) trades.add("Fencing");
  if (/\b(roof|roofs|roofing|reroof)\b/i.test(blob)) trades.add("Roofing");
  if (/\b(hvac|mechanical|mech\b|heat\s*pump)\b/i.test(blob)) trades.add("HVAC");
  if (/\b(electric|electrical|solar|battery|landscape\s+lighting|service\s+pedestal)\b/i.test(blob)) trades.add("Electrical");
  if (/\b(concrete|foundation|footing|stemwall|slab|flatwork)\b/i.test(blob)) trades.add("Concrete");
  if (/\b(paint|painting)\b/i.test(blob)) trades.add("Painting");
  if (/\b(carpenter|carpentry|framing|cabinets?)\b/i.test(blob)) trades.add("Carpentry");
  if (/\b(landscape|landscaping|irrigation)\b/i.test(blob)) trades.add("Landscaping");
  if (/\b(sewer|grading|site\s*work|utility|utilities)\b/i.test(blob)) trades.add("Site work");
  // Do not infer Fencing from residential/townhome alone — that created false positives.
  if (!trades.size) trades.add("General");
  return [...trades];
}

function hasStrongFenceSignal(blob) {
  if (/\b(fence|fencing|chain[-\s]?link|ornamental\s+iron|fence\s+height|pool\s+safety\s+fencing|fencing\s+with\s+gate|gates?\/fence|security\s+fence)\b/i.test(blob)) {
    return true;
  }
  if (/\b(new\s*\(?gates?\)?|install(?:ation)?\s+of\s+.{0,40}\bgates?\b|building\s+a\s+.{0,30}\bgate\b|slid(?:e|ing)\s+gates?|automat(?:ic|ed)\s+(?:slide\s+)?gates?|steel\s+gate|security\s+gate|vehicle\s+gate|pedestrian\s+gate|ada\s+ped|ped\s+gates?)\b/i.test(blob)) {
    return true;
  }
  return false;
}

function inferStatus(status) {
  const normalized = status.toLowerCase();
  if (normalized.includes("issued")) return "Permitted";
  if (normalized.includes("review")) return "Planning";
  if (normalized.includes("approved")) return "Approved";
  if (normalized.includes("complete") || normalized.includes("final")) return "Completed";
  return "Proposed";
}

function inferProjectType(attributes) {
  const blob = `${text(attributes.ActiveBuilding_ExcelToTable_Sco)} ${text(attributes.ActiveBuilding_ExcelToTable_Pro)} ${text(attributes.ActiveBuilding_ExcelToTable_Des)}`.toLowerCase();
  if (blob.includes("commercial") || blob.includes("wireless")) return "Commercial";
  if (blob.includes("townhome") || blob.includes("residential")) return "Residential";
  if (blob.includes("sewer") || blob.includes("utility")) return "Infrastructure";
  return "Commercial";
}

function inferSignalType(attributes, status) {
  if (status === "Permitted") return "Permit";
  const blob = `${text(attributes.ActiveBuilding_ExcelToTable_Sco)} ${text(attributes.ActiveBuilding_ExcelToTable_Des)}`.toLowerCase();
  if (blob.includes("sewer") || blob.includes("utility")) return "Utility Expansion";
  return "Planning Application";
}

function inferImportance(attributes, status) {
  let score = status === "Permitted" ? 80 : 66;
  if (text(attributes.ActiveBuilding_ExcelToTable_APN)) score += 5;
  if (text(attributes.ActiveBuilding_ExcelToTable_Des).length > 80) score += 4;
  return Math.min(100, score);
}

function buildDescription(attributes) {
  return [text(attributes.ActiveBuilding_ExcelToTable_Pro), text(attributes.ActiveBuilding_ExcelToTable_Des), text(attributes.ActiveBuilding_ExcelToTable_Sco)].filter(Boolean).join(" - ") || "Placer County active building permit.";
}

function inferCity(attributes) {
  const jurisdiction = text(attributes.ASSESSORS_Parcel_point_JURISDIC);
  if (jurisdiction && jurisdiction !== "Placer County") return jurisdiction.replace(/^City of\s+/i, "");
  const address = text(attributes.ActiveBuilding_ExcelToTable_Add).toLowerCase();
  if (address.includes("northstar")) return "Truckee";
  return "Placer County";
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
