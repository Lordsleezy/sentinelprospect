import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const featureServiceUrl = "https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Permits/FeatureServer/0/query";
const sourceRecordUrl = "https://data.saccounty.gov/datasets/sacramentocounty::permits/explore";
const outputPath = resolve("data/sacramento-county-permits.json");

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? "true"];
}));

const minValuation = Number(args.get("min-valuation") ?? 50_000);
const recordLimit = Number(args.get("limit") ?? 50);
const since = args.get("since") ?? monthsAgo(12);

const params = new URLSearchParams({
  where: `APPLIED_DATE >= timestamp '${since} 00:00:00' AND Valuation >= ${minValuation}`,
  outFields: "*",
  orderByFields: "APPLIED_DATE DESC",
  resultRecordCount: String(recordLimit),
  outSR: "4326",
  f: "json",
});

const response = await fetch(`${featureServiceUrl}?${params.toString()}`);
if (!response.ok) throw new Error(`Sacramento County ArcGIS request failed: ${response.status}`);
const payload = await response.json();
if (payload.error) throw new Error(payload.error.message ?? "Sacramento County ArcGIS returned an error.");

const capturedAt = new Date().toISOString();
const records = (payload.features ?? []).map((feature) => {
  const attributes = feature.attributes ?? {};
  const application = text(attributes.Application, `OBJECTID-${attributes.OBJECTID}`);
  const sourceUrl = `${sourceRecordUrl}?filters=Application%3A${encodeURIComponent(application)}`;
  const normalized = normalizeRecord(attributes, feature.geometry ?? {}, sourceUrl, capturedAt);
  return {
    sourceId: `sac-county-permit-${application}`,
    sourceName: "Sacramento County Permits",
    sourceUrl,
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
  sourceName: "Sacramento County Permits",
  sourceType: "ArcGIS Feature Service",
  sourceUrl: featureServiceUrl,
  capturedAt,
  query: {
    since,
    minValuation,
    recordLimit,
  },
  records,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);

const opportunityCount = records.reduce((total, record) => total + record.normalized.inferredTrades.length, 0);
console.log(`Stored ${records.length} Sacramento County source records at ${outputPath}`);
console.log(`Generated ${records.length} permit signals and ${opportunityCount} inferred trade opportunities.`);

function normalizeRecord(attributes, geometry, sourceUrl, capturedAt) {
  const application = text(attributes.Application);
  const valuation = number(attributes.Valuation);
  const appliedDate = millisToDate(attributes.APPLIED_DATE) ?? capturedAt.slice(0, 10);
  const issuedDate = millisToDate(attributes.ISSUED_DATE);
  const finaledDate = millisToDate(attributes.FINALED_DATE);
  const status = inferProjectStatus(text(attributes.Application_Status), issuedDate, finaledDate);
  const projectType = inferProjectType(attributes);
  const signalType = inferSignalType(attributes, status);
  const inferredTrades = inferTrades(attributes);
  const revenueWindows = Object.fromEntries(inferredTrades.map((trade) => [trade, estimateRevenueWindow(valuation, trade)]));
  const description = buildDescription(attributes);

  return {
    project: {
      id: `sac-${application.toLowerCase()}`,
      external_id: application,
      name: text(attributes.ProjectName) || `${text(attributes.Application_Type, "Permit")} at ${text(attributes.Address, "Sacramento County")}`,
      description,
      project_type: projectType,
      status,
      city: inferCity(text(attributes.Address)),
      county: "Sacramento County",
      state: "CA",
      address: text(attributes.Address, "Sacramento County, CA"),
      latitude: number(geometry.y) ?? 38.5816,
      longitude: number(geometry.x) ?? -121.4944,
      estimated_units: inferUnits(attributes),
      estimated_value: valuation,
      source_url: sourceUrl,
      source_name: "Sacramento County Permits",
      created_at: capturedAt,
      updated_at: capturedAt,
    },
    permit: {
      id: `sac-permit-${application.toLowerCase()}`,
      permit_number: application,
      permit_type: text(attributes.Application_Type, "Permit"),
      permit_status: text(attributes.Application_Status, "Unknown"),
      permit_date: issuedDate ?? appliedDate,
      permit_value: valuation,
      source_url: sourceUrl,
      created_at: capturedAt,
    },
    signal: {
      id: `sac-signal-${application.toLowerCase()}`,
      signal_type: signalType,
      signal_date: issuedDate ?? appliedDate,
      description: `${signalType} from Sacramento County permit ${application}: ${description}`,
      source: "Sacramento County Permits",
      source_url: sourceUrl,
      external_id: application,
      parcel_number: text(attributes.Parcel_Number) || null,
      jurisdiction: "Sacramento County",
      importance_score: inferSignalImportance(attributes, signalType),
    },
    evidence: {
      id: `sac-evidence-${application.toLowerCase()}`,
      record_type: "source_record",
      record_id: application,
      source_name: "Sacramento County Permits",
      source_url: sourceUrl,
      title: `${application} ${text(attributes.Application_Type, "Permit")}`,
      summary: description,
      captured_at: capturedAt,
      confidence: 0.9,
      metadata: {
        source: "Sacramento County ArcGIS Permits FeatureServer",
        application,
        application_status: attributes.Application_Status,
        parcel_number: attributes.Parcel_Number,
        contractor: attributes.Contractor,
        inferred_trades: inferredTrades,
        revenue_windows: revenueWindows,
        raw: attributes,
      },
    },
    contactCompany: extractContactCompany(attributes),
    inferredTrades,
    revenueWindows,
  };
}

function inferTrades(attributes) {
  const blob = `${text(attributes.Application_Type)} ${text(attributes.Application_Subtype)} ${text(attributes.ProjectName)} ${text(attributes.ActivityCode)} ${text(attributes.WorkDescription)}`.toLowerCase();
  const trades = new Set();
  if (blob.includes("fence") || blob.includes("wall") || blob.includes("gate")) trades.add("Fencing");
  if (blob.includes("roof") || blob.includes("tpo")) trades.add("Roofing");
  if (blob.includes("hvac") || blob.includes("heat pump") || blob.includes("mechanical")) trades.add("HVAC");
  if (blob.includes("electrical") || blob.includes("solar") || blob.includes("pv") || blob.includes("battery")) trades.add("Electrical");
  if (blob.includes("concrete") || blob.includes("foundation") || blob.includes("slab")) trades.add("Concrete");
  if (blob.includes("grading") || blob.includes("site") || blob.includes("utility")) trades.add("Site work");
  if (blob.includes("production home") || blob.includes("single-family") || blob.includes("subdivision") || blob.includes("master plan")) trades.add("Fencing");
  if (!trades.size) trades.add("General");
  return [...trades];
}

function estimateRevenueWindow(valuation, trade) {
  const ranges = {
    Fencing: [0.015, 0.045],
    "Security fencing": [0.02, 0.06],
    Concrete: [0.04, 0.12],
    HVAC: [0.08, 0.18],
    Roofing: [0.12, 0.28],
    Electrical: [0.05, 0.16],
    Landscaping: [0.02, 0.08],
    "Site work": [0.05, 0.15],
    General: [0.02, 0.08],
  };
  if (!valuation || valuation <= 0) return { low: null, high: null };
  const [low, high] = ranges[trade] ?? ranges.General;
  return { low: Math.round(valuation * low), high: Math.round(valuation * high) };
}

function buildDescription(attributes) {
  return [text(attributes.ProjectName), text(attributes.WorkDescription), text(attributes.Application_Subtype)].filter(Boolean).join(" - ") || "Sacramento County permit record.";
}

function inferProjectStatus(applicationStatus, issuedDate, finaledDate) {
  const status = applicationStatus.toLowerCase();
  if (finaledDate || status.includes("complete") || status.includes("final")) return "Completed";
  if (issuedDate || status.includes("issued")) return "Permitted";
  if (status.includes("received") || status.includes("review") || status.includes("incomplete")) return "Planning";
  if (status.includes("approved")) return "Approved";
  return "Proposed";
}

function inferProjectType(attributes) {
  const blob = `${text(attributes.Application_Type)} ${text(attributes.Application_Subtype)} ${text(attributes.ProjectName)} ${text(attributes.WorkDescription)}`.toLowerCase();
  if (blob.includes("commercial") || blob.includes("tenant improvement")) return "Commercial";
  if (blob.includes("production home") || blob.includes("single family") || blob.includes("residential") || blob.includes("duplex")) return "Residential";
  if (blob.includes("warehouse") || blob.includes("industrial")) return "Industrial";
  if (blob.includes("utility") || blob.includes("road") || blob.includes("bridge")) return "Infrastructure";
  return text(attributes.Application_Type).toLowerCase().includes("commercial") ? "Commercial" : "Residential";
}

function inferSignalType(attributes, status) {
  const blob = `${text(attributes.Application_Type)} ${text(attributes.Application_Subtype)} ${text(attributes.ProjectName)} ${text(attributes.WorkDescription)}`.toLowerCase();
  if (status === "Permitted") return "Permit";
  if (blob.includes("production home") || blob.includes("subdivision") || blob.includes("master plan")) return "Subdivision Filing";
  if (blob.includes("utility") || blob.includes("solar") || blob.includes("pv") || blob.includes("battery")) return "Utility Expansion";
  return "Planning Application";
}

function inferSignalImportance(attributes, signalType) {
  let score = signalType === "Permit" ? 82 : signalType === "Subdivision Filing" ? 76 : 65;
  const valuation = number(attributes.Valuation) ?? 0;
  if (valuation >= 500_000) score += 10;
  if (valuation >= 100_000) score += 5;
  if (!text(attributes.Contractor) || text(attributes.Contractor).toLowerCase().includes("owner builder")) score += 6;
  return Math.min(100, score);
}

function inferUnits(attributes) {
  const description = `${text(attributes.ProjectName)} ${text(attributes.WorkDescription)}`;
  return /production home|single[ -]family|sfd/i.test(description) ? 1 : null;
}

function extractContactCompany(attributes) {
  const contractor = text(attributes.Contractor);
  if (!isSourceBackedCompanyName(contractor)) return null;
  return {
    id: `sac-company-${contractor.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: contractor,
    company_type: "Contractor",
    website: null,
    phone: null,
    email: null,
    city: inferCity(text(attributes.Address)),
    state: "CA",
    notes: `Contractor listed on Sacramento County permit ${text(attributes.Application)}.`,
    role: "contractor",
  };
}

function isSourceBackedCompanyName(name) {
  if (!name) return false;
  const blob = String(name).toLowerCase();
  return ![
    /example\.(com|gov|org)/i,
    /\b555[-\s]?\d{4}\b/i,
    /\b(to be determined|tbd|unknown|n\/a|none)\b/i,
    /select edit below/i,
    /enter name/i,
    /\b(owner builder|owner-builder)\b/i,
    /\b(contact|developer|project manager)\s+\d+\b/i,
    /\b\w+\s+(construction|development|builders|contractor|developer)\s+\d+\b/i,
  ].some((pattern) => pattern.test(blob));
}

function inferCity(address) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[1].replace(/\s+CA\s+\d+.*/, "").trim() || "Sacramento";
  return "Sacramento";
}

function millisToDate(value) {
  const parsed = number(value);
  if (!parsed) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function monthsAgo(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
