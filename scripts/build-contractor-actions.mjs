import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const opportunities = await readJson("data/opportunity_qualification_results.json") ?? [];
const topCompanies = await readJson("data/top_20_companies.json") ?? [];
const companyProfiles = await readJson("data/company_profiles.json") ?? [];
const procurementPaths = await readJson("data/company_procurement_paths.json") ?? [];
const relationshipEdges = await readJson("data/relationship_graph_edges.json") ?? [];
const capturedAt = new Date().toISOString();

const profilesById = new Map(companyProfiles.map((profile) => [profile.id, profile]));
const pathsByCompany = groupBy(procurementPaths, (path) => path.company_profile_id);

const qualified = opportunities.filter((opportunity) => opportunity.opportunity_state === "Qualified");
const dossiers = qualified.map(buildDossier).sort((a, b) => b.actionability_score - a.actionability_score || b.qualification_score - a.qualification_score);
const actionable = dossiers.filter((dossier) => dossier.recommended_action !== "Not Actionable" && dossier.recommended_action !== "Wait For Additional Evidence");
const topFence = dossiers
  .filter((dossier) => dossier.fencing_signals === "Yes" || /fenc|gate/i.test(dossier.trade))
  .sort((a, b) => b.actionability_score - a.actionability_score || b.fast_money_score - a.fast_money_score);
const expandedCompanies = expandTopCompanies(topCompanies, dossiers);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/qualified_opportunity_dossiers.json", dossiers),
  writeJson("data/opportunity_action_plans.json", dossiers.map(actionPlanRow)),
  writeJson("data/top_20_companies.json", expandedCompanies),
  writeFile(resolve("reports/qualified-opportunity-dossiers.md"), renderDossiers(dossiers)),
  writeFile(resolve("reports/actionable-opportunities.md"), renderActionable(actionable)),
  writeFile(resolve("reports/opportunity-action-plans.md"), renderActionPlans(dossiers)),
  writeFile(resolve("reports/top-fence-opportunities.md"), renderTopFence(topFence)),
  writeFile(resolve("reports/top-20-companies.md"), renderTopCompanies(expandedCompanies)),
]);

console.log(`Qualified dossiers: ${dossiers.length}.`);
console.log(`Actionable opportunities: ${actionable.length}.`);
console.log(`Top fence opportunities: ${topFence.length}.`);

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

function buildDossier(opportunity) {
  const developer = companyByType(opportunity, "Developer");
  const gc = companyByType(opportunity, "General Contractor");
  const architect = companyByType(opportunity, "Architect");
  const engineer = companyByType(opportunity, "Engineer");
  const bestPath = bestProcurementPath(opportunity.procurement_paths);
  const knownContact = bestContact(opportunity.contacts);
  const route = contactRoute(opportunity, knownContact, bestPath);
  const relationships = opportunity.relationships ?? [];
  const actionabilityScore = actionabilityScoreFor(opportunity, knownContact, bestPath, relationships);
  const recommendedAction = recommendedActionFor(opportunity, knownContact, bestPath, relationships);
  const exactNextStep = exactNextStepFor(opportunity, recommendedAction, knownContact, bestPath);
  const { city, county } = locationParts(opportunity.location);

  return {
    id: opportunity.id,
    project_name: opportunity.project_name,
    project_location: opportunity.location,
    city,
    county,
    developer: developer?.company_name ?? "Unknown",
    general_contractor: gc?.company_name ?? "Unknown",
    architect: architect?.company_name ?? "Unknown",
    engineer: engineer?.company_name ?? "Unknown",
    known_relationships: relationships.length ? relationships.map((relationship) => `${relationship.from} -> ${relationship.to} (${relationship.relationship_type}, ${pct(relationship.confidence)})`) : ["Unknown"],
    evidence_sources: [opportunity.source_url, ...new Set(relationships.flatMap((relationship) => relationship.source_urls ?? []))].filter(Boolean),
    procurement_paths: opportunity.procurement_paths.length ? opportunity.procurement_paths : [],
    fencing_signals: opportunity.fencing_signal_presence ? "Yes" : "No",
    fast_money_score: fastMoneyScore(opportunity.fast_money_potential),
    qualification_score: opportunity.qualification_score,
    confidence: confidenceFor(opportunity, knownContact, bestPath, relationships),
    actionability_score: actionabilityScore,
    recommended_action: recommendedAction,
    exact_next_step: exactNextStep,
    contact_route: route,
    source_evidence: opportunity.source_url,
    evidence_quality: opportunity.evidence_quality,
    evidence_count: opportunity.evidence_count,
    project_stage: opportunity.project_stage,
    trade: opportunity.trade,
    last_verified: capturedAt,
  };
}

