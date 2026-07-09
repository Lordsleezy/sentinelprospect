import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const cacheFiles = [
  "data/sacramento-county-permits.json",
  "data/placer-county-records.json",
  "data/samgov-opportunities.json",
];

const caches = (await Promise.all(cacheFiles.map(readJson))).filter(Boolean);
const sourceRecords = caches.flatMap((cache) => cache.records ?? []);
const documentExtractions = await readJson("data/document_extraction_results.json") ?? [];
const companyProfiles = await readJson("data/company_profiles.json") ?? [];
const companyBehavior = await readJson("data/company_behavior.json") ?? [];
const procurementPaths = await readJson("data/company_procurement_paths.json") ?? [];
const contactResults = await readJson("data/contact_resolution_results.json") ?? [];
const relationshipEdges = await readJson("data/relationship_graph_edges.json") ?? [];
const capturedAt = new Date().toISOString();

const profilesByName = new Map(companyProfiles.map((profile) => [normalizeName(profile.company_name), profile]));
const profilesById = new Map(companyProfiles.map((profile) => [profile.id, profile]));
const pathsByCompany = groupBy(procurementPaths, (path) => path.company_profile_id);
const contactsByProject = groupBy(contactResults.filter((contact) => contact.status === "source_backed_contact"), (contact) => contact.project_external_id ?? normalizeName(contact.project_name));
const relationshipEdgesByProject = groupRelationshipsByProject(relationshipEdges);

const opportunities = [
  ...sourceRecords.map(recordOpportunity).filter(Boolean),
  ...documentExtractions.map(documentOpportunity).filter(Boolean),
].sort((a, b) => b.qualification_score - a.qualification_score || b.evidence_count - a.evidence_count || a.project_name.localeCompare(b.project_name));

const topCompanies = buildTopCompanies(opportunities);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/opportunity_qualification_results.json", opportunities),
  writeJson("data/top_20_companies.json", topCompanies),
  writeFile(resolve("reports/qualified-opportunities.md"), renderQualifiedOpportunities(opportunities)),
  writeFile(resolve("reports/high-confidence-opportunities.md"), renderHighConfidenceOpportunities(opportunities)),
  writeFile(resolve("reports/fencing-opportunities.md"), renderFencingOpportunities(opportunities)),
  writeFile(resolve("reports/fast-money-opportunities.md"), renderFastMoneyOpportunities(opportunities)),
  writeFile(resolve("reports/top-20-companies.md"), renderTopCompanies(topCompanies)),
]);

console.log(`Qualified opportunity rows: ${opportunities.length}.`);
console.log(`Qualified: ${opportunities.filter((row) => row.opportunity_state === "Qualified").length}.`);
console.log(`Needs research: ${opportunities.filter((row) => row.opportunity_state === "Needs Research").length}.`);
console.log(`Fencing opportunities: ${opportunities.filter((row) => row.fencing_signal_presence).length}.`);

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

function recordOpportunity(record) {
  const project = record.normalized?.project;
  if (!project) return null;
  const company = record.normalized?.contactCompany?.name ? profilesByName.get(normalizeName(record.normalized.contactCompany.name)) : null;
  const companies = company ? [company] : [];
  const trades = normalizedTrades(record.normalized?.inferredTrades);
  const contacts = contactsForProject(project.external_id, project.name);
  const relationships = relationshipsForProject(project.name);
  const companyPaths = companies.flatMap((profile) => pathsByCompany.get(profile.id) ?? []);
  const evidenceCount = evidenceCountForRecord(record, contacts, relationships, companyPaths);
  const evidenceQuality = evidenceQualityForRecord(record, evidenceCount, contacts, companyPaths, relationships);
  const factors = qualificationFactors({
    contacts,
    companyPaths,
    companies,
    relationships,
    trades,
    projectStage: stageFromProject(project, record.normalized?.permit),
    evidenceQuality,
    fastMoneyPotential: fastMoneyPotential(project, trades, contacts, companyPaths),
  });

  return buildOpportunity({
    id: project.id,
    project_name: project.name,
    project_description: project.description ?? "",
    location: locationLabel(project.city, project.county, project.state),
    trade: trades.join(", ") || "Unknown",
    source_type: record.sourceName ?? project.source_name ?? "Collector Record",
    source_url: record.sourceUrl ?? project.source_url,
    project_stage: factors.project_stage,
    companies,
    contacts,
    companyPaths,
    relationships,
    evidence_count: evidenceCount,
    evidence_quality: evidenceQuality,
    factors,
  });
}

