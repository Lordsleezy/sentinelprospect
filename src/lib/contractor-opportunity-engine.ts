import contractorRows from "../../data/contractor_opportunities.json";
import actionRows from "../../data/contractor_action_opportunities.json";
import scopeRows from "../../data/scope_intelligence.json";
import evidenceExpansionRows from "../../data/evidence_expansion.json";

export type ScopeSize = "Tiny" | "Small" | "Medium" | "Large" | "Major";
export type SubcontractorLikelihood = "High" | "Medium" | "Low" | "Unknown";

export type TradeScore = {
  trade: string;
  trade_relevance: number;
  contractor_opportunity_score: number;
  existing_contractor_saturation_penalty: number;
  noise_penalty: number;
};

export type ContractorOpportunity = {
  id: string;
  project_name: string;
  project_location: string;
  city: string;
  county: string;
  opportunity_state: string;
  opportunity_score: number;
  qualification_score: number;
  fence_probability: number;
  access_score: number;
  developer: string;
  general_contractor: string;
  architect: string;
  procurement_route: string;
  entry_method: string;
  access_route: string;
  recommended_next_step: string;
  known_access_routes: string[];
  approval_required: boolean | "Often";
  evidence_quality: string;
  evidence_count: number;
  fencing_signal_presence: boolean;
  fast_money_potential: string;
  trade: string;
  source_url: string;
  contractor_opportunity_score: number;
  primary_contractor_trade: string;
  trade_relevance: number;
  subcontractor_likelihood: SubcontractorLikelihood;
  subcontractor_likelihood_score: number;
  scope_size: ScopeSize;
  scope_size_score: number;
  opportunity_size: string;
  opportunity_size_score: number;
  project_stage: string;
  project_stage_score: number;
  existing_contractor_saturation: string;
  existing_contractor_saturation_penalty: number;
  contractor_visible: boolean;
  suppress_reasons: string[];
  trade_scores: Record<string, TradeScore>;
  qualification_reason: string;
  actionability_score: number;
  recommended_action: string;
  outreach_script: string;
  likely_scope: string;
  best_contact?: { name?: string; company: string; phone?: string; email?: string; title?: string };
  access_path: { type: string; value: string };
  access_path_type?: string;
  procurement_stage?: string;
  subcontractor_award_probability?: string;
  subcontractor_award_probability_score?: number | null;
  subcontractor_award_reasoning?: string | null;
  decision_maker?: string | null;
  decision_maker_role?: string | null;
  decision_maker_company?: string | null;
  decision_maker_phone?: string | null;
  decision_maker_email?: string | null;
  second_contact?: string | null;
  second_contact_role?: string | null;
  second_contact_company?: string | null;
  second_contact_phone?: string | null;
  second_contact_email?: string | null;
  escalation_path?: string[];
  who_controls_subcontractor_selection?: string | null;
  who_awards_fence_packages?: string | null;
  recommended_first_call?: string | null;
  call_readiness_score?: number;
  populated_fields: Record<string, string | undefined>;
  missing_intelligence: string[];
  project_summary: string;
  scope_summary: string;
  project_categories: string[];
  work_categories: string[];
  project_type?: string;
  primary_work?: string;
  secondary_work?: string[];
  likely_trades?: string[];
  trade_confidence?: number;
  fence_evidence?: string[];
  negative_fence_evidence?: string[];
  fence_signal_score: number;
  fence_signals_found: string[];
  fence_signals_missing: string[];
  fence_scope_confidence: string;
  potential_fencing_scope: string[];
  why_fencing_relevant: string;
  confidence_reasoning: string;
  project_dossier?: {
    project_summary: string;
    associated_improvements: string[];
    related_development: string;
    developer: string;
    applicant: string;
    owner: string;
    work_categories: string[];
    primary_objective: string;
    scope_summary: string;
    evidence_summary: string;
    evidence_sources: Array<{ label: string; source_url: string; source_type: string; summary: string }>;
    supporting_evidence: string[];
    evidence_fence_signals: Array<{ signal: string; snippet?: string; source: string; source_document_id?: string; source_url: string; source_type?: string }>;
    evidence_negative_signals: Array<{ signal: string; snippet?: string; source: string; source_document_id?: string; source_url: string; source_type?: string }>;
    evidence_snippets?: Array<{
      text?: string;
      snippet: string;
      signal: string;
      source: string;
      source_document?: string;
      source_document_id?: string;
      source_url: string;
      source_type?: string;
      confidence?: string;
    }>;
    why_fencing_is_relevant: string;
    why_fencing_matters?: string;
    confidence_reasoning: string;
  };
  evidence_summary?: string;
  supporting_evidence?: string[];
  evidence_fence_signals?: Array<{ signal: string; snippet?: string; source: string; source_document_id?: string; source_url: string; source_type?: string }>;
  evidence_snippets?: Array<{
    text?: string;
    snippet: string;
    signal: string;
    source: string;
    source_document?: string;
    source_document_id?: string;
    source_url: string;
    source_type?: string;
    confidence?: string;
  }>;
  why_fencing_matters?: string;
  evidence_fence_signal_score?: number;
  evidence_strength_score?: number;
  source_count?: number;
  evidence_sources?: Array<{ label: string; source_url: string; source_type: string; summary: string; title?: string; source_name?: string }>;
  evidence_likely_fence_scope?: string;
  fencing_bidable?: boolean;
  fencing_bidability_reason?: string;
  primary_scope?: string;
  fence_evidence_tier?: string;
  contradiction_notes?: string[];
};

