import sacramentoCountyPermits from "../../data/sacramento-county-permits.json";
import placerCountyRecords from "../../data/placer-county-records.json";
import samGovOpportunities from "../../data/samgov-opportunities.json";
import { isSourceBackedCompanyName } from "./contact-quality";
import type { Company, EvidenceRecord, Permit, Project, ProjectDetail, Signal } from "./types";

type CachedRecord = {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  capturedAt: string;
  payload: Record<string, unknown>;
  normalized: {
    project: Project & { external_id?: string };
    permit: Omit<Permit, "project_id">;
    signal: Omit<Signal, "project_id">;
    evidence: EvidenceRecord;
    contactCompany: (Company & { role: "contractor" }) | null;
    inferredTrades: string[];
    revenueWindows: Record<string, { low: number | null; high: number | null }>;
  };
};

type Cache = {
  sourceName: string;
  sourceType: string;
  sourceUrl: string;
  capturedAt: string;
  records: CachedRecord[];
};

const caches = [
  sacramentoCountyPermits,
  placerCountyRecords,
  samGovOpportunities,
] as unknown as Cache[];

const records = caches.flatMap((cache) => cache.records ?? []);

export const collectedSourceMetadata = {
  sourceName: "Collected Intelligence Sources",
  sourceType: "Multi-source cache",
  sourceUrl: caches.map((cache) => cache.sourceUrl).filter(Boolean).join(", "),
  capturedAt: caches.map((cache) => cache.capturedAt).filter(Boolean).sort().at(-1) ?? "",
  recordCount: records.length,
};

export const collectedProjects: Project[] = records.map((record) => stripExternalId(record.normalized.project));

export const collectedPermits: Array<Permit & { projects: Pick<Project, "city" | "county" | "name"> }> = records.map((record) => {
  const project = stripExternalId(record.normalized.project);
  return {
    ...record.normalized.permit,
    project_id: project.id,
    projects: {
      city: project.city,
      county: project.county,
      name: project.name,
    },
  };
});

export const collectedSignals: Signal[] = records.map((record) => ({
  ...record.normalized.signal,
  project_id: record.normalized.project.id,
}));

export const collectedEvidenceRecords: EvidenceRecord[] = records.map((record) => record.normalized.evidence);

export function getCollectedProject(id: string): ProjectDetail | null {
  const record = records.find((item) => item.normalized.project.id === id);
  if (!record) return null;
  const project = stripExternalId(record.normalized.project);
  const company = sourceBackedCompany(record.normalized.contactCompany);
  return {
    ...project,
    permits: [{ ...record.normalized.permit, project_id: project.id }],
    signals: [{ ...record.normalized.signal, project_id: project.id }],
    documents: [{
      id: `sac-document-${record.normalized.permit.permit_number.toLowerCase()}`,
      project_id: project.id,
      title: `${record.normalized.permit.permit_number} source record`,
      document_type: "Sacramento County permit source",
      source_url: record.sourceUrl,
      summary: record.normalized.evidence.summary,
      created_at: record.capturedAt,
    }],
    companies: company ? [company] : [],
    evidence_records: [record.normalized.evidence],
  };
}

export function getCollectedProjectDetails() {
  return records.map((record) => getCollectedProject(record.normalized.project.id)).filter(Boolean) as ProjectDetail[];
}

function sourceBackedCompany(company: (Company & { role: "contractor" }) | null) {
  if (!company || !isSourceBackedCompanyName(company.name)) return null;
  return company;
}

function stripExternalId(project: Project & { external_id?: string }): Project {
  const { external_id, ...rest } = project;
  void external_id;
  return rest;
}
