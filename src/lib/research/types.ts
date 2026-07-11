/**
 * Research Intelligence types.
 *
 * Inspired by ConstructIQ (semantic permit search + metadata filters),
 * Splink (probabilistic entity linkage), and sift-kg / LightRAG (breadcrumb → graph).
 */

export type ResearchEntityType =
  | "developer"
  | "gc"
  | "company"
  | "subdivision"
  | "address"
  | "city"
  | "county"
  | "parcel"
  | "trade"
  | "contact"
  | "agency"
  | "phrase";

export type ResearchEntity = {
  type: ResearchEntityType;
  value: string;
  canonical: string;
  confidence: number;
};

export type ResearchAtomKind =
  | "permit"
  | "opportunity"
  | "agenda"
  | "document"
  | "contact"
  | "company"
  | "signal";

/** A single sparse public-record crumb. */
export type ResearchAtom = {
  id: string;
  kind: ResearchAtomKind;
  source_id: string;
  title: string;
  text: string;
  city?: string | null;
  county?: string | null;
  stage?: string | null;
  valuation?: number | null;
  entities: ResearchEntity[];
  trade_hints: string[];
  captured_at: string;
};

export type OpportunityHypothesis = {
  id: string;
  title: string;
  confidence: number;
  package_size: "development" | "commercial" | "small" | "unknown";
  stage: string;
  inferred_trades: string[];
  cities: string[];
  counties: string[];
  developers: string[];
  contractors: string[];
  breadcrumb_ids: string[];
  why: string[];
  linked_opportunity_ids: string[];
};

export type SemanticSearchFilters = {
  trade?: string;
  city?: string;
  county?: string;
  stage?: string;
  package_size?: string;
  min_valuation?: number;
  has_phone?: boolean;
};

export type SemanticSearchHit = {
  id: string;
  score: number;
  lexical_score: number;
  metadata_score: number;
  title: string;
  snippet: string;
  trade?: string | null;
  city?: string | null;
  county?: string | null;
  stage?: string | null;
  package_size?: string | null;
  metadata: Record<string, string | number | boolean | null>;
};

export type ResearchIntelligenceSnapshot = {
  generated_at: string;
  atom_count: number;
  hypothesis_count: number;
  index_document_count: number;
  atoms: ResearchAtom[];
  hypotheses: OpportunityHypothesis[];
  open_source_patterns: Array<{ name: string; role: string; url: string }>;
};
