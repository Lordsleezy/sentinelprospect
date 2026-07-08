import accessRows from "../../data/access_opportunity_results.json";

export type AccessOpportunityState = "Opportunity" | "Research Required" | "Actionable Opportunity";

export type AccessOpportunity = {
  id: string;
  project_name: string;
  project_location: string;
  city: string;
  county: string;
  opportunity_state: AccessOpportunityState;
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
};

const accessOpportunities = accessRows as AccessOpportunity[];

const aliases: Record<string, string[]> = {
  fence: ["fencing", "gate", "chain link", "perimeter", "security", "subdivision", "site work", "utility"],
  fencing: ["fence", "gate", "chain link", "perimeter", "security", "subdivision", "site work", "utility"],
  jobs: ["opportunity", "work", "permit", "planning", "bid"],
  job: ["opportunity", "work", "permit", "planning", "bid"],
  sacramento: ["sacramento", "south sacramento", "natomas"],
  subdivision: ["subdivision", "residential", "homes", "village", "lot"],
  subdivisions: ["subdivision", "residential", "homes", "village", "lot"],
  school: ["school", "public works", "bid", "vendor"],
  schools: ["school", "public works", "bid", "vendor"],
  park: ["park", "public works", "bid", "vendor"],
  parks: ["park", "public works", "bid", "vendor"],
  utility: ["utility", "utilities", "drainage", "infrastructure", "site work"],
  utilities: ["utility", "utilities", "drainage", "infrastructure", "site work"],
  commercial: ["commercial", "tenant", "industrial", "warehouse"],
  development: ["developer", "subdivision", "planning", "residential"],
  developments: ["developer", "subdivision", "planning", "residential"],
};

export function getAccessSearchResults(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const queryTerms = terms(trimmed);
  return accessOpportunities
    .map((opportunity) => ({ opportunity, score: scoreAccessOpportunity(opportunity, queryTerms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.opportunity.access_score - a.opportunity.access_score ||
      b.opportunity.qualification_score - a.opportunity.qualification_score
    )
    .slice(0, 30)
    .map((item) => item.opportunity);
}

export function getAccessOpportunityByProjectId(id: string) {
  return accessOpportunities.find((opportunity) => opportunity.id === id) ?? null;
}

function scoreAccessOpportunity(opportunity: AccessOpportunity, queryTerms: string[]) {
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
    opportunity.recommended_next_step,
    opportunity.opportunity_state,
    opportunity.evidence_quality,
    opportunity.fast_money_potential,
    ...opportunity.known_access_routes,
  ].join(" ").toLowerCase();

  let score = queryTerms.reduce((sum, term) => sum + (text.includes(term) ? 6 : 0), 0);
  if (queryTerms.some((term) => /fenc|gate|chain link|perimeter|security/.test(term)) && opportunity.fence_probability >= 50) score += 30;
  if (queryTerms.includes("sacramento") && /sacramento/i.test(`${opportunity.project_location} ${opportunity.county}`)) score += 20;
  if (opportunity.opportunity_state === "Actionable Opportunity") score += 18;
  if (opportunity.opportunity_state === "Research Required") score += 10;
  score += Math.round(opportunity.access_score * 0.2);
  score += Math.round(opportunity.qualification_score * 0.12);
  return score;
}

function terms(query: string) {
  const base = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1);
  return [...new Set(base.flatMap((term) => [term, ...(aliases[term] ?? [])]))];
}
