import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const evidenceDocuments = await readJson("data/evidence_documents.json") ?? [];
const existingContactEvidence = await readJson("data/contact_source_evidence.json") ?? [];
const contractorOpportunities = await readJson("data/contractor_opportunities.json") ?? [];
const scopeIntelligence = await readJson("data/scope_intelligence.json") ?? [];
const capturedAt = new Date().toISOString();

validateEvidenceDocuments(evidenceDocuments);

const resolvedDocuments = evidenceDocuments.map((document) => ({
  ...document,
  captured_at: capturedAt,
}));
const document_extraction_results = evidenceDocuments.map((document) => extractDocument(document, capturedAt));
const relationship_evidence = document_extraction_results.flatMap((document) => document.relationships);
const extractionRows = document_extraction_results.flatMap((document) => document.extractions);
const evidence_expansion = contractorOpportunities.map((opportunity) => buildEvidenceExpansion(opportunity, document_extraction_results));

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/evidence_documents_resolved.json", resolvedDocuments),
  writeJson("data/document_extraction_results.json", document_extraction_results),
  writeJson("data/relationship_evidence.json", relationship_evidence),
  writeJson("data/evidence_expansion.json", evidence_expansion),
  writeFile(resolve("reports/evidence-coverage.md"), renderEvidenceCoverage(document_extraction_results, extractionRows, relationship_evidence, existingContactEvidence)),
  writeFile(resolve("reports/relationship-evidence.md"), renderRelationshipEvidence(relationship_evidence)),
  writeFile(resolve("reports/document-extraction.md"), renderDocumentExtraction(document_extraction_results)),
  writeFile(resolve("reports/evidence-expansion.md"), renderEvidenceExpansion(evidence_expansion)),
  writeFile(resolve("reports/project-dossiers.md"), renderProjectDossiers(evidence_expansion)),
]);

console.log(`Evidence documents processed: ${document_extraction_results.length}.`);
console.log(`Document extractions: ${extractionRows.length}.`);
console.log(`Relationship evidence rows: ${relationship_evidence.length}.`);
console.log(`Evidence expansion dossiers: ${evidence_expansion.length}.`);

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

function buildEvidenceExpansion(opportunity, documents) {
  const scope = scopeIntelligence.find((row) => row.opportunity_id === opportunity.id);
  const identity = projectIdentity(opportunity, scope);
  const relatedEvidence = relatedDocuments(identity, documents);
  const evidenceSignals = evidenceFenceSignals(relatedEvidence);
  const contradiction = contradictionStatus(scope, evidenceSignals);
  const projectDossier = projectDossierFor(opportunity, identity, relatedEvidence, scope, evidenceSignals, contradiction);

  return {
    opportunity_id: opportunity.id,
    project_identity: identity,
    related_evidence_count: relatedEvidence.length,
    related_evidence: relatedEvidence.map(evidenceReference),
    project_dossier: projectDossier,
    project_summary: projectDossier.project_summary,
    scope_summary: projectDossier.scope_summary,
    evidence_summary: projectDossier.evidence_summary,
    supporting_evidence: projectDossier.supporting_evidence,
    evidence_fence_signals: evidenceSignals.positive,
    evidence_negative_signals: evidenceSignals.negative,
    evidence_fence_signal_score: evidenceSignals.score,
    fence_scope_confidence: contradiction.fence_scope_confidence,
    likely_fence_scope: contradiction.likely_fence_scope,
    why_fencing_is_relevant: projectDossier.why_fencing_is_relevant,
    contradiction_notes: contradiction.notes,
    last_verified: capturedAt,
  };
}

function projectIdentity(opportunity, scope) {
  const companies = opportunity.companies ?? [];
  return {
    project_name: opportunity.project_name,
    project_number: extractNumber(opportunity.project_name, /\b(?:PLN|DRS|RZ|SP|GP|ZOB|CONTROL)[-\s]?\d{2,6}\b/i),
    case_number: extractNumber(opportunity.project_name, /\b[A-Z]{2,5}\d{2,6}[-\dA-Z]*\b/i),
    permit_number: String(opportunity.id ?? "").startsWith("sac-") ? opportunity.id.replace(/^sac-/i, "").toUpperCase() : extractNumber(opportunity.source_url, /[A-Z]{2,6}\d{4}[-\d]+/i),
    planning_number: extractNumber(`${opportunity.project_name} ${opportunity.source_url}`, /\bPLN[-\s]?\d{2}[-\s]?\d{3,6}\b/i),
    apn: extractNumber(opportunity.project_name, /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/),
    parcel: extractNumber(opportunity.project_name, /\b(?:lot|parcel)\s+\d+[A-Z-]*/i),
    developer: known(opportunity.developer) ?? companyByType(companies, "Developer"),
    owner: companyByType(companies, "Property Owner"),
    applicant: known(opportunity.developer) ?? companyByType(companies, "Developer"),
    address: addressFrom(opportunity),
    city: opportunity.city,
    county: opportunity.county,
    normalized_key: normalizeProjectKey(opportunity.project_name, scope?.project_summary),
  };
}

