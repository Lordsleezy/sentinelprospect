/**
 * Planning-stage signal taxonomy for early housing / commercial discovery.
 * Feeds the breadcrumb research engine before permits exist.
 */

export type PlanningStage =
  | "entitlement"
  | "ceqa"
  | "tentative_map"
  | "plan_check"
  | "design_review"
  | "board_agenda"
  | "pre_application"
  | "unknown";

export type PlanningSignal = {
  id: string;
  title: string;
  jurisdiction: string;
  source_name: string;
  source_url: string;
  stage: PlanningStage;
  project_type: "residential" | "commercial" | "industrial" | "mixed" | "infrastructure" | "unknown";
  developers: string[];
  location_text?: string | null;
  city?: string | null;
  county?: string | null;
  summary: string;
  trades_likely: string[];
  package_hint: "development" | "commercial" | "small" | "unknown";
  captured_at: string;
  raw_excerpt?: string | null;
};

export const PLANNING_STAGE_LABELS: Record<PlanningStage, string> = {
  entitlement: "Entitlement",
  ceqa: "CEQA / environmental",
  tentative_map: "Tentative map / subdivision",
  plan_check: "Plan check",
  design_review: "Design review",
  board_agenda: "Board / commission agenda",
  pre_application: "Pre-application",
  unknown: "Planning signal",
};

export function classifyPlanningStage(text: string): PlanningStage {
  const blob = text.toLowerCase();
  if (/\bceqa|eir\b|negative declaration|mitigated negative\b/.test(blob)) return "ceqa";
  if (/\btentative (?:subdivision )?map|final map|parcel map\b/.test(blob)) return "tentative_map";
  if (/\bdesign review|architectural review\b/.test(blob)) return "design_review";
  if (/\bplan check|building plan review\b/.test(blob)) return "plan_check";
  if (/\bplanning commission|board of supervisors|city council|agenda\b/.test(blob)) return "board_agenda";
  if (/\bpre-?application|preapplication\b/.test(blob)) return "pre_application";
  if (/\bentitlement|rezoning|general plan|specific plan|planned development\b/.test(blob)) return "entitlement";
  return "unknown";
}

export function inferLikelyTradesFromPlanningText(text: string): string[] {
  const blob = text.toLowerCase();
  const trades = new Set<string>();
  if (/\bfence|fencing|gate|perimeter\b/.test(blob)) trades.add("Fencing");
  if (/\bconcrete|foundation|flatwork|sidewalk\b/.test(blob)) trades.add("Concrete");
  if (/\bhvac|mechanical\b/.test(blob)) trades.add("HVAC");
  if (/\belectrical|solar|lighting\b/.test(blob)) trades.add("Electrical");
  if (/\blandscape|irrigation\b/.test(blob)) trades.add("Landscaping");
  if (/\bpaint|painting\b/.test(blob)) trades.add("Painting");
  if (/\bframing|carpenter|carpentry\b/.test(blob)) trades.add("Carpentry");
  if (/\bsite work|grading|earthwork|utility|utilities|drainage\b/.test(blob)) trades.add("Site work");
  if (/\broof|roofing\b/.test(blob)) trades.add("Roofing");
  // Housing developments usually need the full exterior/site stack even without explicit trade words.
  if (/\bsubdivision|master plan|villages?\s+at|production home|single[-\s]?family|multifamily|apartment\b/.test(blob)) {
    trades.add("Fencing");
    trades.add("Concrete");
    trades.add("Site work");
    trades.add("Landscaping");
  }
  return [...trades];
}
