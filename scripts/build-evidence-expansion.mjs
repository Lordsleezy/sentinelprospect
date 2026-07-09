import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const evidenceDocuments = await readJson("data/evidence_documents.json") ?? [];
const existingContactEvidence = await readJson("data/contact_source_evidence.json") ?? [];
const contractorOpportunities = await readJson("data/contractor_opportunities.json") ?? [];
const scopeIntelligence = await readJson("data/scope_intelligence.json") ?? [];
const sacramentoPermits = await readJson("data/sacramento-county-permits.json");
const placerRecords = await readJson("data/placer-county-records.json");
const capturedAt = new Date().toISOString();

validateEvidenceDocuments(evidenceDocuments);

const permitSourceDocuments = buildPermitSourceDocuments([
  ...(sacramentoPermits?.records ?? []),
  ...(placerRecords?.records ?? []),
], capturedAt);
const opportunitySourceDocuments = buildOpportunitySourceDocuments(contractorOpportunities, capturedAt);
const allEvidenceDocuments = [
  ...evidenceDocuments,
  ...permitSourceDocuments,
  ...opportunitySourceDocuments.filter((document) => !permitSourceDocuments.some((permit) => permit.id === document.id)),
];

const resolvedDocuments = allEvidenceDocuments.map((document) => ({
  ...document,
  captured_at: capturedAt,
}));
const curated_document_extraction_results = evidenceDocuments.map((document) => extractDocument(document, capturedAt));
const document_extraction_results = allEvidenceDocuments.map((document) => extractDocument(document, capturedAt));
const relationship_evidence = curated_document_extraction_results.flatMap((document) => document.relationships);
const extractionRows = curated_document_extraction_results.flatMap((document) => document.extractions);
const evidence_expansion = contractorOpportunities.map((opportunity) => buildEvidenceExpansion(opportunity, document_extraction_results));

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/evidence_documents_resolved.json", resolvedDocuments),
  writeJson("data/document_extraction_results.json", curated_document_extraction_results),
  writeJson("data/relationship_evidence.json", relationship_evidence),
  writeJson("data/evidence_expansion.json", evidence_expansion),
  writeFile(resolve("reports/evidence-coverage.md"), renderEvidenceCoverage(curated_document_extraction_results, extractionRows, relationship_evidence, existingContactEvidence)),
  writeFile(resolve("reports/relationship-evidence.md"), renderRelationshipEvidence(relationship_evidence)),
  writeFile(resolve("reports/document-extraction.md"), renderDocumentExtraction(curated_document_extraction_results)),
  writeFile(resolve("reports/evidence-expansion.md"), renderEvidenceExpansion(evidence_expansion)),
  writeFile(resolve("reports/project-dossiers.md"), renderProjectDossiers(evidence_expansion)),
]);

console.log(`Curated evidence documents processed: ${curated_document_extraction_results.length}.`);
console.log(`Source documents searched for snippets: ${document_extraction_results.length}.`);
console.log(`Document extractions: ${extractionRows.length}.`);
console.log(`Relationship evidence rows: ${relationship_evidence.length}.`);
console.log(`Evidence expansion dossiers: ${evidence_expansion.length}.`);
console.log(`Opportunities with fence snippets: ${evidence_expansion.filter((row) => (row.evidence_snippets ?? []).length > 0).length}.`);
console.log(`Total fence snippets: ${evidence_expansion.reduce((sum, row) => sum + (row.evidence_snippets ?? []).length, 0)}.`);

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

function buildPermitSourceDocuments(records, lastVerified) {
  return records.map((record) => {
    const project = record.normalized?.project;
    if (!project?.id || !project?.name) return null;
    const sourceUrl = record.sourceUrl ?? project.source_url;
    if (!safeUrl(sourceUrl)) return null;
    const description = cleanSourceDescription(project.description || "");
    const companies = [];
    if (record.normalized?.contactCompany?.name && safeText(record.normalized.contactCompany.name)) {
      companies.push({
        name: record.normalized.contactCompany.name,
        role: record.normalized.contactCompany.role === "contractor" ? "General Contractor" : "Known Contractor",
      });
    }
    return {
      id: project.id,
      title: `${project.external_id ?? project.id} ${record.normalized?.permit?.permit_type ?? "Permit"}`,
      source_type: "permit_record",
      source_name: project.source_name ?? record.sourceName ?? "Permit Record",
      source_url: sourceUrl,
      project_name: project.name,
      location: [project.city, project.county].filter(Boolean).join(", ") || "Unknown",
      summary: description || project.name,
      full_text: [project.name, description, record.payload?.WorkDescription, record.payload?.ProjectName].filter(Boolean).join(". "),
      companies,
      trades: record.normalized?.inferredTrades ?? [],
      relationships: [],
      award_information: null,
      captured_at: lastVerified,
    };
  }).filter(Boolean);
}

