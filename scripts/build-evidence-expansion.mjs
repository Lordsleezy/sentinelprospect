import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const evidenceDocuments = await readJson("data/evidence_documents.json") ?? [];
const existingContactEvidence = await readJson("data/contact_source_evidence.json") ?? [];
const capturedAt = new Date().toISOString();

validateEvidenceDocuments(evidenceDocuments);

const resolvedDocuments = evidenceDocuments.map((document) => ({
  ...document,
  captured_at: capturedAt,
}));
const document_extraction_results = evidenceDocuments.map((document) => extractDocument(document, capturedAt));
const relationship_evidence = document_extraction_results.flatMap((document) => document.relationships);
const extractionRows = document_extraction_results.flatMap((document) => document.extractions);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/evidence_documents_resolved.json", resolvedDocuments),
  writeJson("data/document_extraction_results.json", document_extraction_results),
  writeJson("data/relationship_evidence.json", relationship_evidence),
  writeFile(resolve("reports/evidence-coverage.md"), renderEvidenceCoverage(document_extraction_results, extractionRows, relationship_evidence, existingContactEvidence)),
  writeFile(resolve("reports/relationship-evidence.md"), renderRelationshipEvidence(relationship_evidence)),
  writeFile(resolve("reports/document-extraction.md"), renderDocumentExtraction(document_extraction_results)),
]);

console.log(`Evidence documents processed: ${document_extraction_results.length}.`);
console.log(`Document extractions: ${extractionRows.length}.`);
console.log(`Relationship evidence rows: ${relationship_evidence.length}.`);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(resolve(file), "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await writeFile(resolve(file), `${JSON.stringify(value, null, 2)}\n`);
}

function validateEvidenceDocuments(documents) {
  const ids = new Set();
  for (const document of documents) {
    if (!safeText(document.id)) throw new Error("Evidence document is missing id.");
    if (ids.has(document.id)) throw new Error(`Duplicate evidence document id: ${document.id}`);
    ids.add(document.id);
    if (!safeText(document.title)) throw new Error(`Evidence document ${document.id} is missing title.`);
    if (!safeUrl(document.source_url)) throw new Error(`Evidence document ${document.id} is missing source_url.`);
    for (const company of document.companies ?? []) {
      if (!safeText(company.name) || !safeText(company.role)) throw new Error(`Evidence document ${document.id} has incomplete company evidence.`);
    }
    for (const relationship of document.relationships ?? []) {
      if (!safeText(relationship.from_company) || !safeText(relationship.to_company) || !safeText(relationship.relationship_type)) {
        throw new Error(`Evidence document ${document.id} has incomplete relationship evidence.`);
      }
    }
  }
}

function extractDocument(document, lastVerified) {
  const companies = (document.companies ?? []).filter((company) => safeText(company.name) && safeText(company.role));
  const trades = (document.trades ?? []).filter(safeText);
  const relationships = (document.relationships ?? []).map((relationship, index) => ({
    id: `${document.id}-relationship-${index + 1}`,
    evidence_document_id: document.id,
    from_company: relationship.from_company,
    to_company: relationship.to_company,
    relationship_type: relationship.relationship_type,
    project_name: document.project_name ?? "Unknown project",
    source_url: document.source_url,
    evidence_summary: relationship.evidence_summary,
    confidence: 0.82,
    last_verified: lastVerified,
  }));

  const extractions = companies.map((company, index) => ({
    id: `${document.id}-company-${index + 1}`,
    evidence_document_id: document.id,
    extraction_type: extractionTypeForRole(company.role),
    entity_name: company.name,
    entity_role: company.role,
    source_url: document.source_url,
    confidence: 0.78,
    last_verified: lastVerified,
    metadata: {
      project_name: document.project_name ?? "Unknown project",
      location: document.location ?? "Unknown",
      source_type: document.source_type,
    },
  }));

  for (const trade of trades) {
    extractions.push({
      id: `${document.id}-trade-${normalizeName(trade).replace(/\s+/g, "-")}`,
      evidence_document_id: document.id,
      extraction_type: "trade_reference",
      entity_name: trade,
      entity_role: "Trade Reference",
      source_url: document.source_url,
      confidence: 0.68,
      last_verified: lastVerified,
      metadata: {
        project_name: document.project_name ?? "Unknown project",
        location: document.location ?? "Unknown",
        source_type: document.source_type,
      },
    });
  }

  if (safeText(document.award_information)) {
    extractions.push({
      id: `${document.id}-award-information`,
      evidence_document_id: document.id,
      extraction_type: "award_information",
      entity_name: document.award_information,
      entity_role: "Award Information",
      source_url: document.source_url,
      confidence: 0.74,
      last_verified: lastVerified,
      metadata: {
        project_name: document.project_name ?? "Unknown project",
        location: document.location ?? "Unknown",
        source_type: document.source_type,
      },
    });
  }

  return {
    evidence_document_id: document.id,
    title: document.title,
    source_type: document.source_type,
    source_name: document.source_name,
    source_url: document.source_url,
    project_name: document.project_name ?? "Unknown project",
    location: document.location ?? "Unknown",
    summary: document.summary ?? "",
    companies,
    trades,
    relationships,
    award_information: document.award_information ?? null,
    extractions,
    evidence_count: 1 + companies.length + trades.length + relationships.length + (document.award_information ? 1 : 0),
    last_verified: lastVerified,
  };
}

