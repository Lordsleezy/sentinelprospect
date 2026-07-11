import { clusterAtomsByLinkage, extractResearchEntities } from "./entity-linker";
import type { OpportunityHypothesis, ResearchAtom, ResearchIntelligenceSnapshot } from "./types";
import { ConstructIQIndex, type IndexedDocument } from "./semantic-index";

type PlanningSignalLike = {
  id: string;
  title: string;
  summary?: string | null;
  raw_excerpt?: string | null;
  location_text?: string | null;
  city?: string | null;
  county?: string | null;
  stage?: string | null;
  developers?: string[] | null;
  trades_likely?: string[] | null;
  applicant?: string | null;
  parcel?: string | null;
  package_hint?: string | null;
  status?: string | null;
  captured_at?: string | null;
};

type OpportunityLike = {
  id: string;
  project_name: string;
  project_summary?: string | null;
  scope_summary?: string | null;
  primary_scope?: string | null;
  likely_scope?: string | null;
  city?: string | null;
  county?: string | null;
  developer?: string | null;
  general_contractor?: string | null;
  trade?: string | null;
  primary_contractor_trade?: string | null;
  project_stage?: string | null;
  opportunity_size?: string | null;
  decision_maker_phone?: string | null;
  best_contact?: { phone?: string | null } | null;
  search_facets?: {
    package_size?: string;
    contact_status?: string;
  } | null;
  document_intelligence?: {
    what_is_being_built?: string | null;
    scope_summary?: string | null;
    project_description?: string | null;
  } | null;
};

/**
 * Assemble sparse public-record breadcrumbs into opportunity hypotheses.
 * This is the “magic from nothing” layer: weak signals become pursuable packages
 * when developer / subdivision / place / trade crumbs reinforce each other.
 */
export function buildResearchAtoms(opportunities: OpportunityLike[]): ResearchAtom[] {
  const knownNames = opportunities
    .flatMap((row) => [row.developer, row.general_contractor])
    .filter(Boolean) as string[];

  return opportunities.map((opportunity) => {
    const text = [
      opportunity.project_name,
      opportunity.project_summary,
      opportunity.scope_summary,
      opportunity.primary_scope,
      opportunity.likely_scope,
      opportunity.document_intelligence?.project_description,
      opportunity.document_intelligence?.what_is_being_built,
      opportunity.document_intelligence?.scope_summary,
    ].filter(Boolean).join(" ");

    const entities = extractResearchEntities({
      title: opportunity.project_name,
      text,
      developer: opportunity.developer,
      general_contractor: opportunity.general_contractor,
      city: opportunity.city,
      county: opportunity.county,
      trade: opportunity.primary_contractor_trade || opportunity.trade,
      knownNames,
    });

    const tradeHints = [
      opportunity.primary_contractor_trade,
      ...(opportunity.trade ?? "").split(/[,/|]/).map((part) => part.trim()),
    ].filter(Boolean) as string[];

    return {
      id: `atom:${opportunity.id}`,
      kind: "opportunity" as const,
      source_id: opportunity.id,
      title: opportunity.project_name,
      text,
      city: opportunity.city,
      county: opportunity.county,
      stage: opportunity.project_stage,
      valuation: null,
      entities,
      trade_hints: [...new Set(tradeHints)],
      captured_at: new Date().toISOString(),
    };
  });
}