function buildOpportunitySourceDocuments(opportunities, lastVerified) {
  return opportunities.map((opportunity) => {
    if (!safeText(opportunity.id) || !safeText(opportunity.project_name) || !safeUrl(opportunity.source_url)) return null;
    const description = cleanSourceDescription(opportunity.project_description || "");
    return {
      id: `opportunity-source-${opportunity.id}`,
      title: opportunity.project_name,
      source_type: "opportunity_record",
      source_name: "Contractor Opportunity Record",
      source_url: opportunity.source_url,
      project_name: opportunity.project_name,
      location: opportunity.project_location ?? ([opportunity.city, opportunity.county].filter(Boolean).join(", ") || "Unknown"),
      summary: description || opportunity.project_name,
      full_text: [opportunity.project_name, description].filter(Boolean).join(". "),
      companies: (opportunity.companies ?? []).map((company) => ({
        name: company.company_name,
        role: company.company_type,
      })).filter((company) => safeText(company.name) && safeText(company.role)),
      trades: String(opportunity.trade ?? "").split(",").map((trade) => trade.trim()).filter(Boolean),
      relationships: [],
      award_information: null,
      captured_at: lastVerified,
    };
  }).filter(Boolean);
}

function cleanSourceDescription(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+New Building or Addition.*$/i, "")
    .replace(/\s+-\s+Miscellaneous,.*$/i, "")
    .trim();
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
    full_text: document.full_text ?? document.summary ?? "",
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
  const relatedEvidence = relatedDocuments(identity, documents, opportunity.id);
  const evidenceSignals = evidenceFenceSignals(relatedEvidence);
  const contradiction = contradictionStatus(scope, evidenceSignals);
  const projectDossier = projectDossierFor(opportunity, identity, relatedEvidence, scope, evidenceSignals, contradiction);

  return {
    opportunity_id: opportunity.id,
    project_identity: identity,
    related_evidence_count: relatedEvidence.length,
    related_evidence: relatedEvidence.map(evidenceReference),
    related_documents: relatedEvidence.map(evidenceReference),
    project_dossier: projectDossier,
    project_summary: projectDossier.project_summary,
    scope_summary: projectDossier.scope_summary,
    evidence_summary: projectDossier.evidence_summary,
    supporting_evidence: projectDossier.supporting_evidence,
    evidence_fence_signals: evidenceSignals.positive,
    evidence_negative_signals: evidenceSignals.negative,
    evidence_snippets: evidenceSignals.snippets,
    evidence_sources: projectDossier.evidence_sources,
    why_fencing_matters: projectDossier.why_fencing_is_relevant,
    evidence_fence_signal_score: evidenceSignals.score,
    evidence_strength_score: evidenceStrengthScore(relatedEvidence, evidenceSignals),
    source_count: relatedEvidence.length,
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

function relatedDocuments(identity, documents, opportunityId) {
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

  // Permit/opportunity source records may only attach to their own opportunity.
  // Fuzzy matching is reserved for curated public evidence documents.
  const selfMatches = documents.filter((document) =>
    document.evidence_document_id === opportunityId
    || document.evidence_document_id === `opportunity-source-${opportunityId}`
  );

  const curated = documents.filter((document) => !["permit_record", "opportunity_record"].includes(document.source_type));
  const scored = curated
    .map((document) => ({ document, score: evidenceMatchScore(document, identity, identityTerms) }))
    .filter((item) => item.score >= 20)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.document);

  const merged = [...selfMatches, ...scored];
  const seen = new Set();
  return merged.filter((document) => {
    if (seen.has(document.evidence_document_id)) return false;
    seen.add(document.evidence_document_id);
    return true;
  });
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
    const sourceText = documentSearchText(document);
    addSignal(positive, sourceText, /\bfenc(?:e|es|ing)\b/i, "Direct fence reference", document, isIntentionalFenceMention);
    addSignal(positive, sourceText, /\bgates?\b/i, "Gate reference", document, isIntentionalGateMention);
    addSignal(positive, sourceText, /\bperimeter(?:\s+(?:fence|fencing|security|wall))\b/i, "Perimeter or perimeter-security reference", document);
    addSignal(positive, sourceText, /access control|controlled access/i, "Access-control reference", document);
    addSignal(positive, sourceText, /\benclosure\b/i, "Enclosure reference", document);
    addSignal(positive, sourceText, /screen wall/i, "Screen-wall reference", document);
    addSignal(positive, sourceText, /retaining wall[^.]{0,80}\bfenc(?:e|ing)?\b|\bfenc(?:e|ing)?\b[^.]{0,80}retaining wall/i, "Retaining-wall fencing reference", document);
    addSignal(positive, sourceText, /detention basin[^.]{0,80}\bfenc(?:e|ing)?\b|\bfenc(?:e|ing)?\b[^.]{0,80}detention basin/i, "Detention basin fencing reference", document);
    addSignal(positive, sourceText, /park fencing|trail fencing|school fencing|sports field fencing/i, "Public facility fencing reference", document);
    addSignal(positive, sourceText, /chain[-\s]?link/i, "Chain-link fencing reference", document);
    addSignal(positive, sourceText, /ornamental iron|wrought iron/i, "Ornamental or wrought-iron reference", document);
    addSignal(positive, sourceText, /security barrier|bollards|security improvements/i, "Security barrier improvement reference", document);
    addSignal(negative, sourceText, /creek restoration|creek|water quality|drainage|stormwater|hydrology/i, "Creek, drainage, or water-quality work without fence reference", document);
    addSignal(negative, sourceText, /pipeline|utility relocation|water main|sewer|trunk/i, "Pipeline or utility work without fence reference", document);
    addSignal(negative, sourceText, /electrical upgrade|solar|photovoltaic|pv|energy storage/i, "Electrical or solar retrofit evidence", document);
    addSignal(negative, sourceText, /roof replacement|roof|reroof|tpo|membrane|capsheet/i, "Roof replacement evidence", document);
    addSignal(negative, sourceText, /hvac|mechanical|package unit|air conditioning/i, "HVAC-only replacement evidence", document);
    addSignal(negative, sourceText, /interior remodel|kitchen|bathroom|flooring|painting|tenant improvement/i, "Interior or tenant-improvement-only evidence", document);
  }
  const positiveSignals = dedupeSignals(positive);
  // Negative signals only suppress when no positive fence evidence exists.
  const negativeSignals = positiveSignals.length ? [] : dedupeSignals(negative);
  const score = Math.max(0, Math.min(100, positiveSignals.length * 28 - negativeSignals.length * 18));
  return { positive: positiveSignals, negative: negativeSignals, snippets: positiveSignals.map(signalToSnippet), score };
}