function renderEvidenceCoverage(documents, extractions, relationships, existingContactEvidence) {
  const bySourceType = countValues(documents.map((document) => document.source_type));
  const byExtractionType = countValues(extractions.map((extraction) => extraction.extraction_type));
  const companies = uniqueValues(documents.flatMap((document) => document.companies.map((company) => canonicalCompanyName(company.name))));

  return [
    "# Evidence Coverage",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- New evidence documents processed: ${documents.length}`,
    `- Document extraction rows: ${extractions.length}`,
    `- Unique companies found in evidence: ${companies.length}`,
    `- Relationship evidence rows: ${relationships.length}`,
    `- Existing contact evidence rows available: ${existingContactEvidence.length}`,
    `- Documents with award information: ${documents.filter((document) => document.award_information).length}`,
    "",
    "## Evidence Sources",
    "",
    table(bySourceType, [
      ["Source Type", (row) => row.name],
      ["Documents", (row) => row.count],
    ]),
    "",
    "## Extraction Types",
    "",
    table(byExtractionType, [
      ["Extraction Type", (row) => row.name],
      ["Rows", (row) => row.count],
    ]),
    "",
    "## Company Evidence",
    "",
    table(documents, [
      ["Project", (row) => row.project_name],
      ["Source Type", (row) => row.source_type],
      ["Companies", (row) => row.companies.map((company) => `${company.name} (${company.role})`).join(", ") || "Unknown"],
      ["Trades", (row) => row.trades.join(", ") || "Unknown"],
      ["Evidence Count", (row) => row.evidence_count],
      ["Source", (row) => row.source_url],
    ]),
  ].join("\n");
}

function renderRelationshipEvidence(rows) {
  const repeated = countValues(rows.map((row) => `${canonicalCompanyName(row.from_company)} -> ${canonicalCompanyName(row.to_company)} (${row.relationship_type})`)).filter((row) => row.count > 1);
  return [
    "# Relationship Evidence",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Relationship evidence rows: ${rows.length}`,
    `- Repeated relationship candidates: ${repeated.length}`,
    "",
    "## Repeated Relationship Candidates",
    "",
    table(repeated, [
      ["Relationship", (row) => row.name],
      ["Evidence Documents", (row) => row.count],
    ]),
    "",
    "## Source-Backed Relationship Evidence",
    "",
    table(rows, [
      ["From", (row) => row.from_company],
      ["To", (row) => row.to_company],
      ["Type", (row) => row.relationship_type],
      ["Project", (row) => row.project_name],
      ["Confidence", (row) => pct(row.confidence)],
      ["Evidence", (row) => row.evidence_summary],
      ["Source", (row) => row.source_url],
    ]),
  ].join("\n");
}

function renderDocumentExtraction(documents) {
  return [
    "# Document Extraction",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(documents, [
      ["Document", (row) => row.title],
      ["Project", (row) => row.project_name],
      ["Location", (row) => row.location],
      ["Developer", (row) => roleNames(row, "Developer")],
      ["General Contractor", (row) => roleNames(row, "General Contractor")],
      ["Architect", (row) => roleNames(row, "Architect")],
      ["Engineer", (row) => roleNames(row, "Engineer")],
      ["Property Owner", (row) => roleNames(row, "Property Owner")],
      ["Trades", (row) => row.trades.join(", ") || "Unknown"],
      ["Known Relationships", (row) => row.relationships.length],
      ["Award Information", (row) => row.award_information ?? "Unknown"],
      ["Source", (row) => row.source_url],
    ]),
  ].join("\n");
}

function extractionTypeForRole(role) {
  const value = role.toLowerCase();
  if (value.includes("developer")) return "developer";
  if (value.includes("general contractor")) return "general_contractor";
  if (value.includes("architect")) return "architect";
  if (value.includes("engineer")) return "engineer";
  if (value.includes("property owner") || value.includes("owner")) return "property_owner";
  if (value.includes("construction manager")) return "construction_manager";
  if (value.includes("project manager")) return "project_manager";
  if (value.includes("contractor")) return "known_contractor";
  return "known_contractor";
}

function roleNames(document, role) {
  return document.companies.filter((company) => company.role === role).map((company) => company.name).join(", ") || "Unknown";
}

function countValues(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function safeUrl(value) {
  if (typeof value !== "string") return false;
  return /^https?:\/\//i.test(value.trim()) && isSourceBackedText(value);
}

function safeText(value) {
  return typeof value === "string" && value.trim() && isSourceBackedText(value);
}

function isSourceBackedText(value) {
  if (!value) return false;
  const blob = String(value).toLowerCase();
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

function canonicalCompanyName(value) {
  const normalized = normalizeName(value);
  if (normalized.includes("lennar")) return "Lennar Homes of California";
  if (normalized.includes("kevin l cook architect")) return "Kevin L Cook Architect";
  if (normalized.includes("lund construction")) return "Lund Construction";
  if (normalized.includes("taylor morrison")) return "Taylor Morrison of California";
  if (normalized.includes("integral communities")) return "Integral Communities";
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|incorporated|company|co|limited|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function table(rows, columns) {
  if (!rows.length) return "_None._";
  return [
    `| ${columns.map(([name]) => name).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, getter]) => escapeCell(getter(row))).join(" | ")} |`),
  ].join("\n");
}

function escapeCell(value) {
  return String(value ?? "Unknown").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}
