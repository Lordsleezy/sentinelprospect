import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const contractorOpportunities = await readJson("data/contractor_opportunities.json") ?? [];
const actionOpportunities = await readJson("data/contractor_action_opportunities.json") ?? [];
const documentExtractions = await readJson("data/document_extraction_results.json") ?? [];
const capturedAt = new Date().toISOString();

const actionByOpportunity = new Map(actionOpportunities.map((row) => [row.opportunity_id, row]));
const documentsById = new Map(documentExtractions.map((row) => [row.evidence_document_id, row]));
const documentsByProject = new Map(documentExtractions.map((row) => [normalizeKey(row.project_name), row]));

const scope_intelligence = contractorOpportunities.map(buildScopeIntelligence);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/scope_intelligence.json", scope_intelligence),
  writeFile(resolve("reports/scope-intelligence.md"), renderScopeIntelligence(scope_intelligence)),
  writeFile(resolve("reports/fence-scope-intelligence.md"), renderFenceScopeIntelligence(scope_intelligence)),
]);

console.log(`Scope intelligence rows: ${scope_intelligence.length}.`);
console.log(`Primary/secondary fence scope rows: ${scope_intelligence.filter((row) => ["Primary Scope", "Secondary Scope"].includes(row.fence_scope_confidence)).length}.`);
console.log(`No meaningful fence rows: ${scope_intelligence.filter((row) => row.fence_scope_confidence === "No Meaningful Fence Opportunity").length}.`);

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

function buildScopeIntelligence(opportunity) {
  const document = documentsById.get(opportunity.id) ?? documentsByProject.get(normalizeKey(opportunity.project_name));
  const action = actionByOpportunity.get(opportunity.id);
  const categoryText = [
    opportunity.project_name,
    opportunity.project_location,
    document?.summary,
    ...(document?.trades ?? []),
    ...(document?.companies ?? []).map((company) => `${company.name} ${company.role}`),
  ].join(" ");
  const workText = [categoryText, opportunity.trade, action?.likely_scope].join(" ");
  const categories = classifyCategories(categoryText);
  const workCategories = classifyWorkCategories(workText, document, opportunity);
  const fenceSignals = fenceSignalDetection(categoryText, categories);
  const scopeConfidence = fenceScopeConfidence(fenceSignals, categories);
  const projectDescription = projectDescriptionFor(opportunity, document, categories, workCategories);
  const scopeSummary = scopeSummaryFor(opportunity, document, workCategories);

  return {
    opportunity_id: opportunity.id,
    project_name: opportunity.project_name,
    project_description: projectDescription,
    project_summary: projectDescription,
    scope_summary: scopeSummary,
    work_categories: workCategories,
    project_categories: categories,
    trade_signals: tradeSignalsFor(opportunity, document),
    fence_signal_score: fenceSignals.score,
    fence_signals_found: fenceSignals.found,
    fence_signals_missing: fenceSignals.missing,
    fence_scope_confidence: scopeConfidence.label,
    fence_scope_confidence_score: scopeConfidence.score,
    potential_fencing_scope: potentialFenceScope(categories, fenceSignals),
    confidence_reasoning: confidenceReasoning(scopeConfidence, fenceSignals, categories, document),
    why_fencing_relevant: whyFencingRelevant(scopeConfidence, fenceSignals, categories),
    evidence: evidenceFor(opportunity, document),
    source_url: document?.source_url ?? opportunity.source_url,
    source_type: document?.source_type ?? "permit_or_opportunity_record",
    last_verified: capturedAt,
  };
}