function actionabilityScoreFor(opportunity, contact, path, relationships) {
  let score = 0;
  if (path && ["High", "Medium"].includes(path.contractor_value)) score += 24;
  if (contact?.phone || contact?.contact_name || contact?.resolved_website) score += 22;
  if (opportunity.evidence_quality === "High") score += 16;
  else if (opportunity.evidence_quality === "Medium") score += 10;
  if (relationships.length) score += Math.min(14, relationships.reduce((sum, relationship) => sum + Math.round((relationship.confidence ?? 0.5) * 6), 0));
  if (opportunity.opportunity_state === "Qualified") score += 12;
  if (opportunity.fencing_signal_presence) score += 8;
  if (opportunity.fast_money_potential === "High") score += 12;
  else if (opportunity.fast_money_potential === "Medium") score += 6;
  return Math.min(100, score);
}

function recommendedActionFor(opportunity, contact, path, relationships) {
  if (contact?.phone && contact?.contact_name && contact.company_name === opportunity.known_developer) return "Call Developer";
  if (contact?.phone && contact?.contact_name && opportunity.known_gc !== "Unknown") return "Research General Contractor";
  if (path?.path_type === "vendor_registration") return "Register Vendor";
  if (path?.path_type === "trade_partner") return "Register Trade Partner";
  if (["bid_portal", "public_procurement", "plan_room"].includes(path?.path_type)) return "Monitor Bid Portal";
  if (opportunity.known_gc !== "Unknown" && !contact?.phone) return "Research General Contractor";
  if (opportunity.known_developer !== "Unknown" && !path && !contact?.phone) return "Research Developer";
  if (relationships.length && !path && !contact?.phone) return "Wait For Additional Evidence";
  return path || contact ? "Research General Contractor" : "Not Actionable";
}

function exactNextStepFor(opportunity, action, contact, path) {
  const projectName = cleanProjectName(opportunity.project_name);
  if (contact?.phone && contact?.contact_name) {
    return `Call ${contact.contact_name} at ${contact.phone} about ${projectName}; reference the source record and ask who handles subcontractor pricing.`;
  }
  if (path?.path_type === "trade_partner") {
    return `Open ${path.path_url} and submit a trade partner/business inquiry for Twin Rivers Fence referencing ${projectName}.`;
  }
  if (path?.path_type === "vendor_registration") {
    return `Open ${path.path_url} and complete vendor registration for Twin Rivers Fence; attach ${projectName} as the reason for outreach.`;
  }
  if (["bid_portal", "public_procurement", "plan_room"].includes(path?.path_type)) {
    return `Open ${path.path_url}, search for ${projectName}, and set a reminder to monitor addenda and bid dates.`;
  }
  if (path?.path_url) {
    return `Open ${path.path_url} and use the source-backed contact route to ask who handles subcontractor or fencing estimates for ${projectName}.`;
  }
  if (action === "Research General Contractor" && opportunity.known_gc !== "Unknown") {
    return `Research ${opportunity.known_gc} for an estimating or subcontractor intake route before calling on ${projectName}.`;
  }
  if (action === "Research Developer" && opportunity.known_developer !== "Unknown") {
    return `Research ${opportunity.known_developer} for vendor registration or construction contact evidence before outreach.`;
  }
  return "Wait for additional source-backed contact, procurement, or award evidence before outreach.";
}

