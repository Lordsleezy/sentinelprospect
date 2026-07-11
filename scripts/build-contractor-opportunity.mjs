import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const accessOpportunities = await readJson("data/access_opportunity_results.json") ?? [];
const capturedAt = new Date().toISOString();

const tradeModels = [
  {
    trade: "Fencing",
    terms: ["fence", "fencing", "gate", "gates", "chain link", "perimeter", "security fence", "access control"],
    adjacent: ["subdivision", "school", "park", "utility", "commercial", "industrial", "apartment", "site work", "drainage", "public works"],
    saturation: ["fence", "fencing", "gate", "gates", "entry controls", "access control"],
  },
  {
    trade: "Concrete",
    terms: ["concrete", "slab", "foundation", "footing", "stemwall", "sidewalk", "curb", "gutter", "flatwork", "driveway"],
    adjacent: ["subdivision", "commercial", "industrial", "school", "park", "utility", "site work"],
    saturation: ["concrete", "cement", "flatwork"],
  },
  {
    trade: "Painting",
    terms: ["paint", "painting", "painter", "coating", "stain"],
    adjacent: ["commercial", "apartment", "school", "tenant improvement", "residential"],
    saturation: ["paint", "painting", "painter"],
  },
  {
    trade: "Carpentry",
    terms: ["carpenter", "carpentry", "framing", "rough frame", "finish carpentry", "cabinets", "millwork", "trim"],
    adjacent: ["residential", "commercial", "apartment", "tenant improvement", "addition"],
    saturation: ["carpenter", "carpentry", "framing", "cabinets"],
  },
  {
    trade: "Roofing",
    terms: ["roof", "roofing", "reroof", "tpo", "membrane", "capsheet", "shingle"],
    adjacent: ["commercial", "school", "industrial", "apartment", "tenant improvement"],
    saturation: ["roof", "roofing"],
  },
  {
    trade: "Electrical",
    terms: ["electrical", "electric", "solar", "pv", "service panel", "lighting", "power"],
    adjacent: ["commercial", "industrial", "school", "utility", "subdivision", "tenant improvement"],
    saturation: ["electrical", "electric", "solar"],
  },
  {
    trade: "Plumbing",
    terms: ["plumbing", "sewer", "water", "gas line", "backflow", "drain"],
    adjacent: ["commercial", "school", "apartment", "subdivision", "utility", "tenant improvement"],
    saturation: ["plumbing", "plumber"],
  },
  {
    trade: "HVAC",
    terms: ["hvac", "mechanical", "package unit", "rtu", "air conditioning", "heat pump"],
    adjacent: ["commercial", "school", "industrial", "tenant improvement", "apartment"],
    saturation: ["hvac", "mechanical", "heating", "air"],
  },
  {
    trade: "Landscaping",
    terms: ["landscape", "landscaping", "irrigation", "planting", "turf"],
    adjacent: ["subdivision", "park", "school", "commercial", "apartment"],
    saturation: ["landscape", "landscaping", "irrigation"],
  },
  {
    trade: "Demolition",
    terms: ["demo", "demolition", "remove", "removal"],
    adjacent: ["commercial", "industrial", "school", "public works", "redevelopment"],
    saturation: ["demo", "demolition", "wrecking"],
  },
  {
    trade: "Utility",
    terms: ["utility", "utilities", "drainage", "sewer", "water main", "storm", "trunk"],
    adjacent: ["subdivision", "public works", "infrastructure", "commercial", "industrial"],
    saturation: ["utility", "utilities", "underground", "engineering"],
  },
  {
    trade: "Site work",
    terms: ["site work", "grading", "earthwork", "drainage", "paving", "utility", "excavation"],
    adjacent: ["subdivision", "commercial", "industrial", "school", "park", "public works"],
    saturation: ["site work", "grading", "earthwork", "excavating", "engineering"],
  },
  {
    trade: "Solar",
    terms: ["solar", "pv", "photovoltaic", "energy storage", "battery"],
    adjacent: ["commercial", "school", "industrial", "subdivision", "utility"],
    saturation: ["solar", "renewable", "energy"],
  },
  {
    trade: "Security",
    terms: ["security", "access control", "camera", "alarm", "perimeter", "gate"],
    adjacent: ["commercial", "industrial", "school", "public works", "apartment"],
    saturation: ["security", "access control", "alarm", "entry controls"],
  },
  {
    trade: "Asphalt",
    terms: ["asphalt", "paving", "parking lot", "road", "driveway"],
    adjacent: ["commercial", "industrial", "school", "park", "public works", "subdivision"],
    saturation: ["asphalt", "paving"],
  },
  {
    trade: "General Contractor",
    terms: ["general contractor", "construction", "building", "tenant improvement", "remodel", "addition"],
    adjacent: ["commercial", "industrial", "school", "apartment", "public works"],
    saturation: ["general contractor", "builders", "construction"],
  },
];

