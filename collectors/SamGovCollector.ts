import { BaseCollector } from "./BaseCollector";
import type { NormalizedProjectRecord, RawSourceRecord } from "./types";
import type { EvidenceRecord, OpportunityTrade } from "../src/lib/types";

const SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";

export class SamGovCollector extends BaseCollector {
  readonly sourceName = "SAM.gov Contract Opportunities";
  readonly sourceType = "SAM.gov Opportunities API";
  readonly baseUrl = SEARCH_URL;

  constructor(private readonly options: { apiKey?: string; keywords?: string[]; recordLimit?: number } = {}) {
    super();
  }

  async collect(): Promise<RawSourceRecord[]> {
    if (!this.options.apiKey) return [];
    const keywords = this.options.keywords ?? ["fencing", "site work", "concrete", "roofing", "HVAC", "electrical", "utility"];
    const capturedAt = new Date().toISOString();
    const records: RawSourceRecord[] = [];
    for (const keyword of keywords) {
      const params = new URLSearchParams({
        api_key: this.options.apiKey,
        limit: String(this.options.recordLimit ?? 10),
        offset: "0",
        postedFrom: formatSamDate(daysAgo(30)),
        postedTo: formatSamDate(new Date()),
        keyword,
      });
      const response = await fetch(`${SEARCH_URL}?${params.toString()}`);
      if (!response.ok) throw new Error(`SAM.gov request failed for ${keyword}: ${response.status}`);
      const payload = await response.json() as { opportunitiesData?: Array<Record<string, unknown>> };
      for (const item of payload.opportunitiesData ?? []) {
        const noticeId = text(item.noticeId) || text(item.solicitationNumber) || `${keyword}-${records.length}`;
        records.push({
          sourceId: `samgov-${noticeId}`,
          sourceName: this.sourceName,
          sourceUrl: text(item.uiLink, "https://sam.gov/opportunities"),
          capturedAt,
          payload: { ...item, keyword },
        });
      }
    }
    return dedupe(records);
  }

  normalize(record: RawSourceRecord): NormalizedProjectRecord | null {
    const title = text(record.payload.title);
    const noticeId = text(record.payload.noticeId, record.sourceId);
    if (!title) return null;
    const trade = inferTrade(record.payload);
    const evidence = sourceRecordEvidence(record, trade);
    return {
      project: {
        external_id: noticeId,
        name: title,
        description: buildDescription(record.payload),
        project_type: "Government",
        status: "Permitted",
        city: inferCity(record.payload),
        county: "Federal",
        state: inferState(record.payload),
        address: inferPlace(record.payload),
        latitude: 38.5816,
        longitude: -121.4944,
        estimated_units: null,
        estimated_value: null,
        source_url: record.sourceUrl,
        source_name: this.sourceName,
      },
      permits: [{
        permit_number: text(record.payload.solicitationNumber, noticeId),
        permit_type: text(record.payload.type, "Contract Opportunity"),
        permit_status: text(record.payload.active, "Active"),
        permit_date: text(record.payload.postedDate, record.capturedAt.slice(0, 10)),
        permit_value: null,
        source_url: record.sourceUrl,
      }],
      companies: [],
      documents: [{
        title: `${noticeId} SAM.gov opportunity`,
        document_type: "Federal opportunity notice",
        source_url: record.sourceUrl,
        summary: buildDescription(record.payload),
      }],
      signals: [{
        project_external_id: noticeId,
        signal_type: "Permit",
        signal_date: text(record.payload.postedDate, record.capturedAt.slice(0, 10)),
        description: `SAM.gov ${text(record.payload.type, "opportunity")} notice: ${buildDescription(record.payload)}`,
        source: this.sourceName,
        source_url: record.sourceUrl,
        external_id: noticeId,
        parcel_number: null,
        jurisdiction: "Federal",
        importance_score: 88,
      }],
      evidence: [evidence],
    };
  }
}

function sourceRecordEvidence(record: RawSourceRecord, trade: OpportunityTrade): Omit<EvidenceRecord, "id"> {
  return {
    record_type: "source_record",
    record_id: text(record.payload.noticeId, record.sourceId),
    source_name: record.sourceName,
    source_url: record.sourceUrl,
    title: text(record.payload.title, "SAM.gov opportunity"),
    summary: buildDescription(record.payload),
    captured_at: record.capturedAt,
    confidence: 0.88,
    metadata: {
      source: "SAM.gov Opportunities API",
      notice_id: record.payload.noticeId,
      solicitation_number: record.payload.solicitationNumber,
      notice_type: record.payload.type,
      response_deadline: record.payload.responseDeadLine,
      agency: record.payload.fullParentPathName,
      inferred_trades: [trade],
      revenue_windows: {},
      raw: record.payload,
    },
  };
}

function inferTrade(payload: Record<string, unknown>): OpportunityTrade {
  const blob = `${text(payload.title)} ${text(payload.description)} ${text(payload.keyword)} ${text(payload.type)}`.toLowerCase();
  if (blob.includes("fenc")) return "Fencing";
  if (blob.includes("roof")) return "Roofing";
  if (blob.includes("hvac") || blob.includes("mechanical")) return "HVAC";
  if (blob.includes("electric")) return "Electrical";
  if (blob.includes("concrete")) return "Concrete";
  if (blob.includes("site") || blob.includes("utility")) return "Site work";
  return "General";
}

function buildDescription(payload: Record<string, unknown>) {
  return [text(payload.title), text(payload.type), text(payload.fullParentPathName), text(payload.responseDeadLine) ? `Response due ${text(payload.responseDeadLine)}` : ""].filter(Boolean).join(" - ");
}

function inferPlace(payload: Record<string, unknown>) {
  const pop = payload.placeOfPerformance;
  if (pop && typeof pop === "object") return JSON.stringify(pop);
  return "Federal opportunity";
}

function inferCity(payload: Record<string, unknown>) {
  const place = inferPlace(payload);
  const match = place.match(/"city":\s*"([^"]+)"/i);
  return match?.[1] ?? "Federal";
}

function inferState(payload: Record<string, unknown>) {
  const place = inferPlace(payload);
  const match = place.match(/"state":\s*"([^"]+)"/i);
  return match?.[1] ?? "US";
}

function dedupe(records: RawSourceRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.sourceId)) return false;
    seen.add(record.sourceId);
    return true;
  });
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function formatSamDate(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