type ContractorActionFields = Pick<
  ContractorOpportunity,
  | "actionability_score"
  | "recommended_action"
  | "outreach_script"
  | "likely_scope"
  | "best_contact"
  | "access_path"
  | "access_path_type"
  | "procurement_stage"
  | "subcontractor_award_probability"
  | "subcontractor_award_probability_score"
  | "subcontractor_award_reasoning"
  | "decision_maker"
  | "decision_maker_role"
  | "decision_maker_company"
  | "decision_maker_phone"
  | "decision_maker_email"
  | "second_contact"
  | "second_contact_role"
  | "second_contact_company"
  | "second_contact_phone"
  | "second_contact_email"
  | "escalation_path"
  | "who_controls_subcontractor_selection"
  | "who_awards_fence_packages"
  | "recommended_first_call"
  | "call_readiness_score"
  | "populated_fields"
  | "missing_intelligence"
> & {
  opportunity_id: string;
};

const actionsByOpportunity = new Map(((actionRows as unknown) as ContractorActionFields[]).map((row) => [row.opportunity_id, row]));
const scopesByOpportunity = new Map(((scopeRows as unknown) as Array<{ opportunity_id: string }>).map((row) => [row.opportunity_id, row]));
const evidenceExpansionByOpportunity = new Map(((evidenceExpansionRows as unknown) as Array<{ opportunity_id: string; likely_fence_scope?: string }>).map((row) => [row.opportunity_id, row]));
const contractorOpportunities = ((contractorRows as unknown) as ContractorOpportunity[]).map((opportunity) => ({
  ...opportunity,
  ...(actionsByOpportunity.get(opportunity.id) ?? {}),
  ...(scopesByOpportunity.get(opportunity.id) ?? {}),
  ...(evidenceExpansionByOpportunity.get(opportunity.id) ?? {}),
  evidence_likely_fence_scope: evidenceExpansionByOpportunity.get(opportunity.id)?.likely_fence_scope,
})) as ContractorOpportunity[];
const contractorOpportunityByProjectName = new Map(contractorOpportunities.map((opportunity) => [normalizeKey(opportunity.project_name), opportunity]));

