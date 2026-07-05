export const PROJECT_TYPES = [
  "Residential",
  "Commercial",
  "Industrial",
  "Government",
  "Mixed Use",
  "Infrastructure",
] as const;

export const STATUS_TYPES = [
  "Planning",
  "Proposed",
  "Approved",
  "Permitted",
  "Under Construction",
  "Completed",
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];
export type ProjectStatus = (typeof STATUS_TYPES)[number];
export type CompanyRole = "developer" | "builder" | "contractor" | "architect" | "engineer";
export const OPPORTUNITY_HORIZONS = ["Fast Money", "Pipeline", "Early Signals"] as const;
export type OpportunityHorizon = (typeof OPPORTUNITY_HORIZONS)[number];
export type EvidenceRecordType = "project" | "permit" | "signal" | "document" | "company" | "source_record";
export type OpportunityTrade = "Fencing" | "Concrete" | "HVAC" | "Roofing" | "Electrical" | "Landscaping" | "Site work" | "Security fencing" | "General";
export type ContactIntelligenceRole = "Developer" | "General Contractor" | "Applicant" | "Builder" | "Property Owner" | "Engineer" | "Architect" | "Government Contact";
export type ContactIntelligence = {
  name: string | null;
  company: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  role: ContactIntelligenceRole;
  confidence: number;
  source: string;
};
export type TradeEvidence = {
  trade: OpportunityTrade;
  reason: string;
  evidence_id: string;
  confidence: number;
};
export type RevenueEstimate = {
  label: "$25k-$75k" | "$75k-$250k" | "$250k-$1M" | "$1M+" | "Under $25k" | "Not estimated";
  low: number | null;
  high: number | null;
  confidence: number;
  reasoning: string[];
};
export type SignalType =
  | "Land Purchase"
  | "Parcel Split"
  | "Rezoning"
  | "Planning Application"
  | "CEQA"
  | "Subdivision Filing"
  | "Environmental Review"
  | "Permit"
  | "Groundbreaking"
  | "Construction Start"
  | "Utility Expansion"
  | "Infrastructure Project";

export type Project = {
  id: string;
  name: string;
  description: string;
  project_type: ProjectType;
  status: ProjectStatus;
  city: string;
  county: string;
  state: string;
  address: string;
  latitude: number;
  longitude: number;
  estimated_units: number | null;
  estimated_value: number | null;
  source_url: string;
  source_name: string;
  created_at: string;
  updated_at: string;
};

export type Permit = {
  id: string;
  project_id: string;
  permit_number: string;
  permit_type: string;
  permit_status: string;
  permit_date: string;
  permit_value: number | null;
  source_url: string;
  created_at: string;
};

export type Company = {
  id: string;
  name: string;
  company_type: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  city: string;
  state: string;
  notes: string | null;
};

export type ProjectCompany = {
  project_id: string;
  company_id: string;
  role: CompanyRole;
};

export type Document = {
  id: string;
  project_id: string;
  title: string;
  document_type: string;
  source_url: string;
  summary: string | null;
  created_at: string;
};

export type Source = {
  id: string;
  name: string;
  source_type: string;
  base_url: string;
  active: boolean;
  last_sync: string | null;
  records_collected: number;
};

export type Signal = {
  id: string;
  project_id: string | null;
  signal_type: SignalType;
  signal_date: string;
  description: string;
  source: string;
  source_url?: string | null;
  external_id?: string | null;
  parcel_number?: string | null;
  jurisdiction?: string | null;
  importance_score: number;
};

export type EvidenceRecord = {
  id: string;
  record_type: EvidenceRecordType;
  record_id: string;
  source_name: string;
  source_url: string | null;
  title: string;
  summary: string;
  captured_at: string;
  confidence: number;
  metadata?: Record<string, unknown>;
};

export type OpportunityScoreExplanation = {
  factor: string;
  points: number;
  reason: string;
  evidence_ids: string[];
};

export type Opportunity = {
  id: string;
  title: string;
  trade: OpportunityTrade;
  horizon: OpportunityHorizon;
  project_id: string | null;
  city: string;
  county: string;
  state: string;
  score: number;
  score_explanations: OpportunityScoreExplanation[];
  evidence: EvidenceRecord[];
  recommended_action: string;
  nextAction?: string;
  recommendation_explanations?: string[];
  confidenceBreakdown?: Array<{ factor: string; confidence: number; explanation: string }>;
  resolutionConfidence?: number;
  estimated_start_months: number | null;
  estimated_completion_months: number | null;
  estimated_value: number | null;
  estimated_revenue_low?: number | null;
  estimated_revenue_high?: number | null;
  estimated_value_label?: string;
  revenue_estimate?: RevenueEstimate;
  contact_intelligence?: string[];
  contacts?: ContactIntelligence[];
  trade_evidence?: TradeEvidence[];
  created_at: string;
  updated_at: string;
};

export type ProjectDetail = Project & {
  permits: Permit[];
  documents: Document[];
  companies: Array<Company & { role: CompanyRole }>;
  signals: Signal[];
  evidence_records?: EvidenceRecord[];
};