function relatedDocuments(identity, documents) {
  const identityTerms = [
    identity.project_name,
    identity.project_number,
    identity.case_number,
    identity.permit_number,
    identity.planning_number,
    identity.apn,
    identity.parcel,
    identity.developer,
    identity.applicant,
    identity.address,
  ].filter(Boolean);

  return documents
    .map((document) => ({ document, score: evidenceMatchScore(document, identity, identityTerms) }))
    .filter((item) => item.score >= 20)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.document);
}

function evidenceMatchScore(document, identity, identityTerms) {
  const text = [
    document.project_name,
    document.title,
    document.summary,
    document.location,
    document.source_name,
    ...document.companies.map((company) => `${company.name} ${company.role}`),
    ...document.trades,
  ].join(" ").toLowerCase();
  let score = 0;
  if (normalizeProjectKey(document.project_name) === identity.normalized_key) score += 80;
  for (const term of identityTerms) {
    const normalized = String(term).toLowerCase();
    if (identity.developer && normalized === String(identity.developer).toLowerCase()) continue;
    if (identity.applicant && normalized === String(identity.applicant).toLowerCase()) continue;
    if (normalized.length > 4 && text.includes(normalized)) score += 24;
  }
  const projectTokens = tokenSet(identity.project_name);
  const docTokens = tokenSet(`${document.project_name} ${document.title}`);
  const overlap = [...projectTokens].filter((token) => docTokens.has(token)).length;
  score += overlap * 8;
  const hasStrongIdentifier = [identity.project_number, identity.case_number, identity.permit_number, identity.planning_number, identity.apn, identity.address].some((value) => value && text.includes(String(value).toLowerCase()));
  if (overlap === 0 && !hasStrongIdentifier) score = Math.min(score, 12);
  if (identity.developer && overlap > 0 && text.includes(String(identity.developer).toLowerCase().split(/\s+/)[0])) score += 8;
  return score;
}

function evidenceFenceSignals(documents) {
  const positive = [];
  const negative = [];
  for (const document of documents) {
    const text = `${document.project_name} ${document.title} ${document.summary} ${document.trades.join(" ")}`.toLowerCase();
    addSignal(positive, text, /subdivision|homes|residential|apartment|village|lot|units?/, "Residential subdivision or housing evidence", document);
    addSignal(positive, text, /school|campus/, "School project evidence", document);
    addSignal(positive, text, /park|trail|open space|recreation/, "Parks, trails, or public access evidence", document);
    addSignal(positive, text, /industrial|warehouse|yard/, "Industrial or yard use evidence", document);
    addSignal(positive, text, /boundary|perimeter|fence|gate|access control|security/, "Boundary, gate, security, or access-control evidence", document);
    addSignal(positive, text, /utility|drainage|storm|trunk|infrastructure|site work|earthwork/, "Utility, drainage, or infrastructure evidence", document);
    addSignal(negative, text, /roof|reroof|tpo|membrane|capsheet/, "Roof replacement evidence", document);
    addSignal(negative, text, /hvac|mechanical|package unit|air conditioning/, "HVAC-only replacement evidence", document);
    addSignal(negative, text, /interior remodel|kitchen|bathroom|flooring|painting|tenant improvement/, "Interior or tenant-improvement-only evidence", document);
  }
  const score = Math.max(0, Math.min(100, positive.length * 18 - negative.length * 20));
  return { positive: dedupeSignals(positive), negative: dedupeSignals(negative), score };
}

function addSignal(signals, text, pattern, label, document) {
  if (!pattern.test(text)) return;
  signals.push({
    signal: label,
    source: document.title,
    source_url: document.source_url,
    source_type: document.source_type,
  });
}