const POSITIVE_FENCE_EVIDENCE_PATTERN = /\b(perimeter fencing|boundary fencing|security fencing|access control|gate systems?|detention basin fencing|trail fencing|park fencing|school fencing|enclosure requirements?|wall\/fence|wall and fence|fence package|fencing package|subdivision perimeter|hoa fencing|screening requirements?|fencing|fence|gates?|enclosure|screening)\b/i;

const aliases: Record<string, string[]> = {
  fence: ["Fencing"],
  fencing: ["Fencing"],
  gate: ["Fencing", "Security"],
  gates: ["Fencing", "Security"],
  concrete: ["Concrete"],
  roofer: ["Roofing"],
  roofers: ["Roofing"],
  roofing: ["Roofing"],
  roof: ["Roofing"],
  electrician: ["Electrical"],
  electricians: ["Electrical"],
  electrical: ["Electrical"],
  plumber: ["Plumbing"],
  plumbers: ["Plumbing"],
  plumbing: ["Plumbing"],
  hvac: ["HVAC"],
  mechanical: ["HVAC"],
  landscaper: ["Landscaping"],
  landscapers: ["Landscaping"],
  landscaping: ["Landscaping"],
  demolition: ["Demolition"],
  demo: ["Demolition"],
  utility: ["Utility", "Site work"],
  utilities: ["Utility", "Site work"],
  sitework: ["Site work"],
  "site work": ["Site work"],
  solar: ["Solar", "Electrical"],
  security: ["Security"],
  asphalt: ["Asphalt"],
  paving: ["Asphalt", "Site work"],
  gc: ["General Contractor"],
  contractor: [],
  contractors: [],
};

/** Direct evidence terms used to hard-filter non-fencing trade searches. */
const TRADE_EVIDENCE_TERMS: Record<string, string[]> = {
  Fencing: ["fence", "fencing", "gate", "gates", "chain link", "perimeter fence", "security fence"],
  Concrete: ["concrete", "slab", "foundation", "sidewalk", "curb", "gutter", "flatwork"],
  Roofing: ["roofing", "reroof", "re-roof", "tpo", "membrane", "capsheet", "shingle", "roof geometry", "update roof"],
  Electrical: ["electrical", "electrician", "electric", "solar", "photovoltaic", "pv ", "pv+", "service panel", "lighting", "panel upgrade"],
  Plumbing: ["plumbing", "plumber", "sewer", "water line", "gas line", "backflow"],
  HVAC: ["hvac", "package unit", "package units", "rtu", "air conditioning", "heat pump", "mech (", "mech(", "mechanical system", "mechanical equipment", "rooftop packaged", "split system"],
  Landscaping: ["landscape", "landscaping", "irrigation", "planting", "turf"],
  Demolition: ["demo", "demolition", "wrecking"],
  Utility: ["utility", "utilities", "drainage", "sewer", "water main", "storm"],
  "Site work": ["site work", "grading", "earthwork", "excavation", "paving"],
  Solar: ["solar", "photovoltaic", "pv ", "energy storage", "battery"],
  Security: ["security", "access control", "camera", "alarm"],
  Asphalt: ["asphalt", "paving", "parking lot"],
  "General Contractor": ["general contractor", "tenant improvement", "remodel", "addition"],
};

