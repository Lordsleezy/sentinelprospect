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
console.log(`Bidable fencing rows: ${scope_intelligence.filter((row) => row.fencing_bidable).length}.`);

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
  const sourceText = [
    opportunity.project_name,
    opportunity.project_description,
    opportunity.project_location,
    document?.summary,
    document?.award_information,
    ...(document?.relationships ?? []).map((relationship) => relationship.evidence_summary),
  ].filter(Boolean).join(". ");
  // Keep trade labels out of fence evidence detection; they are used only for work classification.
  const categoryText = [
    sourceText,
    ...(document?.trades ?? []),
    ...(document?.companies ?? []).map((company) => `${company.name} ${company.role}`),
  ].filter(Boolean).join(". ");
  const fenceText = sourceText;
  const workText = [categoryText, opportunity.trade, action?.likely_scope].join(" ");
  const primaryScope = classifyPrimaryScope(fenceText, opportunity);
  const categories = classifyCategories(categoryText);
  const workCategories = classifyWorkCategories(workText, document, opportunity);
  const tradeRelevance = tradeRelevanceFor(categoryText, workCategories, opportunity, primaryScope);
  const fenceSignals = fenceSignalDetection(fenceText, categories, tradeRelevance, primaryScope);
  const scopeConfidence = fenceScopeConfidence(fenceSignals, categories, tradeRelevance, primaryScope);
  const projectDescription = projectDescriptionFor(opportunity, document, categories, workCategories, tradeRelevance, fenceSignals, primaryScope);
  const scopeSummary = scopeSummaryFor(opportunity, document, workCategories, primaryScope);
  const whyFencing = whyFencingRelevant(scopeConfidence, fenceSignals, categories, workCategories, primaryScope);
  const bidability = fenceBidability(scopeConfidence, fenceSignals, primaryScope);

  return {
    opportunity_id: opportunity.id,
    project_name: opportunity.project_name,
    project_type: tradeRelevance.project_type,
    primary_scope: primaryScope.label,
    primary_scope_confidence: primaryScope.confidence,
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
    fence_evidence_tier: fenceSignals.tier,
    negative_fence_evidence: fenceSignals.negativeEvidence,
    fence_signals_found: fenceSignals.found,
    fence_signals_missing: fenceSignals.missing,
    fence_evidence_snippets: fenceSignals.snippets,
    fence_scope_confidence: scopeConfidence.label,
    fence_scope_confidence_score: scopeConfidence.score,
    fencing_bidable: bidability.bidable,
    fencing_bidability_reason: bidability.reason,
    potential_fencing_scope: potentialFenceScope(categories, fenceSignals, primaryScope),
    confidence_reasoning: confidenceReasoning(scopeConfidence, fenceSignals, categories, document, primaryScope, bidability),
    why_fencing_relevant: whyFencing,
    why_fencing_matters: whyFencing,
    evidence: evidenceFor(opportunity, document, fenceSignals),
    source_url: document?.source_url ?? opportunity.source_url,
    source_type: document?.source_type ?? "permit_or_opportunity_record",
    last_verified: capturedAt,
  };
}