function addSignal(signals, text, pattern, label, document, validator = null) {
  const match = text.match(pattern);
  if (!match) return;
  const snippet = snippetForMatch(text, match.index ?? 0);
  if (validator && !validator(snippet, match[0])) return;
  signals.push({
    signal: label,
    snippet,
    source: document.title,
    source_document_id: document.evidence_document_id,
    source_url: document.source_url,
    source_type: document.source_type,
  });
}

function isIntentionalFenceMention(snippet) {
  const value = String(snippet ?? "").toLowerCase();
  if (/\b(install|raise|new|build|building|construct|provide|supply|replace|pool safety|security fence|fence height|fencing with|gates\/fence|new fence|permit for fence|fence built)\b/i.test(value)) return true;
  if (/\b(behind|in front of)\b[^.]*\bfence\b|\bfrom (?:the )?fence\/property line\b|\bfor fence or structure\b|\bfence note revised\b|\btowards back fence\b|\bthere is a fence\b|\bremove the fence\b|\bif needed only\b/i.test(value)) return false;
  if (/\bhvac\b|\bsewer\b|\bsolar\b|\bcarport\b|\baddition and remodel\b|\bpipe burst\b|\binversion liner\b/i.test(value) && !/\b(fence|fencing)\b.{0,40}\b(install|new|raise|build|provide|permit)\b|\b(install|new|raise|build|provide|permit).{0,40}\b(fence|fencing)\b/i.test(value)) return false;
  return /\b(fence|fences|fencing)\b/i.test(value);
}

