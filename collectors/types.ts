import type { Company, Document, EvidenceRecord, Permit, Project, Signal } from "../src/lib/types";

export type RawSourceRecord = {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  capturedAt: string;
  payload: Record<string, unknown>;
};

export type NormalizedProjectRecord = {
  project: Omit<Project, "id" | "created_at" | "updated_at"> & {
    external_id?: string;
  };
  permits?: Array<Omit<Permit, "id" | "project_id" | "created_at">>;
  companies?: Array<Omit<Company, "id"> & { role?: string }>;
  documents?: Array<Omit<Document, "id" | "project_id" | "created_at">>;
  signals?: Array<Omit<Signal, "id" | "project_id"> & { project_external_id?: string }>;
  evidence?: Array<Omit<EvidenceRecord, "id">>;
};

export type CollectorRunResult = {
  sourceName: string;
  rawRecords: RawSourceRecord[];
  normalizedRecords: NormalizedProjectRecord[];
};

export type CollectorConfig = {
  sourceName: string;
  sourceType: string;
  baseUrl: string;
  jurisdiction: string;
  enabled: boolean;
  notes: string;
};