function classifyPrimaryScope(text, opportunity) {
  const blob = `${text} ${opportunity.trade ?? ""}`.toLowerCase();
  const rules = [
    ["Fence / gate installation", /\b(new\s*\(?gates?\)?|install(?:ation)? of .{0,40}gate|building a .{0,20}gate|automat(?:ic|ed) (?:slide )?gates?|slid(?:e|ing) gates?|steel gate|security gate|raise fence|new fence|pool safety fencing|security fence|gates\/fence|fence height|fencing with gate|chain[-\s]?link fence|ada ped|ped gates?)\b/i, 92],
    ["Electrical / landscape lighting", /\b(electrical for landscaping|commercial electrical service|electrical service pedestal|landscape lighting|service pedestal|electrical service)\b|\belectrical\b.{0,40}\blandscap|\blandscap.{0,40}\belectrical/i, 90],
    ["Solar / electrical", /\b(solar|photovoltaic|\bpv\b|energy storage|powerwall|battery)\b/i, 88],
    ["HVAC / mechanical", /\b(hvac|heat pump|package unit|mechanical|air conditioning)\b/i, 86],
    ["Roofing", /\b(reroof|roof replacement|tpo|membrane|capsheet|re-roof)\b/i, 86],
    ["Drainage / water infrastructure", /\b(creek|drainage|stormwater|hydrology|culvert|channel|water quality)\b/i, 84],
    ["Interior remodel / TI", /\b(interior remodel|tenant improvement|kitchen|bathroom|flooring)\b/i, 82],
    ["School construction", /\b(school|campus|classroom)\b/i, 80],
    ["Parks / recreation", /\b(park|trail|open space|sports field|recreation)\b/i, 78],
    ["Residential development", /\b(subdivision|village|production home|master plan|sfd|residential lots?)\b/i, 70],
    ["Industrial site work", /\b(industrial|warehouse|\byard\b|manufacturing)\b/i, 70],
  ];
  for (const [label, pattern, confidence] of rules) {
    if (pattern.test(blob)) return { label, confidence, pattern: String(pattern) };
  }
  return { label: "Unknown", confidence: 20, pattern: null };
}