function isIntentionalGateMention(snippet) {
  const value = String(snippet ?? "").toLowerCase();
  if (/golden\s+gate/.test(value)) return false;
  if (/a-gate/.test(value)) return false;
  if (/\b(ave|avenue|rd|road|st|street|blvd|drive|dr|way|ln|lane)\b/.test(value) && !/\b(install|new|build|automatic|sliding|security|entry|ped|vehicle|fence|gates?)\b.{0,40}\bgates?\b|\bgates?\b.{0,40}\b(install|new|build|automatic|sliding|security|entry|ped|vehicle|fence)\b/i.test(value)) {
    // Street-name only mentions such as "Golden Gate Ave" already rejected; plain "Gate Ave" style leftovers.
    if (!/\b(new\s*\(?gates?|install|sliding gate|automatic gate|entry gate|security gate|ped gate|vehicle gate)\b/i.test(value)) return false;
  }
  if (/\b(hvac|solar|battery|reroof|roof|sewer|pipe burst)\b/i.test(value) && !/\b(install|new|build|automatic|sliding|security|entry|ped|vehicle|fence)\b/i.test(value)) return false;
  return /\bgates?\b/i.test(value);
}

function contradictionStatus(scope, evidenceSignals) {
  let fenceScopeConfidence = normalizeFenceConfidence(scope?.fence_scope_confidence ?? "No Evidence");
  let likelyFenceScope = scope?.potential_fencing_scope?.[0] ?? "Unknown";
  const notes = [];

  if (evidenceSignals.positive.length) {
    if (evidenceSignals.score >= 72 || evidenceSignals.positive.length >= 2) {
      fenceScopeConfidence = fenceScopeConfidence === "Primary Opportunity" ? "Primary Opportunity" : "Secondary Opportunity";
      notes.push("Direct fence evidence from source documents supports fencing scope.");
    } else {
      fenceScopeConfidence = ["Primary Opportunity", "Secondary Opportunity"].includes(fenceScopeConfidence)
        ? fenceScopeConfidence
        : "Possible Opportunity";
      notes.push("Direct fence evidence raised classification above No Evidence.");
    }
    likelyFenceScope = scope?.potential_fencing_scope?.[0]
      ?? (/\bgate/i.test(evidenceSignals.positive.map((signal) => signal.signal).join(" ")) ? "Gates and access control" : "Source-backed fencing scope");
  } else if (evidenceSignals.score >= 72 && ["Weak Opportunity", "No Evidence"].includes(fenceScopeConfidence)) {
    fenceScopeConfidence = "Possible Opportunity";
    notes.push("Direct fence evidence raised a weak/no-evidence classification to possible opportunity.");
  }
  if (evidenceSignals.negative.length && evidenceSignals.positive.length === 0) {
    fenceScopeConfidence = "No Evidence";
    notes.push("Negative evidence without positive fence evidence suppresses fence scope.");
  }
  if (fenceScopeConfidence === "Weak Opportunity") {
    likelyFenceScope = "Insufficient evidence to determine likely fencing scope.";
    notes.push("Weak Opportunity cannot generate a specific fencing scope.");
  }
  if (fenceScopeConfidence === "No Evidence") {
    likelyFenceScope = "No fencing scope generated.";
    notes.push("No Evidence suppresses fencing scope generation.");
  }
  return { fence_scope_confidence: fenceScopeConfidence, likely_fence_scope: likelyFenceScope, notes };
}

function normalizeFenceConfidence(value) {
  const map = {
    "Primary Scope": "Primary Opportunity",
    "Secondary Scope": "Secondary Opportunity",
    "Possible Scope": "Possible Opportunity",
    "Weak Signal": "Weak Opportunity",
    "No Meaningful Fence Opportunity": "No Evidence",
  };
  return map[value] ?? value;
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
    evidence_snippets: evidenceSignals.snippets,
    why_fencing_is_relevant: whyFenceEvidenceMatters(contradiction, evidenceSignals, associatedImprovements),
    why_fencing_matters: whyFenceEvidenceMatters(contradiction, evidenceSignals, associatedImprovements),
    confidence_reasoning: confidenceReasoningFor(contradiction, documents, evidenceSignals),
  };
}