function documentOpportunity(document) {
  const companies = (document.companies ?? [])
    .map((company) => profilesByName.get(normalizeName(company.name)))
    .filter(Boolean);
  const trades = normalizedTrades(document.trades);
  const companyPaths = companies.flatMap((profile) => pathsByCompany.get(profile.id) ?? []);
  const contacts = contactsForProject(null, document.project_name);
  const relationships = relationshipsForProject(document.project_name);
  const evidenceCount = document.evidence_count ?? (document.extractions?.length ?? 1);
  const evidenceQuality = evidenceQualityForDocument(document, evidenceCount, companyPaths, relationships);
  const factors = qualificationFactors({
    contacts,
    companyPaths,
    companies,
    relationships,
    trades,
    projectStage: stageFromDocument(document),
    evidenceQuality,
    fastMoneyPotential: fastMoneyPotential(document, trades, contacts, companyPaths),
  });

  return buildOpportunity({
    id: document.evidence_document_id,
    project_name: document.project_name,
    project_description: document.summary ?? "",
    location: document.location,
    trade: trades.join(", ") || "Unknown",
    source_type: document.source_type,
    source_url: document.source_url,
    project_stage: factors.project_stage,
    companies,
    contacts,
    companyPaths,
    relationships,
    evidence_count: evidenceCount,
    evidence_quality: evidenceQuality,
    factors,
  });
}

function buildOpportunity(input) {
  const score = qualificationScore(input.factors);
  return {
    id: input.id,
    project_name: input.project_name,
    project_description: input.project_description ?? "",
    location: input.location,
    trade: input.trade,
    opportunity_state: opportunityState(score, input.factors),
    qualification_score: score,
    contact_availability: input.factors.contact_availability,
    procurement_path_availability: input.factors.procurement_path_availability,
    known_developer: input.factors.known_developer,
    known_gc: input.factors.known_gc,
    known_relationships: input.factors.known_relationships,
    fencing_signal_presence: input.factors.fencing_signal_presence,
    project_stage: input.project_stage,
    evidence_quality: input.evidence_quality,
    fast_money_potential: input.factors.fast_money_potential,
    evidence_count: input.evidence_count,
    companies: input.companies.map((company) => ({
      company_profile_id: company.id,
      company_name: company.company_name,
      company_type: company.company_type,
    })),
    procurement_paths: input.companyPaths.map((path) => ({
      company_profile_id: path.company_profile_id,
      company_name: profilesById.get(path.company_profile_id)?.company_name ?? path.company_profile_id,
      path_type: path.path_type,
      contractor_value: path.contractor_value,
      confidence: path.confidence,
      path_url: path.path_url,
    })),
    contacts: input.contacts.map((contact) => ({
      company_name: contact.company_name,
      contact_name: contact.contact_name,
      contact_title: contact.contact_title,
      phone: contact.phone,
      confidence: contact.confidence,
    })),
    relationships: input.relationships.map((relationship) => ({
      from: nodeName(relationship.from_node_id),
      to: nodeName(relationship.to_node_id),
      relationship_type: relationship.relationship_type,
      evidence_count: relationship.evidence_count,
      confidence: relationship.confidence,
    })),
    source_type: input.source_type,
    source_url: input.source_url,
    last_verified: capturedAt,
  };
}

function qualificationFactors({ contacts, companyPaths, companies, relationships, trades, projectStage, evidenceQuality, fastMoneyPotential }) {
  const developer = companies.find((company) => company.company_type === "Developer");
  const gc = companies.find((company) => company.company_type === "General Contractor");
  return {
    contact_availability: contacts.length ? "Available" : "Unknown",
    procurement_path_availability: companyPaths.some((path) => ["High", "Medium"].includes(path.contractor_value)) ? "Available" : "Unknown",
    known_developer: developer?.company_name ?? "Unknown",
    known_gc: gc?.company_name ?? "Unknown",
    known_relationships: relationships.length ? "Yes" : "No",
    fencing_signal_presence: trades.some((trade) => /^fencing$/i.test(trade)),
    project_stage: projectStage,
    evidence_quality: evidenceQuality,
    fast_money_potential: fastMoneyPotential,
  };
}

function qualificationScore(factors) {
  let score = 0;
  if (factors.contact_availability === "Available") score += 18;
  if (factors.procurement_path_availability === "Available") score += 18;
  if (factors.known_developer !== "Unknown") score += 12;
  if (factors.known_gc !== "Unknown") score += 12;
  if (factors.known_relationships === "Yes") score += 10;
  if (factors.fencing_signal_presence) score += 14;
  if (["Active", "Planning"].includes(factors.project_stage)) score += 8;
  else if (factors.project_stage === "Early") score += 4;
  if (factors.evidence_quality === "High") score += 8;
  else if (factors.evidence_quality === "Medium") score += 5;
  if (factors.fast_money_potential === "High") score += 10;
  else if (factors.fast_money_potential === "Medium") score += 5;
  return Math.min(100, score);
}