function classifyCategories(text) {
  const rules = [
    ["Housing", /housing|homes|residential|subdivision|village|lot|unit|master plan|apartment|single family|sfd/i],
    ["Commercial", /commercial|tenant|retail|office|shopping|restaurant/i],
    ["Industrial", /\bindustrial\b|\bwarehouse\b|\byard\b(?!\s*s\b)|manufacturing/i],
    ["Utilities", /utility|utilities|sewer|water|storm|drainage|solar|pv|energy storage|power/i],
    ["Public Works", /public works|city|county|public|bid|procurement/i],
    ["Roads", /road|street|curb|gutter|sidewalk|driveway|paving|asphalt/i],
    ["Schools", /school|campus|classroom/i],
    ["Parks", /park|playground|trail|open space|recreation/i],
    ["Environmental", /creek|environmental|restoration|wetland|habitat|ceqa/i],
    ["Drainage", /drainage|storm|creek|trunk|channel|culvert/i],
    ["Trails", /trail|path|bike|pedestrian/i],
    ["Security", /security fence|access control|perimeter fence|security gate/i],
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

function tradeRelevanceFor(text, workCategories, opportunity, primaryScope) {
  const normalized = text.toLowerCase();
  const primaryWork = primaryWorkFor(normalized, workCategories, primaryScope);
  const projectType = projectTypeFor(normalized, primaryWork, opportunity, primaryScope);
  const likelyTrades = likelyTradesFor(normalized, primaryWork, workCategories, primaryScope);
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

function primaryWorkFor(text, workCategories, primaryScope) {
  if (primaryScope?.label && primaryScope.label !== "Unknown") return primaryScope.label;
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

function projectTypeFor(text, primaryWork, opportunity, primaryScope) {
  if (primaryScope?.label === "Fence / gate installation") return "Fence / Gate Installation";
  if (primaryScope?.label === "Electrical / landscape lighting") return "Electrical / Landscape Lighting";
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

function likelyTradesFor(text, primaryWork, workCategories, primaryScope) {
  const trades = new Set();
  if (/earthwork|grading|excavat|creek|drainage|stormwater|hydrology|culvert|channel/i.test(text)) ["Excavation", "Civil", "Drainage", "Environmental"].forEach((trade) => trades.add(trade));
  if (/subdivision|site work|utility|road|curb|sidewalk/i.test(text)) ["Site work", "Utility", "Concrete"].forEach((trade) => trades.add(trade));
  if (/solar|photovoltaic|pv|electrical|power/i.test(text)) trades.add("Electrical");
  if (/roof|reroof|tpo|membrane/i.test(text)) trades.add("Roofing");
  if (/hvac|mechanical|package unit/i.test(text)) trades.add("HVAC");
  // Only add Fencing for strong fence/gate install language OR if primaryScope is Fence / gate installation
  const hasFenceInstallLanguage = /install(?:ation)? of .{0,40}(?:fence|gate)|new fence|raise fence|build(?:ing)? a .{0,20}(?:fence|gate)|chain[-\s]?link|ornamental iron|pool safety fenc|security fence|gates\/fence|fence height|new gates|sliding gate|automatic gate|steel gate|vehicle gate|pedestrian gate|security gate|detention basin[^.]{0,80}fenc|fenc[^.]{0,80}detention basin/i.test(text);
  if (hasFenceInstallLanguage || primaryScope?.label === "Fence / gate installation") trades.add("Fencing");
  for (const category of workCategories) trades.add(category.replace(/ improvements$/i, ""));
  if (!trades.size && primaryWork !== "Unknown") trades.add(primaryWork);
  return [...trades].slice(0, 8);
}

function directWorkEvidence(text) {
  return /earthwork|grading|excavat|creek|drainage|stormwater|hydrology|culvert|solar|photovoltaic|roof|hvac|subdivision|school|park|fence|fencing|gate/i.test(text);
}

function isNonFencePrimaryScope(primaryScope) {
  if (!primaryScope?.label || primaryScope.label === "Unknown") return false;
  return primaryScope.label !== "Fence / gate installation";
}

function fenceSignalDetection(text, categories, tradeRelevance, primaryScope) {
  const strongRules = [
    ["Install/raise/new/build fence", /install(?:ation)? of .{0,40}fence|new fence|raise fence|build(?:ing)? a .{0,20}fence|supply and install.{0,60}fenc/i],
    ["Fence height specification", /fence height/i],
    ["Pool safety fencing", /pool safety fenc/i],
    ["Security fence", /\bsecurity fence\b/i],
    ["Gates and fence combined", /gates\/fence|gate.{0,20}fence|fenc(?:e|es|ing).{0,30}gate/i],
    ["Chain link fencing", /chain[-\s]?link/i],
    ["Ornamental iron fencing", /ornamental iron/i],
    ["New gates installation", /new\s*\(?gates?\)?|install(?:ation)? of .{0,40}gate|building a .{0,20}gate|supply and install.{0,60}gate/i],
    ["Sliding or automatic gate", /slid(?:e|ing) gates?|automat(?:ic|ed) (?:slide )?gates?/i],
    ["Steel vehicle or pedestrian gate", /steel gate|vehicle gate|pedestrian gate|\bped gates?\b|ada ped/i],
    ["Security gate", /\bsecurity gate\b/i],
    ["Detention basin fencing", /detention basin[^.]{0,80}\bfenc(?:e|ing)?\b|\bfenc(?:e|ing)?\b[^.]{0,80}detention basin/i],
    ["Park trail or school fencing", /park fencing|trail fencing|school fencing|sports field fencing|dog park fencing/i],
  ];

  const weakRules = [
    ["Gate reference (bare)", /\bgates?\b/i],
    ["Screen wall or enclosure", /screen wall|\benclosure\b/i],
    ["Perimeter fence mention", /perimeter fence|perimeter fencing|community perimeter/i],
    ["Fence reference (bare)", /\bfenc(?:e|es|ing)\b/i],
  ];

  const strongEvidence = [];
  const weakEvidence = [];
  const snippets = [];

  for (const [label, pattern] of strongRules) {
    const match = text.match(pattern);
    if (!match) continue;
    strongEvidence.push(label);
    snippets.push({
      text: snippetForMatch(text, match.index ?? 0),
      signal: label,
      confidence: "strong",
      source: "permit_or_opportunity_record",
    });
  }

  for (const [label, pattern] of weakRules) {
    const match = text.match(pattern);
    if (!match) continue;
    weakEvidence.push(label);
  }

  const contextualSignals = [
    ["Subdivision or community development evidence", /subdivision|residential|homes|village|lots?|apartment/i],
    ["School, park, trail, or sports facility evidence", /school|campus|park|trail|open space|sports field|recreation/i],
    ["Industrial yard or security-sensitive site evidence", /industrial|warehouse|yard|security/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([label]) => label);

  // Negatives only apply when they describe the project's primary work, not incidental
  // permit-type catalog text (e.g. "Ground Mount Solar" listed next to a NEW GATES job).
  const negatives = [
    ["Primary work is electrical / landscape lighting", /electrical for landscaping|landscape lighting|service pedestal|electrical service pedestal|commercial electrical service/i],
    ["Electrical service is primary work", /\belectrical\b.{0,40}\blandscap|\blandscap.{0,40}\belectrical|electrical upgrade|electrical service\b/i],
    ["Solar or photovoltaic work is primary", /\b(solar|photovoltaic|\bpv\b|energy storage)\b/i],
    ["Creek restoration or drainage is primary work", /creek restoration|creek|water quality|drainage|stormwater|hydrology/i],
    ["Pipeline or utility work is primary work", /pipeline|utility relocation|water main|sewer|trunk/i],
    ["Interior remodel only", /interior remodel|kitchen|living room|bathroom|flooring|tenant improvement/i],
    ["Roofing-only work", /roof replacement|reroof|tpo|membrane|capsheet/i],
    ["Painting or finish work", /\bpainting\b|\bpaint\b/i],
    ["HVAC-only work", /hvac|package unit|air conditioning/i],
    ["Minor repair or single-trade renovation", /\bminor\b|\brepair\b|like for like|\bsiding\b/i],
    ["Tiny demolition or accessory structure", /demo \(shed\)|accessory structure|detached garage|patio cover/i],
  ].filter(([, pattern]) => {
    if (!pattern.test(text)) return false;
    // If primary scope is already fence/gate install, do not treat catalog/type noise as a veto.
    if (primaryScope?.label === "Fence / gate installation") return false;
    return true;
  }).map(([label]) => label);

  const hasStrong = strongEvidence.length > 0;
  const hasWeak = weakEvidence.length > 0;
  const nonFencePrimary = isNonFencePrimaryScope(primaryScope);

  let score = strongEvidence.length * 30 + weakEvidence.length * 8 + contextualSignals.length * 10 - negatives.length * 18;
  if (!hasStrong && negatives.length) score -= 22;
  if (!hasStrong && nonFencePrimary) score -= 30;
  if (hasStrong && (categories.includes("Schools") || categories.includes("Parks") || categories.includes("Industrial") || categories.includes("Housing"))) score += 12;

  const tier = hasStrong ? "direct" : hasWeak ? "weak" : contextualSignals.length ? "contextual" : "none";

  return {
    score: clamp(score),
    evidence: strongEvidence,
    weakEvidence,
    negativeEvidence: negatives,
    found: [...strongEvidence, ...weakEvidence, ...contextualSignals],
    missing: hasStrong ? negatives : [...negatives, "No strong fencing references found in available evidence"],
    snippets,
    tier,
    strongEvidence: hasStrong,
  };
}

function fenceScopeConfidence(signals, categories, tradeRelevance, primaryScope) {
  const nonFencePrimary = isNonFencePrimaryScope(primaryScope);
  const hasStrong = signals.strongEvidence;
  const hasWeak = (signals.weakEvidence?.length ?? 0) > 0;
  const hasContextual = signals.found.some((signal) => /Subdivision|School|park|trail|sports|Industrial/i.test(signal));

  if (nonFencePrimary && !hasStrong) return { label: "No Evidence", score: 5 };

  if (
    signals.negativeEvidence.some((signal) =>
      /Tiny demolition|Interior remodel|Roofing-only|HVAC-only|Electrical or solar|Primary work is electrical/.test(signal)
    ) && !hasStrong
  ) {
    return { label: "No Evidence", score: 5 };
  }

  if (hasStrong && signals.score >= 78) return { label: "Primary Opportunity", score: 90 };
  if (hasStrong && signals.score >= 54) return { label: "Secondary Opportunity", score: 72 };
  if (hasStrong) return { label: "Possible Opportunity", score: 52 };

  if (hasWeak) return { label: "Weak Opportunity", score: 20 };

  if (hasContextual && !nonFencePrimary) return { label: "Weak Opportunity", score: 24 };

  return { label: "No Evidence", score: 5 };
}

function fenceBidability(scopeConfidence, fenceSignals, primaryScope) {
  const label = scopeConfidence.label;
  if (label === "Primary Opportunity") {
    return { bidable: true, reason: "Strong direct fencing evidence; primary fencing opportunity." };
  }
  if (label === "Secondary Opportunity") {
    return { bidable: true, reason: "Direct fencing evidence supports bidding as a secondary scope." };
  }
  if (label === "Possible Opportunity") {
    if (isNonFencePrimaryScope(primaryScope)) {
      return { bidable: false, reason: `Primary scope is ${primaryScope.label}; fencing is incidental and not bidable.` };
    }
    return { bidable: true, reason: "Possible fencing scope; consider bidding with qualification." };
  }
  if (label === "Weak Opportunity") {
    return { bidable: false, reason: "Weak or contextual fencing signals only; not bidable without additional confirmation." };
  }
  if (isNonFencePrimaryScope(primaryScope)) {
    return { bidable: false, reason: `Primary scope is ${primaryScope?.label ?? "non-fence"}; no fencing evidence found.` };
  }
  return { bidable: false, reason: "No fencing evidence found; not bidable." };
}

function projectDescriptionFor(opportunity, document, categories, workCategories, tradeRelevance, fenceSignals = { evidence: [] }, primaryScope) {
  const projectName = cleanProjectName(opportunity.project_name);
  const sourceDescription = cleanSourceDescription(opportunity.project_description || document?.summary || "");
  if (sourceDescription && fenceSignals.evidence.length) {
    return sourceDescription;
  }
  if (sourceDescription && sourceDescription.length > 40) {
    return sourceDescription;
  }
  const primary = tradeRelevance.primary_work.toLowerCase();
  if (primaryScope?.label === "Electrical / landscape lighting") {
    return `${projectName} is an electrical/landscape lighting project. Fencing is not the primary scope.`;
  }
  if (primaryScope?.label === "Fence / gate installation") {
    return `${projectName} is a fence/gate installation project with direct fencing scope.`;
  }
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
  return `${projectName} appears to be a ${tradeRelevance.project_type.toLowerCase()} project focused on ${workCategories.join(", ").toLowerCase() || opportunity.trade?.toLowerCase() || "unknown"} work.`;
}

function scopeSummaryFor(opportunity, document, workCategories, primaryScope) {
  const source = document?.source_name ? `Source: ${document.source_name}.` : "Source: permit or opportunity record.";
  const scopeNote = primaryScope?.label && primaryScope.label !== "Unknown" ? ` Primary scope: ${primaryScope.label}.` : "";
  return `Work indicated: ${workCategories.join(", ") || opportunity.trade || "Unknown"}.${scopeNote} ${source}`;
}

function potentialFenceScope(categories, signals, primaryScope) {
  if (!signals.strongEvidence) return [];
  if (isNonFencePrimaryScope(primaryScope)) return [];
  const scopes = [];
  if (categories.includes("Housing")) scopes.push("Perimeter fencing", "Community fencing", "Construction fencing");
  if (categories.includes("Parks") || categories.includes("Schools")) scopes.push("Public access separation", "Decorative fencing");
  if (categories.includes("Utilities") || categories.includes("Drainage") || categories.includes("Infrastructure")) scopes.push("Construction fencing", "Access control gates");
  if (categories.includes("Industrial") || categories.includes("Security")) scopes.push("Security fencing", "Access control gates");
  if (signals.found.some((signal) => /boundary|access-control/i.test(signal))) scopes.push("Gates");
  return [...new Set(scopes)].slice(0, 5);
}

function confidenceReasoning(scopeConfidence, signals, categories, document, primaryScope, bidability) {
  const evidenceStrength = document ? "source document evidence is available" : "only permit/opportunity metadata is available";
  const bidNote = bidability ? (bidability.bidable ? " Bidable." : ` Not bidable: ${bidability.reason}`) : "";
  return `${scopeConfidence.label}: ${signals.evidence.length} strong fence evidence signal(s), ${signals.weakEvidence?.length ?? 0} weak signal(s), ${signals.found.length} total signal(s), ${signals.missing.length} limiting signal(s), categories ${categories.join(", ") || "unclassified"}, primary scope ${primaryScope?.label ?? "Unknown"}, and ${evidenceStrength}.${bidNote}`;
}

function whyFencingRelevant(scopeConfidence, signals, categories = [], workCategories = [], primaryScope) {
  if (scopeConfidence.label === "No Evidence") {
    if (isNonFencePrimaryScope(primaryScope)) {
      return `Primary scope is ${primaryScope.label}. Incidental gate or fence mentions are not indicative of a bidable fencing opportunity.`;
    }
    return "No direct fencing references found. Additional document review is required before treating this as a fencing opportunity.";
  }
  if (scopeConfidence.label === "Weak Opportunity") {
    return "No strong fencing references found. The project has contextual or weak indicators only; fencing is possible but unconfirmed and not bidable without additional evidence.";
  }
  const snippet = signals.snippets?.[0]?.text;
  if (snippet) {
    if (/\bgates?\b/i.test(snippet) && /\bfenc/i.test(snippet)) {
      return `Source document specifies gate and fencing installation: "${snippet}"`;
    }
    if (/\bgates?\b/i.test(snippet)) {
      return `Source document references gate work that is fencing-relevant: "${snippet}"`;
    }
    if (/detention basin/i.test(snippet)) {
      return `Detention basin construction often requires perimeter safety fencing. Source document references: "${snippet}"`;
    }
    if (/school/i.test(snippet) || categories.includes("Schools")) {
      return `School site improvements commonly include perimeter fencing and controlled access points. Source: "${snippet}"`;
    }
    if (/park|trail|sports field/i.test(snippet) || categories.includes("Parks")) {
      return `Public recreation improvements commonly include separation fencing or gates. Source: "${snippet}"`;
    }
    return `Fence relevance is supported by source evidence: "${snippet}"`;
  }
  if (signals.evidence.length) {
    const context = workCategories.length ? ` Project work includes ${workCategories.slice(0, 3).join(", ").toLowerCase()}.` : "";
    return `Fence relevance is supported by direct evidence: ${signals.evidence.join("; ")}.${context}`;
  }
  return `Fence relevance is supported by direct evidence: ${signals.evidence.join("; ")}.`;
}

function evidenceFor(opportunity, document, fenceSignals = { snippets: [] }) {
  return [
    ...(fenceSignals.snippets ?? []).map((snippet) => snippet.text),
    document?.summary,
    opportunity.project_description,
    document?.source_url ?? opportunity.source_url,
    opportunity.qualification_reason,
  ].filter(Boolean);
}

function snippetForMatch(text, index) {
  const start = Math.max(0, text.lastIndexOf(".", index - 1) + 1);
  const nextPeriod = text.indexOf(".", index);
  const end = nextPeriod === -1 ? Math.min(text.length, index + 180) : nextPeriod + 1;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function cleanSourceDescription(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+New Building or Addition.*$/i, "")
    .replace(/\s+-\s+Miscellaneous,.*$/i, "")
    .trim();
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
    `- Bidable rows: ${rows.filter((row) => row.fencing_bidable).length}`,
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
    ["Primary Scope", (row) => row.primary_scope],
    ["Primary Work", (row) => row.primary_work],
    ["Likely Trades", (row) => row.likely_trades.join(", ") || "Unknown"],
    ["Categories", (row) => row.project_categories.join(", ") || "Unclassified"],
    ["Fence Scope", (row) => row.fence_scope_confidence],
    ["Bidable", (row) => row.fencing_bidable ? "Yes" : "No"],
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

function tradeSignalsFor(opportunity, document) {
  return [...new Set([...(document?.trades ?? []), ...(opportunity.trade ?? "").split(",").map((trade) => trade.trim()).filter(Boolean)])];
}