function contradictionStatus(scope, evidenceSignals) {
  let fenceScopeConfidence = scope?.fence_scope_confidence ?? "No Meaningful Fence Opportunity";
  let likelyFenceScope = scope?.potential_fencing_scope?.[0] ?? "Unknown";
  const notes = [];

  if (evidenceSignals.score >= 72 && ["Weak Signal", "No Meaningful Fence Opportunity"].includes(fenceScopeConfidence)) {
    fenceScopeConfidence = "Possible Scope";
    notes.push("Evidence signals raised a weak/no-meaningful classification to possible scope.");
  }
  if (evidenceSignals.negative.length && evidenceSignals.positive.length === 0) {
    fenceScopeConfidence = "No Meaningful Fence Opportunity";
    notes.push("Negative evidence without positive fence evidence suppresses fence scope.");
  }
  if (fenceScopeConfidence === "Weak Signal") {
    likelyFenceScope = "Insufficient evidence to determine likely fencing scope.";
    notes.push("Weak Signal cannot generate a specific fencing scope.");
  }
  if (fenceScopeConfidence === "No Meaningful Fence Opportunity") {
    likelyFenceScope = "No fencing scope generated.";
    notes.push("No Meaningful Fence Opportunity suppresses fencing scope generation.");
  }
  return { fence_scope_confidence: fenceScopeConfidence, likely_fence_scope: likelyFenceScope, notes };
}

function projectDossierFor(opportunity, identity, documents, scope, evidenceSignals, contradiction) {
  const support = documents.map(evidenceReference);
  const relatedDevelopment = relatedDevelopmentFor(documents);
  const associatedImprovements = associatedImprovementsFor(documents, scope);
  const developer = identity.developer ?? roleFromDocuments(documents, "Developer") ?? "Unknown";
  const applicant = identity.applicant ?? roleFromDocuments(documents, "Applicant") ?? developer;
  const primaryObjective = primaryObjectiveFor(documents, scope);

  return {
    project_summary: summaryFromEvidence(opportunity, documents, scope),
    associated_improvements: associatedImprovements,
    related_development: relatedDevelopment,
    developer,
    applicant,
    owner: identity.owner ?? "Unknown",
    work_categories: scope?.work_categories ?? [],
    primary_objective: primaryObjective,
    scope_summary: scope?.scope_summary ?? "No source-backed scope summary is available yet.",
    evidence_summary: evidenceSummaryFor(documents),
    evidence_sources: support,
    supporting_evidence: support.map((item) => item.label),
    evidence_fence_signals: evidenceSignals.positive,
    evidence_negative_signals: evidenceSignals.negative,
    why_fencing_is_relevant: whyFenceEvidenceMatters(contradiction, evidenceSignals),
    confidence_reasoning: confidenceReasoningFor(contradiction, documents, evidenceSignals),
  };
}

function summaryFromEvidence(opportunity, documents, scope) {
  const best = documents[0];
  if (best?.summary) return best.summary;
  if (scope?.project_summary) return scope.project_summary;
  return `${opportunity.project_name} has limited source-backed evidence. Use the original opportunity record before making outreach decisions.`;
}

function associatedImprovementsFor(documents, scope) {
  const values = new Set(scope?.work_categories ?? []);
  const text = documents.map((document) => `${document.summary} ${document.trades.join(" ")}`).join(" ").toLowerCase();
  if (/road|street|access/i.test(text)) values.add("Roads / site access");
  if (/utility|sewer|water|power/i.test(text)) values.add("Utilities");
  if (/drainage|storm|creek|trunk/i.test(text)) values.add("Drainage");
  if (/park|trail|open space/i.test(text)) values.add("Parks / trails");
  if (/site work|earthwork|grading/i.test(text)) values.add("Site development");
  return [...values];
}

function relatedDevelopmentFor(documents) {
  const text = documents.map((document) => `${document.title} ${document.summary}`).join(" ");
  const units = text.match(/\b\d{2,5}\s+(?:planned\s+)?(?:residential\s+)?(?:units|homes|lots)\b/i);
  if (units) return units[0];
  if (/subdivision|village|residential|homes|lots/i.test(text)) return "Related residential development identified";
  return "Unknown";
}

function primaryObjectiveFor(documents, scope) {
  const text = documents.map((document) => `${document.summary} ${document.trades.join(" ")}`).join(" ").toLowerCase();
  if (/drainage|creek|storm|trunk/i.test(text)) return "Enable drainage, utility, or site infrastructure improvements.";
  if (/residential|homes|subdivision|village/i.test(text)) return "Enable future residential construction.";
  if (/park|trail|open space/i.test(text)) return "Support public access or recreation improvements.";
  if (scope?.scope_summary) return scope.scope_summary;
  return "Unknown";
}

function evidenceSummaryFor(documents) {
  if (!documents.length) return "No related public evidence has been connected beyond the original record.";
  return `${documents.length} related source-backed evidence record(s) connected: ${documents.map((document) => document.source_name).join(", ")}.`;
}

