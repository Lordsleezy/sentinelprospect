import { BaseCollector } from "./BaseCollector";
import type { NormalizedProjectRecord, RawSourceRecord } from "./types";
import type { EvidenceRecord, OpportunityTrade, ProjectStatus, ProjectType, SignalType } from "../src/lib/types";

type ArcGisFeature = {
  attributes: Record<string, unknown>;
  geometry?: { x?: number; y?: number };
};

const FEATURE_SERVICE_URL = "https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Permits/FeatureServer/0/query";
const SOURCE_RECORD_URL = "https://data.saccounty.gov/datasets/sacramentocounty::permits/explore";

export class SacramentoCountyPermitCollector extends BaseCollector {
  readonly sourceName = "Sacramento County Permits";
  readonly sourceType = "ArcGIS Feature Service";
  readonly baseUrl = "https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Permits/FeatureServer";

  constructor(private readonly options: { minValuation?: number; recordLimit?: number } = {}) {
    super();
  }

  async collect(): Promise<RawSourceRecord[]> {
    const minValuation = this.options.minValuation ?? 50_000;
    const recordLimit = this.options.recordLimit ?? 50;
    const since = new Date();
    since.setMonth(since.getMonth() - 12);

    const params = new URLSearchParams({
      where: `APPLIED_DATE >= timestamp '${since.toISOString().slice(0, 10)} 00:00:00' AND Valuation >= ${minValuation}`,
      outFields: "*",
      orderByFields: "APPLIED_DATE DESC",
      resultRecordCount: String(recordLimit),
      outSR: "4326",
      f: "json",
    });

    const response = await fetch(`${FEATURE_SERVICE_URL}?${params.toString()}`);
    if (!response.ok) throw new Error(`Sacramento County ArcGIS request failed: ${response.status}`);
    const payload = await response.json() as { features?: ArcGisFeature[]; error?: { message?: string } };
    if (payload.error) throw new Error(payload.error.message ?? "Sacramento County ArcGIS returned an error.");

    const capturedAt = new Date().toISOString();
    return (payload.features ?? []).map((feature) => {
      const application = text(feature.attributes.Application, `OBJECTID-${feature.attributes.OBJECTID}`);
      return {
        sourceId: `sac-county-permit-${application}`,
        sourceName: this.sourceName,
        sourceUrl: `${SOURCE_RECORD_URL}?filters=Application%3A${encodeURIComponent(application)}`,
        capturedAt,
        payload: {
          ...feature.attributes,
          longitude: feature.geometry?.x ?? null,
          latitude: feature.geometry?.y ?? null,
        },
      };
    });
  }

  normalize(record: RawSourceRecord): NormalizedProjectRecord | null {
    const payload = record.payload;
    const application = text(payload.Application);
    if (!application) return null;

    const valuation = number(payload.Valuation);
    const appliedDate = millisToDate(payload.APPLIED_DATE) ?? record.capturedAt.slice(0, 10);
    const issuedDate = millisToDate(payload.ISSUED_DATE);
    const finaledDate = millisToDate(payload.FINALED_DATE);
    const status = inferProjectStatus(text(payload.Application_Status), issuedDate, finaledDate);
    const projectType = inferProjectType(payload);
    const name = text(payload.ProjectName) || `${text(payload.Application_Type, "Permit")} at ${text(payload.Address, "Sacramento County")}`;
    const description = buildDescription(payload);
    const signalType = inferSignalType(payload, status);
    const trade = inferTrade(payload);
    const sourceEvidence = sourceRecordEvidence(record, trade);
    const contactCompany = extractContactCompany(payload);

    return {
      project: {
        external_id: application,
        name,
        description,
        project_type: projectType,
        status,
        city: inferCity(text(payload.Address)),
        county: "Sacramento County",
        state: "CA",
        address: text(payload.Address, "Sacramento County, CA"),
        latitude: number(payload.latitude) ?? 38.5816,
        longitude: number(payload.longitude) ?? -121.4944,
        estimated_units: inferUnits(payload),
        estimated_value: valuation,
        source_url: record.sourceUrl,
        source_name: this.sourceName,
      },
      permits: [{
        permit_number: application,
        permit_type: text(payload.Application_Type, "Permit"),
        permit_status: text(payload.Application_Status, "Unknown"),
        permit_date: issuedDate ?? appliedDate,
        permit_value: valuation,
        source_url: record.sourceUrl,
      }],
      companies: contactCompany ? [contactCompany] : [],
      documents: [{
        title: `${application} Sacramento County permit source record`,
        document_type: "Permit source record",
        source_url: record.sourceUrl,
        summary: description,
      }],
      signals: [{
        project_external_id: application,
        signal_type: signalType,
        signal_date: issuedDate ?? appliedDate,
        description: `${signalType} from Sacramento County permit ${application}: ${description}`,
        source: this.sourceName,
        source_url: record.sourceUrl,
        external_id: application,
        parcel_number: text(payload.Parcel_Number) || null,
        jurisdiction: "Sacramento County",
        importance_score: inferSignalImportance(payload, signalType),
      }],
      evidence: [sourceEvidence],
    };
  }
}