function contactRoute(opportunity, contact, path) {
  const primaryCompany = contact?.company_name ?? path?.company_name ?? opportunity.known_gc ?? opportunity.known_developer ?? "Unknown";
  const profile = opportunity.companies.map((company) => profilesById.get(company.company_profile_id)).find((company) => company?.company_name === primaryCompany)
    ?? opportunity.companies.map((company) => profilesById.get(company.company_profile_id)).find(Boolean);
  return {
    known_contact: contact?.contact_name ? `${contact.contact_name} (${contact.contact_title ?? "Unknown title"})` : "Unknown",
    known_website: contact?.resolved_website ?? profile?.official_website ?? "Unknown",
    known_phone: contact?.phone ?? profile?.phone ?? "Unknown",
    known_procurement_path: path?.path_url ?? "Unknown",
    known_registration_portal: ["vendor_registration", "subcontractor_registration", "trade_partner"].includes(path?.path_type) ? path.path_url : "Unknown",
    known_bid_portal: ["bid_portal", "public_procurement", "plan_room"].includes(path?.path_type) ? path.path_url : "Unknown",
    source_evidence: contact?.source_url ?? path?.source_url ?? path?.path_url ?? opportunity.source_url,
    confidence: Math.max(contact?.confidence ?? 0, path?.confidence ?? 0, profile?.profile_confidence ?? 0),
  };
}

function expandTopCompanies(rows, dossiers) {
  return rows.map((company) => {
    const companyDossiers = dossiers.filter((dossier) => [dossier.developer, dossier.general_contractor, dossier.architect, dossier.engineer].includes(company.company_name));
    const relationshipCount = relationshipEdges.filter((edge) => edge.from_node_id?.includes(slug(company.company_name)) || edge.to_node_id?.includes(slug(company.company_name))).length;
    const profilePaths = pathsByCompany.get(company.company_profile_id) ?? [];
    return {
      ...company,
      actionable_opportunities: companyDossiers.filter((dossier) => dossier.actionability_score >= 65).length,
      relationship_count: relationshipCount,
      procurement_paths: profilePaths.length,
      evidence_count: company.evidence_count,
      fencing_signals: company.fencing_signals,
      qualified_opportunities: company.qualified_opportunities,
    };
  });
}

function renderDossiers(rows) {
  return [
    "# Qualified Opportunity Dossiers",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...rows.map(renderDossier),
  ].join("\n");
}

function renderDossier(row) {
  return [
    `## ${row.project_name}`,
    "",
    `- Project Location: ${row.project_location}`,
    `- City: ${row.city}`,
    `- County: ${row.county}`,
    `- Developer: ${row.developer}`,
    `- General Contractor: ${row.general_contractor}`,
    `- Architect: ${row.architect}`,
    `- Engineer: ${row.engineer}`,
    `- Known Relationships: ${row.known_relationships.join("; ")}`,
    `- Evidence Sources: ${row.evidence_sources.join("; ") || "Unknown"}`,
    `- Procurement Paths: ${formatPaths(row.procurement_paths)}`,
    `- Fencing Signals: ${row.fencing_signals}`,
    `- Fast Money Score: ${row.fast_money_score}`,
    `- Qualification Score: ${row.qualification_score}`,
    `- Confidence: ${pct(row.confidence)}`,
    `- Actionability Score: ${row.actionability_score}`,
    `- Recommended Action: ${row.recommended_action}`,
    `- Twin Rivers Fence Next Step: ${row.exact_next_step}`,
    "",
    "### Contact Route",
    "",
    `- Known Contact: ${row.contact_route.known_contact}`,
    `- Known Website: ${row.contact_route.known_website}`,
    `- Known Phone: ${row.contact_route.known_phone}`,
    `- Known Procurement Path: ${row.contact_route.known_procurement_path}`,
    `- Known Registration Portal: ${row.contact_route.known_registration_portal}`,
    `- Known Bid Portal: ${row.contact_route.known_bid_portal}`,
    `- Source Evidence: ${row.contact_route.source_evidence}`,
    `- Confidence: ${pct(row.contact_route.confidence)}`,
    "",
  ].join("\n");
}

function renderActionable(rows) {
  return [
    "# Actionable Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows, actionColumns()),
  ].join("\n");
}