export function getContractorOpportunitySearchResults(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const queryTerms = terms(trimmed);
  const targetTrades = inferSearchTrades(trimmed);
  const fencingOnlySearch = isFencingOnlySearch(targetTrades);

  return contractorOpportunities
    .filter((opportunity) => !shouldSuppressFencingSearchResult(opportunity, targetTrades))
    .map((opportunity) => {
      const tradeScore = bestTradeScoreForQuery(opportunity, targetTrades);
      return {
        opportunity: applySearchTradeScore(opportunity, tradeScore),
        score: scoreContractorOpportunity(opportunity, queryTerms, targetTrades, tradeScore),
        tradeScore,
      };
    })
    .filter((item) =>
      item.score >= 35
      && item.opportunity.suppress_reasons.length === 0
      && scopeMatchesSearch(item.opportunity, targetTrades, item.tradeScore)
    )
    .sort((a, b) => {
      if (fencingOnlySearch) {
        return (
          fenceScopeRank(b.opportunity.fence_scope_confidence) - fenceScopeRank(a.opportunity.fence_scope_confidence)
          || effectiveFenceSignalScore(b.opportunity) - effectiveFenceSignalScore(a.opportunity)
          || b.opportunity.contractor_opportunity_score - a.opportunity.contractor_opportunity_score
          || b.opportunity.actionability_score - a.opportunity.actionability_score
          || contactQuality(b.opportunity) - contactQuality(a.opportunity)
          || b.score - a.score
        );
      }
      return (
        (b.tradeScore?.trade_relevance ?? 0) - (a.tradeScore?.trade_relevance ?? 0)
        || b.opportunity.contractor_opportunity_score - a.opportunity.contractor_opportunity_score
        || b.score - a.score
        || b.opportunity.actionability_score - a.opportunity.actionability_score
        || contactQuality(b.opportunity) - contactQuality(a.opportunity)
      );
    })
    .slice(0, 30)
    .map((item) => item.opportunity);
}

export function getContractorOpportunityByProjectId(id: string) {
  return contractorOpportunities.find((opportunity) => opportunity.id === id) ?? null;
}

export function getContractorOpportunityForProject(projectId: string, projectName: string) {
  return (
    getContractorOpportunityByProjectId(projectId)
    ?? getContractorOpportunityByProjectId(`sac-${projectId}`)
    ?? contractorOpportunityByProjectName.get(normalizeKey(projectName))
    ?? null
  );
}

export function inferSearchTrades(query: string) {
  const normalized = query.toLowerCase();
  const trades = new Set<string>();
  for (const [alias, values] of Object.entries(aliases)) {
    if (normalized.includes(alias)) values.forEach((trade) => trades.add(trade));
  }
  return [...trades];
}

function bestTradeScoreForQuery(opportunity: ContractorOpportunity, targetTrades: string[]) {
  const scores = targetTrades.length
    ? targetTrades.map((trade) => opportunity.trade_scores[trade]).filter(Boolean)
    : Object.values(opportunity.trade_scores);
  return [...scores].sort((a, b) => b.contractor_opportunity_score - a.contractor_opportunity_score)[0] ?? null;
}

function applySearchTradeScore(opportunity: ContractorOpportunity, tradeScore: TradeScore | null): ContractorOpportunity {
  if (!tradeScore) return opportunity;
  const likelyScope = likelyScopeForTrade(opportunity, tradeScore.trade);
  const contractorScore = tradeScore.trade === "Fencing" ? fencingContractorScore(opportunity, tradeScore) : tradeScore.contractor_opportunity_score;
  const tradeRelevance = tradeScore.trade === "Fencing" ? fencingTradeRelevance(opportunity, tradeScore) : tradeScore.trade_relevance;
  return {
    ...opportunity,
    contractor_opportunity_score: contractorScore,
    primary_contractor_trade: tradeScore.trade,
    trade_relevance: tradeRelevance,
    existing_contractor_saturation_penalty: tradeScore.existing_contractor_saturation_penalty,
    suppress_reasons: searchSuppressReasons(opportunity, tradeScore),
    likely_scope: likelyScope,
    recommended_action: recommendedActionForTrade(opportunity, tradeScore.trade, likelyScope),
    outreach_script: outreachScriptForTrade(opportunity, tradeScore.trade, likelyScope),
  };
}