function opportunityState(score, factors) {
  if (score >= 70 && (factors.contact_availability === "Available" || factors.procurement_path_availability === "Available")) return "Qualified";
  if (score >= 45) return "Needs Research";
  if (factors.project_stage === "Early" || factors.known_developer !== "Unknown" || factors.fencing_signal_presence) return "Early Signal";
  if (score >= 20) return "Low Confidence";
  return "Internal Only";
}

function buildTopCompanies(opportunities) {
  const rows = companyProfiles.map((profile) => {
    const behavior = companyBehavior.find((row) => row.company_profile_id === profile.id);
    const companyOpportunities = opportunities.filter((opportunity) => opportunity.companies.some((company) => company.company_profile_id === profile.id));
    const paths = pathsByCompany.get(profile.id) ?? [];
    const fencingSignals = companyOpportunities.filter((opportunity) => opportunity.fencing_signal_presence).length
      + ((behavior?.known_trades ?? []).find((trade) => trade.name === "Fencing")?.count ?? 0);
    return {
      company_profile_id: profile.id,
      company_name: profile.company_name,
      company_type: profile.company_type,
      project_count: behavior?.project_count ?? profile.metadata?.collector_project_count ?? 0,
      evidence_count: behavior?.evidence_count ?? profile.source_count ?? 0,
      procurement_paths: paths.length,
      fencing_signals: fencingSignals,
      qualified_opportunities: companyOpportunities.filter((opportunity) => opportunity.opportunity_state === "Qualified").length,
      needs_research_opportunities: companyOpportunities.filter((opportunity) => opportunity.opportunity_state === "Needs Research").length,
      best_procurement_path: bestPath(paths)?.path_type ?? "Unknown",
      confidence: profile.profile_confidence,
    };
  });

  return rows
    .sort((a, b) =>
      b.project_count - a.project_count ||
      b.evidence_count - a.evidence_count ||
      b.procurement_paths - a.procurement_paths ||
      b.fencing_signals - a.fencing_signals ||
      b.qualified_opportunities - a.qualified_opportunities ||
      a.company_name.localeCompare(b.company_name)
    )
    .slice(0, 20);
}

function renderQualifiedOpportunities(rows) {
  const visible = rows.filter((row) => ["Qualified", "Needs Research"].includes(row.opportunity_state));
  return [
    "# Qualified Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Opportunities evaluated: ${rows.length}`,
    `- Qualified: ${rows.filter((row) => row.opportunity_state === "Qualified").length}`,
    `- Needs Research: ${rows.filter((row) => row.opportunity_state === "Needs Research").length}`,
    `- Internal Only: ${rows.filter((row) => row.opportunity_state === "Internal Only").length}`,
    "",
    table(visible, opportunityColumns()),
  ].join("\n");
}

function renderHighConfidenceOpportunities(rows) {
  const visible = rows.filter((row) => (row.evidence_quality === "High" || row.qualification_score >= 70) && !["Low Confidence", "Internal Only"].includes(row.opportunity_state));
  return [
    "# High Confidence Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(visible, opportunityColumns()),
  ].join("\n");
}

function renderFencingOpportunities(rows) {
  const visible = rows.filter((row) => row.fencing_signal_presence);
  return [
    "# Fencing Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(visible, opportunityColumns()),
  ].join("\n");
}

function renderFastMoneyOpportunities(rows) {
  const visible = rows.filter((row) => ["High", "Medium"].includes(row.fast_money_potential) && ["Qualified", "Needs Research", "Early Signal"].includes(row.opportunity_state));
  return [
    "# Fast Money Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(visible, opportunityColumns()),
  ].join("\n");
}

function renderTopCompanies(rows) {
  return [
    "# Top 20 Companies",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows, [
      ["Company", (row) => row.company_name],
      ["Type", (row) => row.company_type],
      ["Projects", (row) => row.project_count],
      ["Evidence Count", (row) => row.evidence_count],
      ["Procurement Paths", (row) => row.procurement_paths],
      ["Fencing Signals", (row) => row.fencing_signals],
      ["Qualified Opportunities", (row) => row.qualified_opportunities],
      ["Needs Research", (row) => row.needs_research_opportunities],
      ["Best Path", (row) => row.best_procurement_path],
      ["Confidence", (row) => pct(row.confidence)],
    ]),
  ].join("\n");
}

function opportunityColumns() {
  return [
    ["Project", (row) => row.project_name],
    ["Location", (row) => row.location],
    ["Trade", (row) => row.trade],
    ["State", (row) => row.opportunity_state],
    ["Score", (row) => row.qualification_score],
    ["Contact", (row) => row.contact_availability],
    ["Procurement Path", (row) => row.procurement_path_availability],
    ["Developer", (row) => row.known_developer],
    ["GC", (row) => row.known_gc],
    ["Relationships", (row) => row.known_relationships],
    ["Stage", (row) => row.project_stage],
    ["Evidence", (row) => `${row.evidence_quality} (${row.evidence_count})`],
    ["Fast Money", (row) => row.fast_money_potential],
    ["Source", (row) => row.source_url],
  ];
}