function whyFenceEvidenceMatters(contradiction, evidenceSignals) {
  if (contradiction.fence_scope_confidence === "No Meaningful Fence Opportunity") return "Collected evidence does not support a meaningful fencing opportunity.";
  if (contradiction.fence_scope_confidence === "Weak Signal") return "Fence relevance is weak; specific scope is intentionally withheld until stronger evidence is found.";
  return evidenceSignals.positive.length
    ? `Fence relevance is supported by: ${evidenceSignals.positive.map((signal) => `${signal.signal} (${signal.source})`).join("; ")}.`
    : "Fence relevance is inferred only from broader project categories; no direct fence evidence has been found.";
}

function confidenceReasoningFor(contradiction, documents, evidenceSignals) {
  return `${contradiction.fence_scope_confidence}: ${documents.length} related evidence record(s), ${evidenceSignals.positive.length} positive evidence signal(s), and ${evidenceSignals.negative.length} negative evidence signal(s).`;
}

function renderEvidenceExpansion(rows) {
  return [
    "# Evidence Expansion",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Opportunities evaluated: ${rows.length}`,
    `- Opportunities with related evidence: ${rows.filter((row) => row.related_evidence_count > 0).length}`,
    `- Evidence-backed fence signals: ${rows.reduce((sum, row) => sum + row.evidence_fence_signals.length, 0)}`,
    `- Contradiction notes: ${rows.reduce((sum, row) => sum + row.contradiction_notes.length, 0)}`,
    "",
    table(rows, [
      ["Project", (row) => row.project_identity.project_name],
      ["Developer", (row) => row.project_dossier.developer],
      ["Evidence Records", (row) => row.related_evidence_count],
      ["Fence Scope", (row) => row.fence_scope_confidence],
      ["Evidence Fence Score", (row) => row.evidence_fence_signal_score],
      ["Likely Fence Scope", (row) => row.likely_fence_scope],
      ["Why Fencing", (row) => row.why_fencing_is_relevant],
    ]),
  ].join("\n");
}

function renderProjectDossiers(rows) {
  return [
    "# Project Dossiers",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...rows.map((row) => [
      `## ${row.project_identity.project_name}`,
      "",
      `- Project Summary: ${row.project_dossier.project_summary}`,
      `- Associated Improvements: ${row.project_dossier.associated_improvements.join(", ") || "Unknown"}`,
      `- Related Development: ${row.project_dossier.related_development}`,
      `- Developer: ${row.project_dossier.developer}`,
      `- Applicant: ${row.project_dossier.applicant}`,
      `- Work Categories: ${row.project_dossier.work_categories.join(", ") || "Unknown"}`,
      `- Evidence Sources: ${row.project_dossier.supporting_evidence.join("; ") || "Unknown"}`,
      `- Fence Signals: ${row.evidence_fence_signals.map((signal) => `${signal.signal} (${signal.source})`).join("; ") || "None"}`,
      `- Why Fencing Is Relevant: ${row.why_fencing_is_relevant}`,
      `- Confidence Reasoning: ${row.project_dossier.confidence_reasoning}`,
      "",
    ].join("\n")),
  ].join("\n");
}

function evidenceReference(document) {
  return {
    id: document.evidence_document_id,
    label: `${document.source_name}: ${document.title}`,
    title: document.title,
    source_type: document.source_type,
    source_name: document.source_name,
    source_url: document.source_url,
    summary: document.summary,
  };
}

function extractNumber(value, pattern) {
  const match = String(value ?? "").match(pattern);
  return match?.[0] ?? null;
}

function known(value) {
  return value && value !== "Unknown" ? value : null;
}

function companyByType(companies, type) {
  return companies.find((company) => company.company_type === type)?.company_name ?? null;
}

function addressFrom(opportunity) {
  const location = String(opportunity.project_location ?? "");
  if (/\d+/.test(location)) return location;
  const nameAddress = String(opportunity.project_name ?? "").match(/\b\d{3,6}\s+[A-Z0-9][A-Z0-9\s.'-]+(?:RD|ROAD|ST|STREET|AVE|AVENUE|LN|LANE|DR|DRIVE|BLVD|COURT|CT)\b/i);
  return nameAddress?.[0] ?? null;
}

function normalizeProjectKey(...values) {
  const value = values.find(Boolean) ?? "";
  return String(value)
    .toLowerCase()
    .replace(/\b(area|r\d{2}|solar|digital|submittal|paper|review|lot|unit|phase)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(String(value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3 && !["area", "solar", "digital", "submittal", "paper", "review"].includes(token)));
}

function dedupeSignals(signals) {
  const seen = new Set();
  return signals.filter((signal) => {
    const key = `${signal.signal}|${signal.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function roleFromDocuments(documents, role) {
  return documents.flatMap((document) => document.companies).find((company) => company.role === role)?.name ?? null;
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