function classifyCategories(text) {
  const rules = [
    ["Housing", /housing|homes|residential|subdivision|village|lot|unit|master plan|apartment|single family|sfd/i],
    ["Commercial", /commercial|tenant|retail|office|shopping|restaurant/i],
    ["Industrial", /industrial|warehouse|yard|manufacturing/i],
    ["Utilities", /utility|utilities|sewer|water|storm|drainage|solar|pv|energy storage|power/i],
    ["Public Works", /public works|city|county|public|bid|procurement/i],
    ["Roads", /road|street|curb|gutter|sidewalk|driveway|paving|asphalt/i],
    ["Schools", /school|campus|classroom/i],
    ["Parks", /park|playground|trail|open space|recreation/i],
    ["Environmental", /creek|environmental|restoration|wetland|habitat|ceqa/i],
    ["Drainage", /drainage|storm|creek|trunk|channel|culvert/i],
    ["Trails", /trail|path|bike|pedestrian/i],
    ["Security", /security|gate|access control|perimeter/i],
    ["Infrastructure", /infrastructure|site work|earthwork|grading|utility relocation|development infrastructure/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
}

function classifyWorkCategories(text, document, opportunity) {
  const categories = new Set(document?.trades ?? []);
  if (/earthwork|grading|excavat/i.test(text)) categories.add("Earthwork");
  if (/drainage|storm|creek|culvert/i.test(text)) categories.add("Drainage improvements");
  if (/utility|sewer|water|power|solar/i.test(text)) categories.add("Utility work");
  if (/site work|access|road|paving|curb|sidewalk/i.test(text)) categories.add("Site access improvements");
  if (/subdivision|homes|residential|lot|village/i.test(text)) categories.add("Residential development infrastructure");
  if (/roof|tpo|membrane|reroof/i.test(text)) categories.add("Roofing");
  if (/hvac|mechanical|package unit/i.test(text)) categories.add("Mechanical");
  if (/demo|demolition/i.test(text)) categories.add("Demolition");
  if (!categories.size && opportunity.trade) opportunity.trade.split(",").map((trade) => trade.trim()).filter(Boolean).forEach((trade) => categories.add(trade));
  return [...categories];
}

function fenceSignalDetection(text, categories) {
  const positives = [
    ["Adjacent residential development", /residential|subdivision|homes|village|lot|unit|apartment/i],
    ["Public access separation", /park|trail|school|public|open space|pedestrian/i],
    ["Utility or infrastructure site", /utility|drainage|storm|creek|trunk|infrastructure|site work/i],
    ["Industrial or security-sensitive site", /industrial|warehouse|yard|security/i],
    ["Boundary or access-control language", /perimeter|boundary|gate|access control|fence/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([label]) => label);

  const negatives = [
    ["Interior remodel only", /interior remodel|kitchen|living room|bathroom/i],
    ["Roofing-only work", /roof|reroof|tpo|membrane|capsheet/i],
    ["Plumbing-only work", /plumbing|water heater|gas line|backflow/i],
    ["HVAC-only work", /hvac|package unit|mechanical|air conditioning/i],
    ["Minor repair or single-trade renovation", /minor|repair|replace|like for like|siding|window|paint/i],
    ["Tiny demolition or accessory structure", /demo \(shed\)|shed|accessory structure|detached garage|patio cover/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([label]) => label);

  let score = positives.length * 18 - negatives.length * 16;
  if (/fenc|gate|perimeter|access control/i.test(text)) score += 18;
  if (categories.includes("Housing")) score += 8;
  if (categories.includes("Parks") || categories.includes("Schools") || categories.includes("Industrial")) score += 10;
  if (negatives.some((signal) => /tiny demolition|minor repair|interior remodel|roofing-only|plumbing-only|hvac-only/i.test(signal))) score -= 24;
  return {
    score: clamp(score),
    found: positives,
    missing: negatives.length ? negatives : ["No explicit fence specification found in available evidence"],
  };
}

function fenceScopeConfidence(signals, categories) {
  if (signals.missing.some((signal) => /Tiny demolition or accessory structure/.test(signal))) return { label: "No Meaningful Fence Opportunity", score: 5 };
  if (signals.score >= 82 && (categories.includes("Housing") || categories.includes("Industrial") || categories.includes("Security"))) return { label: "Primary Scope", score: 90 };
  if (signals.score >= 62 && (categories.includes("Schools") || categories.includes("Parks") || categories.includes("Housing"))) return { label: "Secondary Scope", score: 72 };
  if (signals.score >= 38) return { label: "Possible Scope", score: 52 };
  if (signals.score >= 18 || opportunity.fence_probability >= 40) return { label: "Weak Signal", score: 28 };
  return { label: "No Meaningful Fence Opportunity", score: 5 };
}

function projectDescriptionFor(opportunity, document, categories, workCategories) {
  if (document?.summary) {
    return `${document.summary} Project categories: ${categories.join(", ") || "Unclassified"}.`;
  }
  return `${cleanProjectName(opportunity.project_name)} appears to be a ${categories.join(", ").toLowerCase() || "construction"} opportunity. Available records indicate ${workCategories.join(", ").toLowerCase() || opportunity.trade.toLowerCase()} work.`;
}

function scopeSummaryFor(opportunity, document, workCategories) {
  const source = document?.source_name ? `Source: ${document.source_name}.` : "Source: permit or opportunity record.";
  return `Work indicated: ${workCategories.join(", ") || opportunity.trade || "Unknown"}. ${source}`;
}

function tradeSignalsFor(opportunity, document) {
  return [...new Set([...(document?.trades ?? []), ...(opportunity.trade ?? "").split(",").map((trade) => trade.trim()).filter(Boolean)])];
}

function potentialFenceScope(categories, signals) {
  const scopes = [];
  if (categories.includes("Housing")) scopes.push("Perimeter fencing", "Community fencing", "Construction fencing");
  if (categories.includes("Parks") || categories.includes("Schools")) scopes.push("Public access separation", "Decorative fencing");
  if (categories.includes("Utilities") || categories.includes("Drainage") || categories.includes("Infrastructure")) scopes.push("Construction fencing", "Access control gates");
  if (categories.includes("Industrial") || categories.includes("Security")) scopes.push("Security fencing", "Access control gates");
  if (signals.found.some((signal) => /boundary|access-control/i.test(signal))) scopes.push("Gates");
  return [...new Set(scopes)].slice(0, 5);
}

function confidenceReasoning(scopeConfidence, signals, categories, document) {
  const evidenceStrength = document ? "source document evidence is available" : "only permit/opportunity metadata is available";
  return `${scopeConfidence.label}: ${signals.found.length} positive fence signal(s), ${signals.missing.length} limiting signal(s), categories ${categories.join(", ") || "unclassified"}, and ${evidenceStrength}.`;
}

function whyFencingRelevant(scopeConfidence, signals, categories) {
  if (scopeConfidence.label === "No Meaningful Fence Opportunity") {
    return "Available evidence does not show a meaningful fencing opportunity.";
  }
  return `Potential signals identified: ${signals.found.join("; ") || "none"}. Fence relevance is ${scopeConfidence.label.toLowerCase()} because the project categories include ${categories.join(", ") || "limited category evidence"}.`;
}

function evidenceFor(opportunity, document) {
  return [
    document?.summary,
    document?.source_url ?? opportunity.source_url,
    opportunity.qualification_reason,
  ].filter(Boolean);
}

function renderScopeIntelligence(rows) {
  return [
    "# Scope Intelligence",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Opportunities evaluated: ${rows.length}`,
    `- Primary scope rows: ${rows.filter((row) => row.fence_scope_confidence === "Primary Scope").length}`,
    `- Secondary scope rows: ${rows.filter((row) => row.fence_scope_confidence === "Secondary Scope").length}`,
    `- Possible scope rows: ${rows.filter((row) => row.fence_scope_confidence === "Possible Scope").length}`,
    `- Weak/no meaningful rows: ${rows.filter((row) => ["Weak Signal", "No Meaningful Fence Opportunity"].includes(row.fence_scope_confidence)).length}`,
    "",
    table(rows, scopeColumns()),
  ].join("\n");
}

function renderFenceScopeIntelligence(rows) {
  return [
    "# Fence Scope Intelligence",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows.filter((row) => row.fence_scope_confidence !== "No Meaningful Fence Opportunity"), scopeColumns()),
  ].join("\n");
}

function scopeColumns() {
  return [
    ["Project", (row) => row.project_name],
    ["Categories", (row) => row.project_categories.join(", ") || "Unclassified"],
    ["Fence Scope", (row) => row.fence_scope_confidence],
    ["Fence Score", (row) => row.fence_signal_score],
    ["Signals Found", (row) => row.fence_signals_found.join("; ") || "None"],
    ["Potential Scope", (row) => row.potential_fencing_scope.join("; ") || "Unknown"],
    ["Summary", (row) => row.project_summary],
    ["Reasoning", (row) => row.confidence_reasoning],
  ];
}

function table(rows, columns) {
  if (!rows.length) return "_None._";
  return [
    `| ${columns.map(([name]) => name).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, getter]) => escapeCell(getter(row))).join(" | ")} |`),
  ].join("\n");
}

function cleanProjectName(value) {
  return String(value ?? "the project").replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeCell(value) {
  return String(value ?? "Unknown").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
