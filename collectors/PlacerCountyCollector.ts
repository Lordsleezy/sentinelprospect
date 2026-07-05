import { BaseCollector } from "./BaseCollector";
import type { NormalizedProjectRecord, RawSourceRecord } from "./types";
import type { EvidenceRecord, OpportunityTrade, ProjectStatus, ProjectType, SignalType } from "../src/lib/types";

type ArcGisFeature = {
  attributes: Record<string, unknown>;
  geometry?: { x?: number; y?: number };
};

const FEATURE_SERVICE_URL = "https://services6.arcgis.com/PArfeTGcwA9RGNzN/arcgis/rest/services/ActiveBuildingPermits/FeatureServer/0/query";
const SOURCE_RECORD_URL = "https://gis-placercounty.opendata.arcgis.com/maps/7a3b4d080af04cdaa9f2c41b7ae0f55a";

export class PlacerCountyCollector extends BaseCollector {
  readonly sourceName = "Placer County Active Building Permits";
  readonly sourceType = "ArcGIS Feature Service";
  readonly baseUrl = "https://services6.arcgis.com/PArfeTGcwA9RGNzN/arcgis/rest/services/ActiveBuildingPermits/FeatureServer";

  constructor(private readonly options: { recordLimit?: number } = {}) {
    super();
  }