function evidenceCountForRecord(record, contacts, relationships, paths) {
  let count = 1;
  if (record.normalized?.contactCompany?.name) count += 1;
  count += normalizedTrades(record.normalized?.inferredTrades).length;
  count += contacts.length;
  count += relationships.length;
  count += paths.length;
  return count;
}

function evidenceQualityForRecord(record, evidenceCount, contacts, paths, relationships) {
  const sourceConfidence = Number(record.normalized?.evidence?.confidence) || 0.5;
  if (evidenceCount >= 5 && sourceConfidence >= 0.8 && (contacts.length || paths.length || relationships.length)) return "High";
  if (evidenceCount >= 3 && sourceConfidence >= 0.7) return "Medium";
  return "Low";
}

function evidenceQualityForDocument(document, evidenceCount, paths, relationships) {
  if (evidenceCount >= 6 && (paths.length || relationships.length || document.relationships?.length)) return "High";
  if (evidenceCount >= 4) return "Medium";
  return "Low";
}

function fastMoneyPotential(project, trades, contacts, paths) {
  const blob = `${project.project_name ?? project.name ?? ""} ${project.summary ?? ""} ${project.description ?? ""} ${project.project_stage ?? ""}`.toLowerCase();
  const hasAccess = contacts.length || paths.some((path) => ["High", "Medium"].includes(path.contractor_value));
  const tradeFit = trades.some((trade) => /fenc|gate|repair|roofing|site work|earthwork|utilities/i.test(trade)) || /repair|gate|fenc|roof|overlay|patio|deck|drainage|site/i.test(blob);
  if (hasAccess && tradeFit) return "High";
  if (tradeFit) return "Medium";
  return "Low";
}

function stageFromProject(project, permit) {
  const status = `${project.status ?? ""} ${permit?.permit_status ?? ""}`.toLowerCase();
  if (/issued|active|approved/.test(status)) return "Active";
  if (/application|received|planning|review/.test(status)) return "Planning";
  if (/agenda|filed|proposed/.test(status)) return "Early";
  if (/final|complete|closed/.test(status)) return "Internal Only";
  return "Unknown";
}

function stageFromDocument(document) {
  if (["board_agenda", "meeting_minutes", "environmental_document", "planning_application", "construction_news"].includes(document.source_type)) return "Early";
  if (document.source_type === "project_website") return "Active";
  return "Unknown";
}

function contactsForProject(externalId, projectName) {
  return [
    ...(externalId ? contactsByProject.get(externalId) ?? [] : []),
    ...(contactsByProject.get(normalizeName(projectName)) ?? []),
  ].filter((contact, index, items) => items.findIndex((item) => item.id === contact.id) === index);
}

function relationshipsForProject(projectName) {
  return relationshipEdgesByProject.get(normalizeName(projectName)) ?? [];
}

function groupRelationshipsByProject(edges) {
  const groups = new Map();
  for (const edge of edges.filter((item) => isOrganizationRelationship(item.relationship_type))) {
    for (const project of edge.projects ?? []) {
      const key = normalizeName(project.project_name);
      groups.set(key, [...(groups.get(key) ?? []), edge]);
    }
  }
  return groups;
}

function isOrganizationRelationship(type) {
  return ["developer_gc", "developer_architect", "developer_engineer", "developer_property_owner", "gc_trade_contractor", "developer_trade_contractor"].includes(type);
}

function bestPath(paths) {
  const rank = { High: 3, Medium: 2, Low: 1 };
  return [...paths].sort((a, b) => rank[b.contractor_value] - rank[a.contractor_value] || b.confidence - a.confidence)[0] ?? null;
}

function nodeName(nodeId) {
  const [, rawName] = String(nodeId).split(":");
  const profile = profilesByName.get(normalizeName(rawName));
  return profile?.company_name ?? titleize(rawName ?? nodeId);
}

function normalizedTrades(trades) {
  return [...new Set((Array.isArray(trades) ? trades : ["General"]).filter(Boolean))].sort();
}

function locationLabel(city, county, state) {
  return [city, county, state].filter(Boolean).join(", ") || "Unknown";
}

function groupBy(items, fn) {
  const groups = new Map();
  for (const item of items) {
    const key = fn(item);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function normalizeName(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|incorporated|company|co|limited|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (normalized.includes("lennar")) return "lennar homes of california";
  if (normalized.includes("kevin l cook architect")) return "kevin l cook architect";
  if (normalized.includes("lund construction")) return "lund construction";
  if (normalized.includes("taylor morrison")) return "taylor morrison of california";
  if (normalized.includes("integral communities")) return "integral communities";
  return normalized;
}

function titleize(value) {
  return String(value ?? "Unknown")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
