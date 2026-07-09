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
console.log(`Primary/secondary fence scope rows: ${scope_intelligence.filter((row) => ["Primary Opportunity", "Secondary Opportunity"].includes(row.fence_scope_confidence)).length}.`);
console.log(`No evidence fence rows: ${scope_intelligence.filter((row) => row.fence_scope_confidence === "No Evidence").length}.`);

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
  const tradeRelevance = tradeRelevanceFor(categoryText, workCategories, opportunity);
  const fenceSignals = fenceSignalDetection(categoryText, categories, tradeRelevance);
  const scopeConfidence = fenceScopeConfidence(fenceSignals, categories, tradeRelevance);
  const projectDescription = projectDescriptionFor(opportunity, document, categories, workCategories, tradeRelevance);
  const scopeSummary = scopeSummaryFor(opportunity, document, workCategories);

  return {
    opportunity_id: opportunity.id,
    project_name: opportunity.project_name,
    project_type: tradeRelevance.project_type,
    primary_work: tradeRelevance.primary_work,
    secondary_work: tradeRelevance.secondary_work,
    likely_trades: tradeRelevance.likely_trades,
    trade_confidence: tradeRelevance.trade_confidence,
    project_description: projectDescription,
    project_summary: projectDescription,
    scope_summary: scopeSummary,
    work_categories: workCategories,
    project_categories: categories,
    trade_signals: tradeSignalsFor(opportunity, document),
    fence_signal_score: fenceSignals.score,
    fence_evidence: fenceSignals.evidence,
    negative_fence_evidence: fenceSignals.negativeEvidence,
    fence_signals_found: fenceSignals.found,
    fence_signals_missing: fenceSignals.missing,
    fence_scope_confidence: scopeConfidence.label,
    fence_scope_confidence_score: scopeConfidence.score,
    potential_fencing_scope: potentialFenceScope(categories, fenceSignals),
    confidence_reasoning: confidenceReasoning(scopeConfidence, fenceSignals, categories, document),
    why_fencing_relevant: whyFencingRelevant(scopeConfidence, fenceSignals),
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

function tradeRelevanceFor(text, workCategories, opportunity) {
  const normalized = text.toLowerCase();
  const primaryWork = primaryWorkFor(normalized, workCategories);
  const projectType = projectTypeFor(normalized, primaryWork, opportunity);
  const likelyTrades = likelyTradesFor(normalized, primaryWork, workCategories);
  const secondaryWork = workCategories.filter((category) => category !== primaryWork).slice(0, 5);
  const tradeConfidence = directWorkEvidence(normalized) ? 85 : workCategories.length ? 65 : 35;
  return {
    project_type: projectType,
    primary_work: primaryWork,
    secondary_work: secondaryWork,
    likely_trades: likelyTrades,
    trade_confidence: tradeConfidence,
  };
}

function primaryWorkFor(text, workCategories) {
  if (/creek|drainage|stormwater|hydrology|water quality|culvert|channel/i.test(text)) return "Drainage / water infrastructure";
  if (/earthwork|grading|excavat/i.test(text)) return "Earthwork";
  if (/solar|photovoltaic|pv|energy storage/i.test(text)) return "Solar / electrical";
  if (/roof|reroof|tpo|membrane|capsheet/i.test(text)) return "Roofing";
  if (/hvac|mechanical|package unit|air conditioning/i.test(text)) return "HVAC / mechanical";
  if (/interior remodel|kitchen|bathroom|flooring|painting|tenant improvement/i.test(text)) return "Interior remodel";
  if (/subdivision|village|residential|homes|apartment|lots?/i.test(text)) return "Residential development";
  if (/school|campus/i.test(text)) return "School construction";
  if (/park|trail|open space|recreation|sports field/i.test(text)) return "Parks / public recreation";
  if (/industrial|warehouse|yard/i.test(text)) return "Industrial site work";
  return workCategories[0] ?? "Unknown";
}

function projectTypeFor(text, primaryWork, opportunity) {
  if (/creek.*re[-\s]?align|re[-\s]?align.*creek/i.test(text)) return "Creek Realignment";
  if (/subdivision|village|lots?/i.test(text)) return "Subdivision";
  if (/school|campus/i.test(text)) return "School";
  if (/park|trail|open space|sports field/i.test(text)) return "Parks / Recreation";
  if (/solar|photovoltaic|pv/i.test(text)) return "Solar Retrofit";
  if (/addition|remodel/i.test(text)) return "Building Addition / Remodel";
  if (/roof|reroof/i.test(text)) return "Roof Replacement";
  if (/utility|pipeline|drainage|stormwater/i.test(text)) return "Utility / Infrastructure";
  return primaryWork && primaryWork !== "Unknown" ? primaryWork : cleanProjectName(opportunity.project_name);
}

function likelyTradesFor(text, primaryWork, workCategories) {
  const trades = new Set();
  if (/earthwork|grading|excavat|creek|drainage|stormwater|hydrology|culvert|channel/i.test(text)) ["Excavation", "Civil", "Drainage", "Environmental"].forEach((trade) => trades.add(trade));
  if (/subdivision|site work|utility|road|curb|sidewalk/i.test(text)) ["Site work", "Utility", "Concrete"].forEach((trade) => trades.add(trade));
  if (/solar|photovoltaic|pv|electrical|power/i.test(text)) trades.add("Electrical");
  if (/roof|reroof|tpo|membrane/i.test(text)) trades.add("Roofing");
  if (/hvac|mechanical|package unit/i.test(text)) trades.add("HVAC");
  if (/school|park|sports field|fence|fencing|gate|perimeter|access control/i.test(text)) trades.add("Fencing");
  for (const category of workCategories) trades.add(category.replace(/ improvements$/i, ""));
  if (!trades.size && primaryWork !== "Unknown") trades.add(primaryWork);
  return [...trades].slice(0, 8);
}

function directWorkEvidence(text) {
  return /earthwork|grading|excavat|creek|drainage|stormwater|hydrology|culvert|solar|photovoltaic|roof|hvac|subdivision|school|park|fence|fencing|gate/i.test(text);
}

function fenceSignalDetection(text, categories, tradeRelevance) {
  const directSignals = [
    ["Fence reference", /\bfenc(?:e|es|ing)\b/i],
    ["Chain link fencing", /chain[-\s]?link/i],
    ["Ornamental iron fencing", /ornamental iron/i],
    ["Wood or vinyl fence", /wood fence|vinyl fence/i],
    ["Security or perimeter fence", /security fence|perimeter fence|community perimeter/i],
    ["Temporary or construction fence", /temporary fence|construction fence/i],
    ["Gate or controlled access", /access gate|vehicle gate|pedestrian gate|controlled access|access control/i],
    ["Wall or enclosure", /screen wall|boundary wall|enclosure/i],
    ["Recreation or school fencing", /dog park fencing|school fencing|sports field fencing/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([label]) => label);

  const contextualSignals = [
    ["Subdivision or community development evidence", /subdivision|residential|homes|village|lots?|apartment/i],
    ["School, park, trail, or sports facility evidence", /school|campus|park|trail|open space|sports field|recreation/i],
    ["Industrial yard or security-sensitive site evidence", /industrial|warehouse|yard|security/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([label]) => label);

  const negatives = [
    ["Creek restoration / drainage is primary work", /creek restoration|creek|water quality|drainage|stormwater|hydrology/i],
    ["Pipeline or utility work is primary work", /pipeline|utility relocation|water main|sewer|trunk/i],
    ["Electrical or solar retrofit is primary work", /electrical upgrade|solar|photovoltaic|pv|energy storage/i],
    ["Interior remodel only", /interior remodel|kitchen|living room|bathroom|flooring|tenant improvement/i],
    ["Roofing-only work", /roof replacement|roof|reroof|tpo|membrane|capsheet/i],
    ["Painting or finish work", /painting|paint|finish/i],
    ["HVAC-only work", /hvac|package unit|mechanical|air conditioning/i],
    ["Minor repair or single-trade renovation", /minor|repair|replace|like for like|siding|window/i],
    ["Tiny demolition or accessory structure", /demo \(shed\)|shed|accessory structure|detached garage|patio cover/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([label]) => label);

  let score = directSignals.length * 30 + contextualSignals.length * 10 - negatives.length * 18;
  if (!directSignals.length && negatives.length) score -= 22;
  if (!directSignals.length && /drainage|creek|stormwater|hydrology|solar|roof|hvac|interior remodel/i.test(tradeRelevance.primary_work)) score -= 24;
  if (directSignals.length && (categories.includes("Schools") || categories.includes("Parks") || categories.includes("Industrial") || categories.includes("Housing"))) score += 12;
  return {
    score: clamp(score),
    evidence: directSignals,
    negativeEvidence: negatives,
    found: [...directSignals, ...contextualSignals],
    missing: directSignals.length ? negatives : [...negatives, "No direct fencing references found in available evidence"],
  };
}

function fenceScopeConfidence(signals, categories, tradeRelevance) {
  const hasDirectFenceEvidence = signals.evidence.length > 0;
  const hasContextualFenceCandidate = signals.found.some((signal) => /Subdivision|School|park|trail|sports|Industrial/i.test(signal));
  const primaryNegative = /Drainage|water infrastructure|Solar|Roofing|HVAC|Interior remodel/i.test(tradeRelevance.primary_work);

  if (primaryNegative && !hasDirectFenceEvidence) return { label: "No Evidence", score: 5 };
  if (signals.negativeEvidence.some((signal) => /Tiny demolition|Interior remodel|Roofing-only|HVAC-only|Electrical or solar/.test(signal)) && !hasDirectFenceEvidence) {
    return { label: "No Evidence", score: 5 };
  }
  if (hasDirectFenceEvidence && signals.score >= 78) return { label: "Primary Opportunity", score: 90 };
  if (hasDirectFenceEvidence && signals.score >= 54) return { label: "Secondary Opportunity", score: 72 };
  if (hasDirectFenceEvidence) return { label: "Possible Opportunity", score: 52 };
  if (hasContextualFenceCandidate && !primaryNegative && (categories.includes("Housing") || categories.includes("Schools") || categories.includes("Parks") || categories.includes("Industrial"))) {
    return { label: "Possible Opportunity", score: 45 };
  }
  if (hasContextualFenceCandidate) return { label: "Weak Opportunity", score: 24 };
  return { label: "No Evidence", score: 5 };
}

function projectDescriptionFor(opportunity, document, categories, workCategories, tradeRelevance) {
  const projectName = cleanProjectName(opportunity.project_name);
  const primary = tradeRelevance.primary_work.toLowerCase();
  if (/Creek Realignment/i.test(tradeRelevance.project_type)) {
    const work = workCategories.some((category) => /earthwork/i.test(category)) ? "earthwork, drainage, and water management improvements" : `${primary} work`;
    return `${projectName} is a creek and drainage infrastructure project involving ${work}.`;
  }
  if (/Solar Retrofit/i.test(tradeRelevance.project_type)) {
    return `${projectName} is a solar/electrical permit tied to ${categories.includes("Housing") ? "a residential development area" : "an existing site"}.`;
  }
  if (/Building Addition|Roof Replacement/i.test(tradeRelevance.project_type)) {
    return `${projectName} is a ${tradeRelevance.project_type.toLowerCase()} focused on ${primary}.`;
  }
  if (document?.summary) {
    return `${document.summary}`;
  }
  return `${projectName} appears to be a ${tradeRelevance.project_type.toLowerCase()} project focused on ${workCategories.join(", ").toLowerCase() || opportunity.trade.toLowerCase()} work.`;
}

function scopeSummaryFor(opportunity, document, workCategories) {
  const source = document?.source_name ? `Source: ${document.source_name}.` : "Source: permit or opportunity record.";
  return `Work indicated: ${workCategories.join(", ") || opportunity.trade || "Unknown"}. ${source}`;
}

function tradeSignalsFor(opportunity, document) {
  return [...new Set([...(document?.trades ?? []), ...(opportunity.trade ?? "").split(",").map((trade) => trade.trim()).filter(Boolean)])];
}

function potentialFenceScope(categories, signals) {
  if (!signals.evidence.length) return [];
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
  return `${scopeConfidence.label}: ${signals.evidence.length} direct fence evidence signal(s), ${signals.found.length} total relevant signal(s), ${signals.missing.length} limiting signal(s), categories ${categories.join(", ") || "unclassified"}, and ${evidenceStrength}.`;
}

function whyFencingRelevant(scopeConfidence, signals) {
  if (scopeConfidence.label === "No Evidence") {
    return "No direct fencing references found. Additional document review is required before treating this as a fencing opportunity.";
  }
  if (scopeConfidence.label === "Weak Opportunity") {
    return "No direct fencing references found. The project has contextual indicators only, so fencing is possible but unconfirmed.";
  }
  return `Fence relevance is supported by direct evidence: ${signals.evidence.join("; ")}.`;
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
    `- Primary scope rows: ${rows.filter((row) => row.fence_scope_confidence === "Primary Opportunity").length}`,
    `- Secondary scope rows: ${rows.filter((row) => row.fence_scope_confidence === "Secondary Opportunity").length}`,
    `- Possible scope rows: ${rows.filter((row) => row.fence_scope_confidence === "Possible Opportunity").length}`,
    `- Weak/no evidence rows: ${rows.filter((row) => ["Weak Opportunity", "No Evidence"].includes(row.fence_scope_confidence)).length}`,
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
    table(rows.filter((row) => row.fence_scope_confidence !== "No Evidence"), scopeColumns()),
  ].join("\n");
}

function scopeColumns() {
  return [
    ["Project", (row) => row.project_name],
    ["Project Type", (row) => row.project_type],
    ["Primary Work", (row) => row.primary_work],
    ["Likely Trades", (row) => row.likely_trades.join(", ") || "Unknown"],
    ["Categories", (row) => row.project_categories.join(", ") || "Unclassified"],
    ["Fence Scope", (row) => row.fence_scope_confidence],
    ["Fence Score", (row) => row.fence_signal_score],
    ["Direct Fence Evidence", (row) => row.fence_evidence.join("; ") || "None"],
    ["Negative Evidence", (row) => row.negative_fence_evidence.join("; ") || "None"],
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