const contractor_opportunities = accessOpportunities.map(buildContractorOpportunity);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/contractor_opportunities.json", contractor_opportunities),
  writeFile(resolve("reports/contractor-opportunities.md"), renderContractorOpportunities(contractor_opportunities)),
  writeFile(resolve("reports/top-contractor-opportunities.md"), renderTopContractorOpportunities(contractor_opportunities)),
]);

console.log(`Contractor opportunities evaluated: ${contractor_opportunities.length}.`);
console.log(`Visible contractor opportunities: ${contractor_opportunities.filter((row) => row.contractor_visible).length}.`);
console.log(`High contractor opportunity score: ${contractor_opportunities.filter((row) => row.contractor_opportunity_score >= 70).length}.`);

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

function buildContractorOpportunity(opportunity) {
  const text = searchableText(opportunity);
  const scope = classifyScope(text, opportunity);
  const stage = classifyStage(text, opportunity);
  const subcontractor = classifySubcontractorLikelihood(scope, text, opportunity);
  const opportunitySize = classifyOpportunitySize(scope, text, opportunity);
  const saturation = classifySaturation(text, opportunity);
  const tradeScores = Object.fromEntries(tradeModels.map((model) => [model.trade, scoreTrade(model, text, opportunity, scope, subcontractor, opportunitySize, stage, saturation)]));
  // Prefer trades with direct evidence; never let Fencing win a pure tie.
  const bestTrade = Object.entries(tradeScores).sort((a, b) => {
    const aDirect = hasDirectTradeHit(a[0], text) ? 1 : 0;
    const bDirect = hasDirectTradeHit(b[0], text) ? 1 : 0;
    return (
      b[1].contractor_opportunity_score - a[1].contractor_opportunity_score
      || bDirect - aDirect
      || (a[0] === "Fencing" ? 1 : 0) - (b[0] === "Fencing" ? 1 : 0)
      || a[0].localeCompare(b[0])
    );
  })[0];
  const suppressReasons = suppressionReasons(scope, subcontractor, stage, saturation, bestTrade?.[1]);
  const score = bestTrade?.[1].contractor_opportunity_score ?? 0;

  return {
    ...opportunity,
    contractor_opportunity_score: score,
    primary_contractor_trade: bestTrade?.[0] ?? "Unknown",
    trade_relevance: bestTrade?.[1].trade_relevance ?? 0,
    subcontractor_likelihood: subcontractor.label,
    subcontractor_likelihood_score: subcontractor.score,
    scope_size: scope.label,
    scope_size_score: scope.score,
    opportunity_size: opportunitySize.label,
    opportunity_size_score: opportunitySize.score,
    project_stage: stage.label,
    project_stage_score: stage.score,
    existing_contractor_saturation: saturation.label,
    existing_contractor_saturation_penalty: saturation.penalty,
    contractor_visible: score >= 35 && suppressReasons.length === 0,
    suppress_reasons: suppressReasons,
    trade_scores: tradeScores,
    qualification_reason: reasonFor(bestTrade?.[0] ?? "Unknown", bestTrade?.[1], scope, subcontractor, opportunitySize, stage, saturation, suppressReasons),
    last_verified: capturedAt,
  };
}

function scoreTrade(model, text, opportunity, scope, subcontractor, opportunitySize, stage, saturation) {
  const directHits = model.terms.filter((term) => includesTerm(text, term)).length;
  const adjacentHits = model.adjacent.filter((term) => includesTerm(text, term)).length;
  let tradeRelevance = Math.min(100, directHits * 28 + adjacentHits * 8);
  if (model.trade === "Fencing" && opportunity.fencing_signal_presence) tradeRelevance = Math.max(tradeRelevance, 65);
  if (model.trade === "Fencing" && opportunity.fence_probability >= 50) tradeRelevance = Math.max(tradeRelevance, opportunity.fence_probability);
  if (opportunity.trade?.toLowerCase().includes(model.trade.toLowerCase())) {
    // Multi-trade tags should not auto-boost every listed trade to 70.
    const tradeTokens = String(opportunity.trade).toLowerCase().split(/[,/|]+/).map((part) => part.trim()).filter(Boolean);
    if (tradeTokens.length === 1 || hasDirectTradeHit(model.trade, text)) {
      tradeRelevance = Math.max(tradeRelevance, 70);
    } else {
      tradeRelevance = Math.max(tradeRelevance, 48);
    }
  }
  if (!directHits && adjacentHits && ["Fencing", "Concrete", "Electrical", "Plumbing", "HVAC", "Landscaping", "Painting", "Carpentry", "Security", "Asphalt"].includes(model.trade)) {
    tradeRelevance = Math.min(tradeRelevance, 42);
  }

  const saturationPenalty = hasTradeContractorSaturation(opportunity.general_contractor, model) ? 42 : saturation.penalty;
  const noisePenalty = isNoiseMatch(text, model.trade) ? 28 : 0;
  const contractorOpportunityScore = clamp(Math.round(
    tradeRelevance * 0.28
    + scope.score * 0.18
    + subcontractor.score * 0.22
    + opportunitySize.score * 0.14
    + stage.score * 0.12
    + Math.min(opportunity.access_score ?? 0, 100) * 0.06
    - saturationPenalty
    - noisePenalty
  ));

  return {
    trade: model.trade,
    trade_relevance: tradeRelevance,
    contractor_opportunity_score: contractorOpportunityScore,
    existing_contractor_saturation_penalty: saturationPenalty,
    noise_penalty: noisePenalty,
  };
}