function renderActionPlans(rows) {
  return [
    "# Opportunity Action Plans",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows, [
      ["Project", (row) => row.project_name],
      ["Action", (row) => row.recommended_action],
      ["Tomorrow Morning Step", (row) => row.exact_next_step],
      ["Contact", (row) => row.contact_route.known_contact],
      ["Phone", (row) => row.contact_route.known_phone],
      ["Route", (row) => row.contact_route.known_procurement_path],
      ["Actionability", (row) => row.actionability_score],
      ["Confidence", (row) => pct(row.confidence)],
    ]),
  ].join("\n");
}

function renderTopFence(rows) {
  return [
    "# Top Fence Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    rows.length ? table(rows, actionColumns()) : "_No qualified opportunities currently contain a fencing signal._",
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
      ["Relationship Count", (row) => row.relationship_count],
      ["Fencing Signals", (row) => row.fencing_signals],
      ["Qualified Opportunities", (row) => row.qualified_opportunities],
      ["Actionable Opportunities", (row) => row.actionable_opportunities],
      ["Needs Research", (row) => row.needs_research_opportunities],
      ["Best Path", (row) => row.best_procurement_path],
      ["Confidence", (row) => pct(row.confidence)],
    ]),
  ].join("\n");
}

function actionColumns() {
  return [
    ["Project", (row) => row.project_name],
    ["Location", (row) => row.project_location],
    ["Trade", (row) => row.trade],
    ["Action", (row) => row.recommended_action],
    ["Next Step", (row) => row.exact_next_step],
    ["Developer", (row) => row.developer],
    ["GC", (row) => row.general_contractor],
    ["Contact", (row) => row.contact_route.known_contact],
    ["Phone", (row) => row.contact_route.known_phone],
    ["Route", (row) => row.contact_route.known_procurement_path],
    ["Actionability", (row) => row.actionability_score],
  ];
}

function actionPlanRow(row) {
  return {
    id: row.id,
    project_name: row.project_name,
    recommended_action: row.recommended_action,
    exact_next_step: row.exact_next_step,
    actionability_score: row.actionability_score,
    confidence: row.confidence,
    contact_route: row.contact_route,
    source_evidence: row.source_evidence,
  };
}

function companyByType(opportunity, type) {
  return opportunity.companies.find((company) => company.company_type === type);
}

function bestContact(contacts) {
  return [...(contacts ?? [])].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0] ?? null;
}

function bestProcurementPath(paths) {
  const rank = { High: 3, Medium: 2, Low: 1 };
  return [...(paths ?? [])].sort((a, b) => rank[b.contractor_value] - rank[a.contractor_value] || (b.confidence ?? 0) - (a.confidence ?? 0))[0] ?? null;
}

function confidenceFor(opportunity, contact, path, relationships) {
  const values = [
    opportunity.evidence_quality === "High" ? 0.82 : opportunity.evidence_quality === "Medium" ? 0.62 : 0.4,
    contact?.confidence,
    path?.confidence,
    ...relationships.map((relationship) => relationship.confidence),
  ].filter((value) => Number.isFinite(Number(value)));
  return values.length ? Number((values.reduce((sum, value) => sum + Number(value), 0) / values.length).toFixed(2)) : 0.4;
}

function fastMoneyScore(value) {
  if (value === "High") return 100;
  if (value === "Medium") return 60;
  return 20;
}

function formatPaths(paths) {
  if (!paths.length) return "Unknown";
  return paths.map((path) => `${path.company_name}: ${path.path_type} (${path.contractor_value}) ${path.path_url}`).join("; ");
}

function locationParts(location) {
  const parts = String(location ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return {
    city: parts[0] ?? "Unknown",
    county: parts.find((part) => /county/i.test(part)) ?? (parts.length === 1 ? "Unknown" : parts[1] ?? "Unknown"),
  };
}

function cleanProjectName(value) {
  return String(value ?? "Unknown").replace(/[.\s]+$/g, "");
}

function groupBy(items, fn) {
  const groups = new Map();
  for (const item of items) {
    const key = fn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function slug(value) {
  return String(value ?? "").toLowerCase().replace(/\b(llc|inc|corp|corporation|incorporated|company|co|limited|the)\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