function scoreContractorOpportunity(opportunity: ContractorOpportunity, queryTerms: string[], targetTrades: string[], tradeScore: TradeScore | null) {
  if (!tradeScore) return 0;
  const adjusted = applySearchTradeScore(opportunity, tradeScore);
  const text = [
    opportunity.project_name,
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
    opportunity.qualification_reason,
  ].join(" ").toLowerCase();

  let score = Math.round((adjusted.actionability_score ?? 0) * 0.55 + tradeScore.contractor_opportunity_score * 0.35);
  if (targetTrades.includes("Fencing") && isFencingOnlySearch(targetTrades)) {
    score = Math.round(
      fenceScopeRank(adjusted.fence_scope_confidence) * 16
      + effectiveFenceSignalScore(adjusted) * 0.34
      + tradeScore.contractor_opportunity_score * 0.28
      + (adjusted.actionability_score ?? 0) * 0.16
      + contactQuality(adjusted) * 0.06
    );
  } else if (targetTrades.length) {
    // Non-fencing trade searches should be driven by trade evidence, not fencing actionability.
    score = Math.round(
      tradeScore.trade_relevance * 0.42
      + tradeScore.contractor_opportunity_score * 0.38
      + (adjusted.actionability_score ?? 0) * 0.12
      + contactQuality(adjusted) * 0.08
    );
  }
  score += queryTerms.reduce((sum, term) => sum + (text.includes(term) ? 3 : 0), 0);
  if (targetTrades.length && tradeScore.trade_relevance < 35) score -= 30;
  if (adjusted.suppress_reasons.length) score -= adjusted.suppress_reasons.length * 22;
  if (/sacramento/i.test(text) && queryTerms.includes("sacramento")) score += 8;
  if (opportunity.access_score >= 70) score += 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function searchSuppressReasons(opportunity: ContractorOpportunity, tradeScore: TradeScore) {
  const reasons = [...opportunity.suppress_reasons.filter((reason) => reason !== "Weak trade relevance")];
  if (tradeScore.trade_relevance < 25) reasons.push("Weak trade relevance");
  if (tradeScore.existing_contractor_saturation_penalty >= 40 && !reasons.includes("Existing GC appears to be the searched trade contractor")) {
    reasons.push("Existing GC appears to be the searched trade contractor");
  }
  if (tradeScore.noise_penalty > 0 && !reasons.includes("Likely noise match")) reasons.push("Likely noise match");
  return [...new Set(reasons)];
}

function isFencingOnlySearch(targetTrades: string[]) {
  return targetTrades.length === 1 && targetTrades[0] === "Fencing";
}

function scopeMatchesSearch(opportunity: ContractorOpportunity, targetTrades: string[], tradeScore: TradeScore | null) {
  if (!targetTrades.length) return true;

  if (isFencingOnlySearch(targetTrades)) {
    if (opportunity.fencing_bidable === false) return false;
    if (["Weak Opportunity", "Weak Signal", "No Evidence", "No Meaningful Fence Opportunity"].includes(opportunity.fence_scope_confidence)) return false;
    return positiveFenceEvidence(opportunity).length > 0;
  }

  // Non-fencing (or mixed) trade searches must match the requested trade with direct evidence.
  // Do not silently fall back to fencing-ranked opportunities.
  return targetTrades.some((trade) => matchesRequestedTrade(opportunity, trade, tradeScore));
}

function matchesRequestedTrade(opportunity: ContractorOpportunity, trade: string, tradeScore: TradeScore | null) {
  if (trade === "Fencing") {
    if (opportunity.fencing_bidable === false) return false;
    if (["Weak Opportunity", "Weak Signal", "No Evidence", "No Meaningful Fence Opportunity"].includes(opportunity.fence_scope_confidence)) return false;
    return positiveFenceEvidence(opportunity).length > 0;
  }

  const score = tradeScore?.trade === trade ? tradeScore : opportunity.trade_scores?.[trade];
  if (!score || score.trade_relevance < 50 || score.contractor_opportunity_score < 35) return false;
  return hasDirectTradeEvidence(opportunity, trade);
}

function hasDirectTradeEvidence(opportunity: ContractorOpportunity, trade: string) {
  const termsForTrade = TRADE_EVIDENCE_TERMS[trade] ?? [trade.toLowerCase()];
  const nameSummary = `${opportunity.project_name} ${opportunity.project_summary ?? ""}`.toLowerCase();
  // Permit boilerplate often says "no additional electrical, mechanical, plumbing" — ignore that.
  const cleaned = nameSummary.replace(/no additional[^.]{0,80}(electrical|mechanical|plumbing|structural)[^.]{0,80}/gi, " ");
  if (termsForTrade.some((term) => cleaned.includes(term))) return true;

  // Fall back to a clean single-trade tag only when the project name/summary has no cue.
  // Multi-tagged trade fields (e.g. "Electrical, Fencing, HVAC") are too noisy to trust alone.
  const tradeTokens = (opportunity.trade ?? "")
    .toLowerCase()
    .split(/[,/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (tradeTokens.length !== 1) return false;
  const onlyTrade = tradeTokens[0];
  return onlyTrade === trade.toLowerCase() || onlyTrade.includes(trade.toLowerCase());
}

export function positiveFenceEvidence(opportunity: ContractorOpportunity) {
  const strongPattern = /\b(fence installation|fence package|chain-link|chain link|ornamental|wrought|gate installation|slid(?:e|ing) gates?|automat(?:ic|ed)|steel gate|security gate|vehicle gate|pedestrian gate|ada ped|ped gates?|detention basin fencing|park fencing|school fencing|trail fencing|sports field fencing|new fence|raise fence|pool safety|security fence|gates\/fence|fencing with|direct fence|new gates|install\/raise|chain link fencing)\b/i;
  return [
    ...(opportunity.fence_evidence ?? []),
    ...(opportunity.evidence_fence_signals?.map((signal) => signal.signal) ?? []),
    ...(opportunity.project_dossier?.evidence_fence_signals?.map((signal) => signal.signal) ?? []),
  ].filter((signal) => strongPattern.test(signal) || POSITIVE_FENCE_EVIDENCE_PATTERN.test(signal))
    .filter((signal) => !/incidental|weak mention|enclosure or screen/i.test(signal));
}

function shouldSuppressFencingSearchResult(opportunity: ContractorOpportunity, targetTrades: string[]) {
  if (!targetTrades.includes("Fencing")) return false;
  if (opportunity.fencing_bidable === false) return true;
  if (["No Evidence", "No Meaningful Fence Opportunity", "Weak Opportunity", "Weak Signal"].includes(opportunity.fence_scope_confidence)) return true;
  return positiveFenceEvidence(opportunity).length === 0;
}

function fencingContractorScore(opportunity: ContractorOpportunity, tradeScore: TradeScore) {
  const directEvidenceScore = Math.min(100, positiveFenceEvidence(opportunity).length * 30);
  const signalScore = effectiveFenceSignalScore(opportunity);
  return Math.max(0, Math.min(100, Math.round(
    fenceScopeRank(opportunity.fence_scope_confidence) * 14
    + signalScore * 0.32
    + directEvidenceScore * 0.24
    + Math.min(tradeScore.contractor_opportunity_score, 100) * 0.18
    + (opportunity.subcontractor_likelihood_score ?? 0) * 0.12
  )));
}

function fencingTradeRelevance(opportunity: ContractorOpportunity, tradeScore: TradeScore) {
  const directEvidence = positiveFenceEvidence(opportunity).length;
  if (directEvidence > 0) return Math.max(tradeScore.trade_relevance, Math.min(100, 55 + directEvidence * 15));
  if (["No Evidence", "No Meaningful Fence Opportunity"].includes(opportunity.fence_scope_confidence)) return 0;
  if (["Weak Opportunity", "Weak Signal"].includes(opportunity.fence_scope_confidence)) return Math.min(tradeScore.trade_relevance, 25);
  return Math.min(tradeScore.trade_relevance, 45);
}

function terms(query: string) {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1))];
}