function searchableText(opportunity) {
  return [
    opportunity.project_name,
    opportunity.project_summary,
    opportunity.project_description,
    opportunity.scope_summary,
    opportunity.primary_scope,
    opportunity.likely_scope,
    opportunity.project_location,
    opportunity.city,
    opportunity.county,
    opportunity.trade,
    opportunity.developer,
    opportunity.general_contractor,
    opportunity.architect,
    opportunity.procurement_route,
    opportunity.entry_method,
    opportunity.access_route,
    opportunity.recommended_next_step,
    opportunity.opportunity_state,
    opportunity.evidence_quality,
    opportunity.fast_money_potential,
    ...(opportunity.known_access_routes ?? []),
    ...(opportunity.fence_evidence ?? []),
    ...(opportunity.potential_fencing_scope ?? []),
    ...(opportunity.project_categories ?? []),
    ...(opportunity.companies ?? []).map((company) => `${company.company_name} ${company.company_type}`),
  ].filter(Boolean).join(" ").toLowerCase();
}

function hasDirectTradeHit(trade, text) {
  const model = tradeModels.find((item) => item.trade === trade);
  if (!model) return text.includes(trade.toLowerCase());
  return model.terms.some((term) => includesTerm(text, term));
}

function classifyScope(text, opportunity) {
  if (/(subdivision|village|unit \d|phase|school|park|utility|trunk|drainage|public works|industrial|warehouse|apartment|commercial|shopping|corridor|infrastructure|master plan)/i.test(text)) {
    return { label: /trunk|infrastructure|subdivision|master plan|utility|school|industrial/i.test(text) ? "Major" : "Large", score: /trunk|infrastructure|subdivision|master plan|utility|school|industrial/i.test(text) ? 100 : 82 };
  }
  if (/(tenant improvement|ti |addition|remodel|new home|single family|adu|detached garage|reroof|roof top package|package unit)/i.test(text)) {
    return { label: "Small", score: 35 };
  }
  if (/(shed|repair|replace|like for like|minor|backyard|deck|patio cover|gate replacement|demo \(shed\)|accessory structure)/i.test(text)) {
    return { label: "Tiny", score: 10 };
  }
  if ((opportunity.evidence_count ?? 0) >= 5 || (opportunity.qualification_score ?? 0) >= 70) return { label: "Medium", score: 58 };
  return { label: "Small", score: 35 };
}

function classifySubcontractorLikelihood(scope, text, opportunity) {
  if (scope.label === "Major" || scope.label === "Large") return { label: "High", score: 90 };
  if (/(public works|bid|trade partner|vendor|commercial|industrial|school|apartment)/i.test(text)) return { label: "Medium", score: 62 };
  if (/(homeowner|single family|minor|repair|replace|shed|like for like|detached garage|deck|patio)/i.test(text)) return { label: "Low", score: 18 };
  if (opportunity.opportunity_state === "Actionable Opportunity") return { label: "Medium", score: 58 };
  return { label: "Unknown", score: 35 };
}

function classifyOpportunitySize(scope, text, opportunity) {
  if (scope.label === "Major") return { label: "Very High", score: 95 };
  if (scope.label === "Large") return { label: "High", score: 78 };
  if (/(commercial|industrial|school|public works|apartment)/i.test(text)) return { label: "Medium", score: 58 };
  if (scope.label === "Tiny") return { label: "Very Low", score: 8 };
  if ((opportunity.qualification_score ?? 0) >= 70) return { label: "Medium", score: 52 };
  return { label: "Low", score: 25 };
}

