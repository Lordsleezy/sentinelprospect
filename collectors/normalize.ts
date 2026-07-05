import type { NormalizedProjectRecord, RawSourceRecord } from "./types";
import type { SignalType } from "../src/lib/types";

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value.replace(/[$,]/g, ""));
  return null;
}

export function normalizePlanningRecord(record: RawSourceRecord): NormalizedProjectRecord {
  const payload = record.payload;
  const signalType = asText(payload.signal_type);
  return {
    project: {
      external_id: asText(payload.external_id),
      name: asText(payload.name, "Unnamed project"),
      description: asText(payload.description, "No description provided by source."),
      project_type: asText(payload.project_type, "Commercial") as NormalizedProjectRecord["project"]["project_type"],
      status: asText(payload.status, "Planning") as NormalizedProjectRecord["project"]["status"],
      city: asText(payload.city),
      county: asText(payload.county),
      state: asText(payload.state, "CA"),
      address: asText(payload.address),
      latitude: asNumber(payload.latitude) ?? 0,
      longitude: asNumber(payload.longitude) ?? 0,
      estimated_units: asNumber(payload.estimated_units),
      estimated_value: asNumber(payload.estimated_value),
      source_url: record.sourceUrl,
      source_name: record.sourceName,
    },
    permits: [],
    companies: [],
    documents: [],
    signals: signalType ? [{
      project_external_id: asText(payload.external_id),
      signal_type: signalType as SignalType,
      signal_date: asText(payload.signal_date, record.capturedAt.slice(0, 10)),
      description: asText(payload.signal_description, `${signalType} detected by ${record.sourceName}.`),
      source: record.sourceName,
      source_url: record.sourceUrl,
      external_id: asText(payload.external_id),
      parcel_number: asText(payload.parcel_number) || null,
      jurisdiction: asText(payload.jurisdiction) || asText(payload.county) || null,
      importance_score: asNumber(payload.importance_score) ?? 50,
    }] : [],
    evidence: [{
      record_type: "source_record",
      record_id: asText(payload.external_id, record.sourceId),
      source_name: record.sourceName,
      source_url: record.sourceUrl,
      title: asText(payload.name, "Source record"),
      summary: asText(payload.description, "Raw source record captured by collector."),
      captured_at: record.capturedAt,
      confidence: 0.65,
      metadata: payload,
    }],
  };
}