export function buildPlanningAtoms(signals: PlanningSignalLike[]): ResearchAtom[] {
  const knownNames = signals.flatMap((signal) => signal.developers ?? []).filter(Boolean);

  return signals.map((signal) => {
    const text = [
      signal.title,
      signal.summary,
      signal.raw_excerpt,
      signal.location_text,
      signal.applicant,
      signal.status,
      ...(signal.developers ?? []),
      ...(signal.trades_likely ?? []),
    ].filter(Boolean).join(" ");

    const entities = extractResearchEntities({
      title: signal.title,
      text,
      developer: signal.developers?.[0] ?? signal.applicant ?? null,
      general_contractor: null,
      city: signal.city,
      county: signal.county,
      trade: signal.trades_likely?.[0] ?? null,
      knownNames,
    });

    if (signal.parcel) {
      entities.push({
        type: "parcel",
        value: signal.parcel,
        canonical: signal.parcel.replace(/\s+/g, "").toUpperCase(),
        confidence: 0.9,
      });
    }

    return {
      id: `atom:planning:${signal.id}`,
      kind: "signal" as const,
      source_id: signal.id,
      title: signal.title,
      text,
      city: signal.city,
      county: signal.county,
      stage: signal.stage,
      valuation: null,
      entities,
      trade_hints: [...new Set(signal.trades_likely ?? [])],
      captured_at: signal.captured_at || new Date().toISOString(),
    };
  });
}

export function assembleOpportunityHypotheses(atoms: ResearchAtom[]): OpportunityHypothesis[] {
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const clusters = clusterAtomsByLinkage(atoms);
  const hypotheses: OpportunityHypothesis[] = [];

  for (const cluster of clusters) {
    const members = cluster.map((id) => byId.get(id)).filter(Boolean) as ResearchAtom[];
    if (!members.length) continue;

    const developers = unique(members.flatMap((atom) => valuesOf(atom, "developer")));
    const subdivisions = unique(members.flatMap((atom) => valuesOf(atom, "subdivision")));
    const cities = unique(members.map((atom) => atom.city).filter(Boolean) as string[]);
    const counties = unique(members.map((atom) => atom.county).filter(Boolean) as string[]);
    const contractors = unique(members.flatMap((atom) => valuesOf(atom, "gc")));
    const trades = unique(members.flatMap((atom) => atom.trade_hints));

    const packageSize = classifyPackageSize(members, subdivisions, developers);
    const confidence = scoreHypothesis(members, developers, subdivisions, trades);
    // Keep multi-crumb packages always; keep strong single crumbs for development/commercial.
    if (members.length === 1 && packageSize === "small") continue;
    if (members.length === 1 && confidence < 0.4) continue;

    const title = subdivisions[0]
      || developers[0]
      || members[0].title;
    const why = buildWhy(members, developers, subdivisions, trades, packageSize);

    hypotheses.push({
      id: `hyp:${hash(cluster.sort().join("|"))}`,
      title: packageSize === "development"
        ? `${title} — housing / development package`
        : title,
      confidence,
      package_size: packageSize,
      stage: members.find((atom) => atom.stage)?.stage || "Unknown",
      inferred_trades: trades.slice(0, 6),
      cities,
      counties,
      developers,
      contractors,
      breadcrumb_ids: cluster,
      why,
      linked_opportunity_ids: members.map((atom) => atom.source_id),
    });
  }

  return hypotheses.sort((a, b) => b.confidence - a.confidence || b.breadcrumb_ids.length - a.breadcrumb_ids.length);
}

export function buildSemanticDocuments(opportunities: OpportunityLike[]): IndexedDocument[] {
  return opportunities.map((opportunity) => ({
    id: opportunity.id,
    title: opportunity.project_name,
    text: [
      opportunity.project_summary,
      opportunity.scope_summary,
      opportunity.primary_scope,
      opportunity.likely_scope,
      opportunity.document_intelligence?.project_description,
      opportunity.document_intelligence?.what_is_being_built,
      opportunity.document_intelligence?.scope_summary,
      opportunity.developer,
      opportunity.general_contractor,
      opportunity.primary_contractor_trade,
      opportunity.trade,
      opportunity.city,
      opportunity.county,
    ].filter(Boolean).join(" "),
    metadata: {
      trade: opportunity.primary_contractor_trade || opportunity.trade || null,
      city: opportunity.city || null,
      county: opportunity.county || null,
      stage: opportunity.project_stage || null,
      package_size: opportunity.search_facets?.package_size || null,
      has_phone: Boolean(opportunity.decision_maker_phone || opportunity.best_contact?.phone),
      valuation: null,
    },
  }));
}