function likelyScopeForTrade(opportunity: ContractorOpportunity, trade: string) {
  const text = `${opportunity.project_name} ${opportunity.trade} ${opportunity.qualification_reason}`.toLowerCase();
  if (trade === "Fencing") {
    if (["Weak Signal", "Weak Opportunity"].includes(opportunity.fence_scope_confidence)) return "Insufficient evidence to determine likely fencing scope.";
    if (["No Meaningful Fence Opportunity", "No Evidence"].includes(opportunity.fence_scope_confidence)) return "No fencing scope generated.";
    if (opportunity.fencing_bidable === false) return "No bid-able fencing scope generated.";
    if (opportunity.evidence_likely_fence_scope) return opportunity.evidence_likely_fence_scope;
    if (opportunity.potential_fencing_scope?.length) return opportunity.potential_fencing_scope[0];
    if (/new\s*\(?gates?|sliding gate|automatic gate|steel gate|security gate|install(?:ation)? of .{0,40}gate/.test(text)) return "Gate installation";
    if (/park/.test(text)) return "Park fencing";
    if (/school/.test(text)) return "School perimeter fencing";
    if (/fence|fencing/.test(text)) return "Fence installation";
    return "Source-backed fencing scope";
  }
  return trade === opportunity.primary_contractor_trade ? opportunity.likely_scope : `${trade} scope`;
}

function fenceScopeRank(value: string) {
  const ranks: Record<string, number> = {
    "Primary Opportunity": 5,
    "Primary Scope": 5,
    "Secondary Opportunity": 4,
    "Secondary Scope": 4,
    "Possible Opportunity": 3,
    "Possible Scope": 3,
    "Weak Opportunity": 1,
    "Weak Signal": 1,
    "No Evidence": 0,
    "No Meaningful Fence Opportunity": 0,
  };
  return ranks[value] ?? 0;
}

function contactQuality(opportunity: ContractorOpportunity) {
  const contact = opportunity.best_contact;
  if (contact?.phone) return 100;
  if (contact?.email) return 70;
  if (contact?.company) return 40;
  if (opportunity.access_path?.type && opportunity.access_path.type !== "Unknown") return 25;
  return 0;
}

function effectiveFenceSignalScore(opportunity: ContractorOpportunity) {
  return Math.max(opportunity.evidence_fence_signal_score ?? 0, opportunity.fence_signal_score ?? 0);
}

function recommendedActionForTrade(opportunity: ContractorOpportunity, trade: string, likelyScope: string) {
  const projectName = cleanProjectName(opportunity.project_name);
  const scope = likelyScope.toLowerCase();
  const contact = opportunity.best_contact;
  if (contact?.phone) {
    return `Call ${contact.name ?? contact.company} and ask for the site development, estimating, or purchasing department regarding ${scope} opportunities for ${projectName}.`;
  }
  if (contact?.email) {
    return `Email ${contact.name ?? contact.company} and ask who handles subcontractor pricing for ${scope} work on ${projectName}.`;
  }
  if (opportunity.access_path?.type && opportunity.access_path.type !== "Unknown") {
    return `Use the ${opportunity.access_path.type.toLowerCase()} access path for ${projectName} and ask how ${trade.toLowerCase()} subcontractors should be considered.`;
  }
  return `Research the developer or general contractor for ${projectName} before outreach.`;
}

function outreachScriptForTrade(opportunity: ContractorOpportunity, trade: string, likelyScope: string) {
  const contact = opportunity.best_contact;
  const company = contact?.company ?? opportunity.populated_fields?.general_contractor ?? opportunity.populated_fields?.developer ?? "your project team";
  return `Hi, this is [Name] with [Company]. I'm calling about ${cleanProjectName(opportunity.project_name)}. I saw source evidence for the project and wanted to ask who handles ${likelyScope.toLowerCase()} or ${trade.toLowerCase()} subcontractor pricing for ${company}.`;
}

function cleanProjectName(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