function summaryFromEvidence(opportunity, documents, scope) {
  const best = documents[0];
  const sourceText = best ? documentSearchText(best) : "";
  const unitMatch = sourceText.match(/\b\d{1,5}\s+(?:planned\s+)?(?:residential\s+)?(?:lots|homes|units|apartments)\b/i);
  const improvements = associatedImprovementsFor(documents, scope).map((item) => item.toLowerCase());
  const cleanedOpportunityDescription = cleanSourceDescription(opportunity.project_description || "");
  if (cleanedOpportunityDescription && /\bfenc|\bgate/i.test(cleanedOpportunityDescription)) return cleanedOpportunityDescription;
  if (best?.summary && /\bfenc|\bgate/i.test(best.summary)) return cleanSourceDescription(best.summary);
  if (unitMatch && improvements.length) return `${unitMatch[0]} project including ${toSentenceList(improvements)}.`;
  if (unitMatch) return `${unitMatch[0]} project with source-backed development evidence.`;
  if (cleanedOpportunityDescription) return cleanedOpportunityDescription;
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

function evidenceStrengthScore(documents, evidenceSignals) {
  const sourceTypeScore = new Set(documents.map((document) => document.source_type)).size * 8;
  const sourceCountScore = Math.min(40, documents.length * 10);
  const positiveSignalScore = Math.min(35, evidenceSignals.positive.length * 5);
  const negativePenalty = Math.min(30, evidenceSignals.negative.length * 10);
  return Math.max(0, Math.min(100, sourceCountScore + sourceTypeScore + positiveSignalScore - negativePenalty));
}

function whyFenceEvidenceMatters(contradiction, evidenceSignals, associatedImprovements = []) {
  if (contradiction.fence_scope_confidence === "No Evidence") return "No direct fencing references found. Additional document review is required before treating this as a fencing opportunity.";
  if (contradiction.fence_scope_confidence === "Weak Opportunity") return "Fence relevance is weak; specific scope is intentionally withheld until stronger evidence is found.";
  if (!evidenceSignals.positive.length) return "No direct fencing references found. Treat fencing as unconfirmed until stronger evidence is connected.";
  const top = evidenceSignals.positive[0];
  const snippet = top?.snippet;
  if (snippet) {
    if (/detention basin/i.test(snippet)) {
      return `Detention basin construction often requires perimeter safety fencing. Source document references: "${snippet}"`;
    }
    if (/school/i.test(snippet)) {
      return `School site improvements commonly include perimeter fencing and controlled access points. Source: "${snippet}"`;
    }
    if (/\bgates?\b/i.test(snippet) && /\bfenc/i.test(snippet)) {
      return `Source document specifies gate and fencing installation: "${snippet}"`;
    }
    if (/\bgates?\b/i.test(snippet)) {
      return `Source document references gate work that is fencing-relevant: "${snippet}"`;
    }
    const improvementContext = associatedImprovements.length ? `${toSentenceList(associatedImprovements.map((item) => item.toLowerCase()))} scope is documented. ` : "";
    return `${improvementContext}Fence relevance is supported by source evidence: "${snippet}" (${top.source}).`;
  }
  const improvementContext = associatedImprovements.length ? `${toSentenceList(associatedImprovements.map((item) => item.toLowerCase()))} scope is documented. ` : "";
  return `${improvementContext}Fence relevance is supported by source snippets: ${evidenceSignals.positive.map((signal) => `"${signal.snippet}" (${signal.source})`).join("; ")}.`;
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
      `- Fence Signals: ${row.evidence_fence_signals.map((signal) => `${signal.signal}: ${signal.snippet} (${signal.source})`).join("; ") || "None"}`,
      `- Evidence Snippets: ${row.evidence_snippets.map((snippet) => `${snippet.snippet} (${snippet.source})`).join("; ") || "None"}`,
      `- Why Fencing Is Relevant: ${row.why_fencing_is_relevant}`,
      `- Confidence Reasoning: ${row.project_dossier.confidence_reasoning}`,
      "",
    ].join("\n")),
  ].join("\n");
}

function documentSearchText(document) {
  // Intentionally exclude inferred trade labels so "Fencing" trade tags cannot create fake fence evidence.
  return [
    document.project_name,
    document.title,
    document.summary,
    document.full_text,
    document.award_information,
    ...(document.relationships ?? []).map((relationship) => relationship.evidence_summary),
  ].filter(Boolean).join(". ");
}

function snippetForMatch(text, index) {
  const start = Math.max(0, text.lastIndexOf(".", index - 1) + 1);
  const nextPeriod = text.indexOf(".", index);
  const end = nextPeriod === -1 ? Math.min(text.length, index + 180) : nextPeriod + 1;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function signalToSnippet(signal) {
  return {
    text: signal.snippet,
    snippet: signal.snippet,
    signal: signal.signal,
    source: signal.source,
    source_document: signal.source,
    source_document_id: signal.source_document_id,
    source_url: signal.source_url,
    source_type: signal.source_type,
    confidence: "direct",
  };
}

function toSentenceList(values) {
  const clean = [...new Set(values.filter(Boolean))];
  if (clean.length <= 1) return clean[0] ?? "";
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean.at(-1)}`;
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
    const key = `${signal.signal}|${normalizeSnippetKey(signal.snippet)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSnippetKey(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
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