export function createOpportunitySearchIndex(opportunities: OpportunityLike[]) {
  return new ConstructIQIndex(buildSemanticDocuments(opportunities));
}

export function buildResearchIntelligenceSnapshot(
  opportunities: OpportunityLike[],
  planningSignals: PlanningSignalLike[] = [],
): ResearchIntelligenceSnapshot {
  const atoms = [
    ...buildResearchAtoms(opportunities),
    ...buildPlanningAtoms(planningSignals),
  ];
  const hypotheses = assembleOpportunityHypotheses(atoms);
  return {
    generated_at: new Date().toISOString(),
    atom_count: atoms.length,
    hypothesis_count: hypotheses.length,
    index_document_count: opportunities.length + planningSignals.length,
    atoms,
    hypotheses,
    open_source_patterns: [
      { name: "ConstructIQ", role: "Semantic permit search + metadata filters", url: "https://github.com/omni-front/ConstructIQ" },
      { name: "Splink", role: "Probabilistic entity resolution / record linkage", url: "https://github.com/moj-analytical-services/splink" },
      { name: "sift-kg", role: "Document → entity graph breadcrumb trails", url: "https://github.com/juanceresa/sift-kg" },
      { name: "LightRAG", role: "Graph + vector dual-level retrieval", url: "https://github.com/HKUDS/LightRAG" },
      { name: "ElecBidSpec AI", role: "Pre-RFP signal → pursuit stage model", url: "https://github.com/manynames3/elecbidspec-ai" },
      { name: "kipi", role: "Typed OSINT entity graph from sparse docs", url: "https://github.com/assafkip/kipi" },
    ],
  };
}

function valuesOf(atom: ResearchAtom, type: string) {
  return atom.entities.filter((entity) => entity.type === type).map((entity) => entity.canonical);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function classifyPackageSize(members: ResearchAtom[], subdivisions: string[], developers: string[]): OpportunityHypothesis["package_size"] {
  if (subdivisions.length || developers.some((name) => /lennar|kb home|pulte|horton|meritage|taylor morrison/i.test(name))) {
    return "development";
  }
  const blob = members.map((atom) => atom.text).join(" ").toLowerCase();
  if (/\b(commercial|industrial|warehouse|school|public works|tenant improvement)\b/.test(blob)) return "commercial";
  if (members.length >= 3) return "commercial";
  if (/\b(raise fence|side yard|patio|shed|repair)\b/.test(blob)) return "small";
  return members.length > 1 ? "commercial" : "unknown";
}

function scoreHypothesis(
  members: ResearchAtom[],
  developers: string[],
  subdivisions: string[],
  trades: string[],
) {
  let score = 0.28;
  score += Math.min(0.35, members.length * 0.08);
  if (developers.length) score += 0.18;
  if (subdivisions.length) score += 0.2;
  if (trades.length >= 2) score += 0.08;
  if (members.some((atom) => atom.entities.some((entity) => entity.type === "parcel"))) score += 0.1;
  return Math.min(0.97, Math.round(score * 100) / 100);
}

function buildWhy(
  members: ResearchAtom[],
  developers: string[],
  subdivisions: string[],
  trades: string[],
  packageSize: OpportunityHypothesis["package_size"],
) {
  const why: string[] = [];
  if (members.length > 1) why.push(`${members.length} linked public-record breadcrumbs reinforce the same package.`);
  if (developers.length) why.push(`Developer signal: ${developers.slice(0, 2).join(", ")}.`);
  if (subdivisions.length) why.push(`Subdivision / community cue: ${subdivisions.slice(0, 2).join(", ")}.`);
  if (trades.length) why.push(`Trade breadcrumbs: ${trades.slice(0, 4).join(", ")}.`);
  if (packageSize === "development") why.push("Looks like a housing / development package worth early pursuit.");
  if (!why.length) why.push("Single-source signal with extractable entities.");
  return why;
}

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