  async collect(): Promise<RawSourceRecord[]> {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      orderByFields: "OBJECTID DESC",
      resultRecordCount: String(this.options.recordLimit ?? 75),
      outSR: "4326",
      f: "json",
    });
    const response = await fetch(`${FEATURE_SERVICE_URL}?${params.toString()}`);
    if (!response.ok) throw new Error(`Placer County ArcGIS request failed: ${response.status}`);
    const payload = await response.json() as { features?: ArcGisFeature[]; error?: { message?: string } };
    if (payload.error) throw new Error(payload.error.message ?? "Placer County ArcGIS returned an error.");

    const capturedAt = new Date().toISOString();
    return (payload.features ?? []).map((feature) => {
      const application = text(feature.attributes.ActiveBuilding_ExcelToTable_B1_, `OBJECTID-${feature.attributes.OBJECTID}`);
      return {
        sourceId: `placer-active-permit-${application}-${feature.attributes.OBJECTID}`,
        sourceName: this.sourceName,
        sourceUrl: SOURCE_RECORD_URL,
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
    const application = text(record.payload.ActiveBuilding_ExcelToTable_B1_);
    if (!application) return null;
    const status = inferStatus(text(record.payload.ActiveBuilding_ExcelToTable_Sta));
    const trade = inferTrade(record.payload);
    const description = buildDescription(record.payload);
    const evidence = sourceRecordEvidence(record, trade);

    return {
      project: {
        external_id: `${application}-${record.payload.OBJECTID}`,
        name: text(record.payload.ActiveBuilding_ExcelToTable_Pro) || `${text(record.payload.ActiveBuilding_ExcelToTable_Sco, "Permit")} at ${text(record.payload.ActiveBuilding_ExcelToTable_Add, "Placer County")}`,
        description,
        project_type: inferProjectType(record.payload),
        status,
        city: inferCity(record.payload),
        county: "Placer County",
        state: "CA",
        address: text(record.payload.ActiveBuilding_ExcelToTable_Add, "Placer County, CA"),
        latitude: number(record.payload.latitude) ?? 38.8966,
        longitude: number(record.payload.longitude) ?? -121.0769,
        estimated_units: null,
        estimated_value: null,
        source_url: record.sourceUrl,
        source_name: this.sourceName,
      },
      permits: [{
        permit_number: application,
        permit_type: text(record.payload.ActiveBuilding_ExcelToTable_Sco, "Building Permit"),
        permit_status: text(record.payload.ActiveBuilding_ExcelToTable_Sta, "Active"),
        permit_date: record.capturedAt.slice(0, 10),
        permit_value: null,
        source_url: record.sourceUrl,
      }],
      companies: [],
      documents: [{
        title: `${application} Placer County active permit record`,
        document_type: "Active building permit source",
        source_url: record.sourceUrl,
        summary: description,
      }],
      signals: [{
        project_external_id: `${application}-${record.payload.OBJECTID}`,
        signal_type: inferSignalType(record.payload, status),
        signal_date: record.capturedAt.slice(0, 10),
        description: `${this.sourceName} signal for ${application}: ${description}`,
        source: this.sourceName,
        source_url: record.sourceUrl,
        external_id: application,
        parcel_number: text(record.payload.ActiveBuilding_ExcelToTable_APN) || text(record.payload.ASSESSORS_Parcel_point_APN) || null,
        jurisdiction: text(record.payload.ASSESSORS_Parcel_point_JURISDIC, "Placer County"),
        importance_score: inferImportance(record.payload, status),
      }],
      evidence: [evidence],
    };
  }
}

function sourceRecordEvidence(record: RawSourceRecord, trade: OpportunityTrade): Omit<EvidenceRecord, "id"> {
  return {
    record_type: "source_record",
    record_id: text(record.payload.ActiveBuilding_ExcelToTable_B1_, record.sourceId),
    source_name: record.sourceName,
    source_url: record.sourceUrl,
    title: `${text(record.payload.ActiveBuilding_ExcelToTable_B1_, "Permit")} ${text(record.payload.ActiveBuilding_ExcelToTable_Sco, "Building Permit")}`,
    summary: buildDescription(record.payload),
    captured_at: record.capturedAt,
    confidence: 0.82,
    metadata: {
      source: "Placer County Active Building Permits ArcGIS FeatureServer",
      application: record.payload.ActiveBuilding_ExcelToTable_B1_,
      application_status: record.payload.ActiveBuilding_ExcelToTable_Sta,
      parcel_number: record.payload.ActiveBuilding_ExcelToTable_APN,
      inferred_trades: [trade],
      revenue_windows: {},
      raw: record.payload,
    },
  };
}

function inferTrade(payload: Record<string, unknown>): OpportunityTrade {
  const blob = `${text(payload.ActiveBuilding_ExcelToTable_Sco)} ${text(payload.ActiveBuilding_ExcelToTable_Pro)} ${text(payload.ActiveBuilding_ExcelToTable_Des)}`.toLowerCase();
  if (blob.includes("fence") || blob.includes("gate") || blob.includes("wall")) return "Fencing";
  if (blob.includes("roof")) return "Roofing";
  if (blob.includes("hvac") || blob.includes("mechanical")) return "HVAC";
  if (blob.includes("electric") || blob.includes("solar") || blob.includes("battery")) return "Electrical";
  if (blob.includes("concrete") || blob.includes("pool") || blob.includes("spa")) return "Concrete";
  if (blob.includes("sewer") || blob.includes("grading") || blob.includes("site") || blob.includes("utility")) return "Site work";
  if (blob.includes("townhome") || blob.includes("residential")) return "Fencing";
  return "General";
}

function inferStatus(status: string): ProjectStatus {
  const normalized = status.toLowerCase();
  if (normalized.includes("issued")) return "Permitted";
  if (normalized.includes("review")) return "Planning";
  if (normalized.includes("approved")) return "Approved";
  if (normalized.includes("complete") || normalized.includes("final")) return "Completed";
  return "Proposed";
}

function inferProjectType(payload: Record<string, unknown>): ProjectType {
  const blob = `${text(payload.ActiveBuilding_ExcelToTable_Sco)} ${text(payload.ActiveBuilding_ExcelToTable_Pro)} ${text(payload.ActiveBuilding_ExcelToTable_Des)}`.toLowerCase();
  if (blob.includes("commercial") || blob.includes("wireless")) return "Commercial";
  if (blob.includes("townhome") || blob.includes("residential")) return "Residential";
  if (blob.includes("sewer") || blob.includes("utility")) return "Infrastructure";
  return "Commercial";
}

function inferSignalType(payload: Record<string, unknown>, status: ProjectStatus): SignalType {
  if (status === "Permitted") return "Permit";
  const blob = `${text(payload.ActiveBuilding_ExcelToTable_Sco)} ${text(payload.ActiveBuilding_ExcelToTable_Des)}`.toLowerCase();
  if (blob.includes("sewer") || blob.includes("utility")) return "Utility Expansion";
  return "Planning Application";
}

function inferImportance(payload: Record<string, unknown>, status: ProjectStatus) {
  let score = status === "Permitted" ? 80 : 66;
  if (text(payload.ActiveBuilding_ExcelToTable_APN)) score += 5;
  if (text(payload.ActiveBuilding_ExcelToTable_Des).length > 80) score += 4;
  return Math.min(100, score);
}

function buildDescription(payload: Record<string, unknown>) {
  return [
    text(payload.ActiveBuilding_ExcelToTable_Pro),
    text(payload.ActiveBuilding_ExcelToTable_Des),
    text(payload.ActiveBuilding_ExcelToTable_Sco),
  ].filter(Boolean).join(" - ") || "Placer County active building permit.";
}

function inferCity(payload: Record<string, unknown>) {
  const jurisdiction = text(payload.ASSESSORS_Parcel_point_JURISDIC);
  if (jurisdiction && jurisdiction !== "Placer County") return jurisdiction.replace(/^City of\s+/i, "");
  const address = text(payload.ActiveBuilding_ExcelToTable_Add).toLowerCase();
  if (address.includes("northstar")) return "Truckee";
  return "Placer County";
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}
