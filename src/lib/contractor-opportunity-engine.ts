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
  best_contact?: { name?: string; company: string; phone?: string; email?: string };
  access_path: { type: string; value: string };
  populated_fields: Record<string, string | undefined>;
  missing_intelligence: string[];
  project_summary: string;
  scope_summary: string;
  project_categories: string[];
  work_categories: string[];
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
    evidence_fence_signals: Array<{ signal: string; source: string; source_url: string }>;
    evidence_negative_signals: Array<{ signal: string; source: string; source_url: string }>;
    why_fencing_is_relevant: string;
    confidence_reasoning: string;
  };
  evidence_summary?: string;
  supporting_evidence?: string[];
  evidence_fence_signals?: Array<{ signal: string; source: string; source_url: string }>;
  evidence_fence_signal_score?: number;
  evidence_strength_score?: number;
  source_count?: number;
  evidence_likely_fence_scope?: string;
  contradiction_notes?: string[];
};

type ContractorActionFields = Pick<ContractorOpportunity, "actionability_score" | "recommended_action" | "outreach_script" | "likely_scope" | "best_contact" | "access_path" | "populated_fields" | "missing_intelligence"> & {
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

export function getContractorOpportunitySearchResults(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const queryTerms = terms(trimmed);
  const targetTrades = inferSearchTrades(trimmed);

  return contractorOpportunities
    .map((opportunity) => {
      const tradeScore = bestTradeScoreForQuery(opportunity, targetTrades);
      return {
        opportunity: applySearchTradeScore(opportunity, tradeScore),
        score: scoreContractorOpportunity(opportunity, queryTerms, targetTrades, tradeScore),
      };
    })
    .filter((item) => item.score >= 35 && item.opportunity.suppress_reasons.length === 0 && scopeMatchesSearch(item.opportunity, targetTrades))
    .sort((a, b) =>
      b.opportunity.actionability_score - a.opportunity.actionability_score ||
      b.score - a.score ||
      b.opportunity.contractor_opportunity_score - a.opportunity.contractor_opportunity_score ||
      b.opportunity.access_score - a.opportunity.access_score
    )
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
  return {
    ...opportunity,
    contractor_opportunity_score: tradeScore.contractor_opportunity_score,
    primary_contractor_trade: tradeScore.trade,
    trade_relevance: tradeScore.trade_relevance,
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

function scopeMatchesSearch(opportunity: ContractorOpportunity, targetTrades: string[]) {
  if (!targetTrades.includes("Fencing")) return true;
  return opportunity.fence_scope_confidence !== "No Meaningful Fence Opportunity";
}

function terms(query: string) {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1))];
}

function likelyScopeForTrade(opportunity: ContractorOpportunity, trade: string) {
  const text = `${opportunity.project_name} ${opportunity.trade} ${opportunity.qualification_reason}`.toLowerCase();
  if (trade === "Fencing") {
    if (opportunity.fence_scope_confidence === "Weak Signal") return "Insufficient evidence to determine likely fencing scope.";
    if (opportunity.fence_scope_confidence === "No Meaningful Fence Opportunity") return "No fencing scope generated.";
    if (opportunity.evidence_likely_fence_scope) return opportunity.evidence_likely_fence_scope;
    if (opportunity.potential_fencing_scope?.length) return opportunity.potential_fencing_scope[0];
    if (/park/.test(text)) return "Park fencing";
    if (/school/.test(text)) return "School perimeter fencing";
    if (/utility|drainage|trunk|corridor/.test(text)) return "Utility corridor fencing";
    if (/industrial|security|warehouse/.test(text)) return "Security fencing";
    if (/subdivision|village|master plan|lot|unit|homes|residential/.test(text)) return "Residential perimeter fencing";
    if (/gate/.test(text)) return "Gates";
    return "Construction fencing";
  }
  return trade === opportunity.primary_contractor_trade ? opportunity.likely_scope : `${trade} scope`;
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
  const company = contact?.company ?? opportunity.populated_fields.general_contractor ?? opportunity.populated_fields.developer ?? "your project team";
  return `Hi, this is [Name] with [Company]. I'm calling about ${cleanProjectName(opportunity.project_name)}. I saw source evidence for the project and wanted to ask who handles ${likelyScope.toLowerCase()} or ${trade.toLowerCase()} subcontractor pricing for ${company}.`;
}

function cleanProjectName(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