export function inferTrade(payload: Record<string, unknown>): OpportunityTrade {
  const textBlob = `${text(payload.Application_Type)} ${text(payload.Application_Subtype)} ${text(payload.ProjectName)} ${text(payload.ActivityCode)} ${text(payload.WorkDescription)}`.toLowerCase();
  if (textBlob.includes("fence") || textBlob.includes("wall") || textBlob.includes("gate")) return "Fencing";
  if (textBlob.includes("roof") || textBlob.includes("tpo")) return "Roofing";
  if (textBlob.includes("hvac") || textBlob.includes("heat pump") || textBlob.includes("mechanical")) return "HVAC";
  if (textBlob.includes("electrical") || textBlob.includes("solar") || textBlob.includes("pv") || textBlob.includes("battery")) return "Electrical";
  if (textBlob.includes("concrete") || textBlob.includes("foundation") || textBlob.includes("slab")) return "Concrete";
  if (textBlob.includes("grading") || textBlob.includes("site") || textBlob.includes("utility")) return "Site work";
  if (textBlob.includes("production home") || textBlob.includes("single-family") || textBlob.includes("subdivision")) return "Fencing";
  return "General";
}

export function estimateRevenueWindow(valuation: number | null, trade: OpportunityTrade) {
  const percentByTrade: Record<OpportunityTrade, [number, number]> = {
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
  const [low, high] = percentByTrade[trade];
  return {
    low: Math.round(valuation * low),
    high: Math.round(valuation * high),
  };
}

function sourceRecordEvidence(record: RawSourceRecord, trade: OpportunityTrade): Omit<EvidenceRecord, "id"> {
  const valuation = number(record.payload.Valuation);
  const revenue = estimateRevenueWindow(valuation, trade);
  return {
    record_type: "source_record",
    record_id: text(record.payload.Application, record.sourceId),
    source_name: record.sourceName,
    source_url: record.sourceUrl,
    title: `${text(record.payload.Application, "Permit")} ${text(record.payload.Application_Type, "Permit")}`,
    summary: buildDescription(record.payload),
    captured_at: record.capturedAt,
    confidence: 0.9,
    metadata: {
      source: "Sacramento County ArcGIS Permits FeatureServer",
      application: record.payload.Application,
      application_status: record.payload.Application_Status,
      parcel_number: record.payload.Parcel_Number,
      contractor: record.payload.Contractor,
      inferred_trade: trade,
      estimated_revenue_low: revenue.low,
      estimated_revenue_high: revenue.high,
      raw: record.payload,
    },
  };
}

function buildDescription(payload: Record<string, unknown>) {
  return [
    text(payload.ProjectName),
    text(payload.WorkDescription),
    text(payload.Application_Subtype),
  ].filter(Boolean).join(" - ") || "Sacramento County permit record.";
}

function inferProjectStatus(applicationStatus: string, issuedDate: string | null, finaledDate: string | null): ProjectStatus {
  const status = applicationStatus.toLowerCase();
  if (finaledDate || status.includes("complete") || status.includes("final")) return "Completed";
  if (issuedDate || status.includes("issued")) return "Permitted";
  if (status.includes("received") || status.includes("review") || status.includes("incomplete")) return "Planning";
  if (status.includes("approved")) return "Approved";
  return "Proposed";
}

function inferProjectType(payload: Record<string, unknown>): ProjectType {
  const textBlob = `${text(payload.Application_Type)} ${text(payload.Application_Subtype)} ${text(payload.ProjectName)} ${text(payload.WorkDescription)}`.toLowerCase();
  if (textBlob.includes("commercial") || textBlob.includes("tenant improvement")) return "Commercial";
  if (textBlob.includes("production home") || textBlob.includes("single family") || textBlob.includes("residential") || textBlob.includes("duplex")) return "Residential";
  if (textBlob.includes("warehouse") || textBlob.includes("industrial")) return "Industrial";
  if (textBlob.includes("utility") || textBlob.includes("road") || textBlob.includes("bridge")) return "Infrastructure";
  return text(payload.Application_Type).toLowerCase().includes("commercial") ? "Commercial" : "Residential";
}

function inferSignalType(payload: Record<string, unknown>, status: ProjectStatus): SignalType {
  const textBlob = `${text(payload.Application_Type)} ${text(payload.Application_Subtype)} ${text(payload.ProjectName)} ${text(payload.WorkDescription)}`.toLowerCase();
  if (status === "Permitted") return "Permit";
  if (textBlob.includes("production home") || textBlob.includes("subdivision") || textBlob.includes("master plan")) return "Subdivision Filing";
  if (textBlob.includes("utility") || textBlob.includes("solar") || textBlob.includes("pv") || textBlob.includes("battery")) return "Utility Expansion";
  return "Planning Application";
}

function inferSignalImportance(payload: Record<string, unknown>, signalType: SignalType) {
  let score = signalType === "Permit" ? 82 : signalType === "Subdivision Filing" ? 76 : 65;
  const valuation = number(payload.Valuation) ?? 0;
  if (valuation >= 500_000) score += 10;
  if (valuation >= 100_000) score += 5;
  if (!text(payload.Contractor) || text(payload.Contractor).toLowerCase().includes("owner builder")) score += 6;
  return Math.min(100, score);
}

function inferUnits(payload: Record<string, unknown>) {
  const description = `${text(payload.ProjectName)} ${text(payload.WorkDescription)}`;
  const sfMatch = description.match(/\((\d{3,5})\)\s*S\.?F/i);
  return sfMatch ? 1 : null;
}

function extractContactCompany(payload: Record<string, unknown>) {
  const contractor = text(payload.Contractor);
  if (!contractor || contractor.toLowerCase() === "owner builder") return null;
  return {
    name: contractor,
    company_type: "Contractor",
    website: null,
    phone: null,
    email: null,
    city: inferCity(text(payload.Address)),
    state: "CA",
    notes: `Contractor listed on Sacramento County permit ${text(payload.Application)}.`,
    role: "contractor",
  };
}

function inferCity(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[1].replace(/\s+CA\s+\d+.*/, "").trim() || "Sacramento";
  return "Sacramento";
}

function millisToDate(value: unknown) {
  const parsed = number(value);
  if (!parsed) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