function classifyStage(text, opportunity) {
  if (/(planning|pre-construction|bid|permitting|application|review|issued)/i.test(text)) return { label: "Open", score: 82 };
  if (/(completed|closed|finalized|expired|final)/i.test(text)) return { label: "Late", score: 18 };
  if (opportunity.opportunity_state === "Actionable Opportunity" || opportunity.opportunity_state === "Research Required") return { label: "Open", score: 75 };
  return { label: "Unknown", score: 45 };
}

function classifySaturation(text, opportunity) {
  const gc = opportunity.general_contractor ?? "";
  if (!gc || gc === "Unknown") return { label: "Unknown", penalty: 0 };
  if (/(construction|builders|general engineering|development)/i.test(gc)) return { label: "General Contractor", penalty: 0 };
  return { label: "Possible Trade Contractor", penalty: 12 };
}

function suppressionReasons(scope, subcontractor, stage, saturation, bestTrade) {
  const reasons = [];
  if (scope.label === "Tiny") reasons.push("Tiny scope");
  if (subcontractor.label === "Low") reasons.push("Low subcontractor likelihood");
  if (stage.label === "Late") reasons.push("Late or closed stage");
  if ((bestTrade?.existing_contractor_saturation_penalty ?? 0) >= 40) reasons.push("Existing GC appears to be the searched trade contractor");
  if ((bestTrade?.trade_relevance ?? 0) < 25) reasons.push("Weak trade relevance");
  if ((bestTrade?.noise_penalty ?? 0) > 0) reasons.push("Likely noise match");
  return reasons;
}

function reasonFor(trade, tradeScore, scope, subcontractor, opportunitySize, stage, saturation, suppressReasons) {
  const base = `${trade} score ${tradeScore?.contractor_opportunity_score ?? 0}: ${scope.label} scope, ${subcontractor.label.toLowerCase()} subcontractor likelihood, ${opportunitySize.label.toLowerCase()} opportunity size, ${stage.label.toLowerCase()} stage.`;
  return suppressReasons.length ? `${base} Suppressed: ${suppressReasons.join(", ")}.` : base;
}

function hasTradeContractorSaturation(companyName, model) {
  const company = String(companyName ?? "").toLowerCase();
  if (!company || company === "unknown") return false;
  return model.saturation.some((term) => includesTerm(company, term));
}

function isNoiseMatch(text, trade) {
  if (trade === "Fencing" && /(demo \(shed\)|shed demolition|small shed|single gate|gate replacement|deck rail replacement)/i.test(text)) return true;
  if (trade === "Fencing" && /(solar|photovoltaic|energy storage)/i.test(text)) return true;
  if (trade === "Fencing" && /(electrical for landscaping|commercial electrical service|electrical service pedestal|landscape lighting|service pedestal)/i.test(text) && !/\b(new\s*\(?gates?|install(?:ation)? of .{0,40}gate|sliding gate|automatic gate|steel gate|security gate|fence|fencing)\b/i.test(text)) return true;
  if (trade === "Demolition" && /(shed|deck demo|interior demo).{0,30}(residential|single family|house)?/i.test(text)) return true;
  return false;
}

function includesTerm(text, term) {
  return text.includes(term.toLowerCase());
}

function renderContractorOpportunities(rows) {
  const visible = rows.filter((row) => row.contractor_visible);
  const suppressed = rows.length - visible.length;
  return [
    "# Contractor Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Opportunities evaluated: ${rows.length}`,
    `- Contractor-visible opportunities: ${visible.length}`,
    `- Suppressed/noisy opportunities: ${suppressed}`,
    `- Average contractor opportunity score: ${average(rows.map((row) => row.contractor_opportunity_score))}`,
    "",
    table(rows, contractorColumns()),
  ].join("\n");
}

function renderTopContractorOpportunities(rows) {
  return [
    "# Top Contractor Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table([...rows].sort((a, b) => b.contractor_opportunity_score - a.contractor_opportunity_score).slice(0, 40), contractorColumns()),
  ].join("\n");
}

function contractorColumns() {
  return [
    ["Project", (row) => row.project_name],
    ["Trade", (row) => row.primary_contractor_trade],
    ["Contractor Score", (row) => row.contractor_opportunity_score],
    ["Trade Relevance", (row) => row.trade_relevance],
    ["Scope", (row) => row.scope_size],
    ["Subcontractor Likelihood", (row) => row.subcontractor_likelihood],
    ["Opportunity Size", (row) => row.opportunity_size],
    ["Stage", (row) => row.project_stage],
    ["Saturation", (row) => row.existing_contractor_saturation],
    ["Visible", (row) => row.contractor_visible ? "Yes" : "No"],
    ["Reason", (row) => row.qualification_reason],
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

function escapeCell(value) {
  return String(value ?? "Unknown").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function average(values) {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1));
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}
