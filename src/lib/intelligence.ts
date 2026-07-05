import type { CompanyRole, ProjectDetail } from "./types";

export type ProjectSizeClassification = "Small" | "Medium" | "Large" | "Mega Project";

export const statusStages = ["Planning", "Proposed", "Approved", "Permitted", "Under Construction", "Completed"] as const;

export function getProjectSize(project: Pick<ProjectDetail, "estimated_units" | "estimated_value">): ProjectSizeClassification {
  const units = project.estimated_units ?? 0;
  const value = project.estimated_value ?? 0;
  if (units >= 500 || value >= 150_000_000) return "Mega Project";
  if (units >= 100 || value >= 40_000_000) return "Large";
  if (units >= 25 || value >= 10_000_000) return "Medium";
  return "Small";
}

export function getPrimaryContact(project: Pick<ProjectDetail, "companies">) {
  return project.companies.find((company) => company.role === "developer")
    ?? project.companies.find((company) => company.role === "builder")
    ?? project.companies.find((company) => company.role === "contractor")
    ?? project.companies[0]
    ?? null;
}

export function getEstimatedTimeline(project: ProjectDetail) {
  if (project.status === "Planning" || project.status === "Proposed") return "6-18 months";
  if (project.status === "Approved") return "3-9 months";
  if (project.status === "Permitted") return "0-6 months";
  if (project.status === "Under Construction") return "Active now";
  return "Completed";
}

export function getTimingFit(project: ProjectDetail) {
  if (project.status === "Permitted") return "Likely 0-6 months";
  if (project.status === "Approved") return "Likely 3-9 months";
  if (project.status === "Under Construction") return "Active, verify open scopes";
  if (project.status === "Planning" || project.status === "Proposed") return "Early, monitor approvals";
  return "Low timing fit";
}

export function getContractorCategories(project: ProjectDetail) {
  const categories = new Set<string>();
  if (project.project_type === "Residential" || project.name.toLowerCase().includes("subdivision")) {
    categories.add("Fencing");
    categories.add("Concrete");
    categories.add("Landscaping");
    categories.add("Roofing");
  }
  if (project.project_type === "Commercial" || project.project_type === "Mixed Use") {
    categories.add("HVAC");
    categories.add("Roofing");
    categories.add("Concrete");
    categories.add("Fencing");
  }
  if (project.project_type === "Industrial" || project.project_type === "Infrastructure") {
    categories.add("Fencing");
    categories.add("Concrete");
    categories.add("Electrical");
    categories.add("Site work");
  }
  if (project.project_type === "Government") {
    categories.add("HVAC");
    categories.add("Roofing");
    categories.add("Concrete");
    categories.add("Security fencing");
  }
  return [...categories].slice(0, 5);
}

export function scoreOpportunity(project: ProjectDetail) {
  let score = 40;
  const reasons: string[] = [];
  const risks: string[] = [];
  const evidence: Array<{ label: string; href: string }> = [];
  const signalTypes = new Set(project.signals.map((signal) => signal.signal_type));
  const size = getProjectSize(project);

  if (["Planning", "Proposed", "Approved", "Permitted"].includes(project.status)) {
    score += 16;
    reasons.push(`Project is still in a reachable stage: ${project.status}.`);
  }
  if (project.status === "Under Construction") {
    score -= 12;
    risks.push("Construction is already underway, so some contracts may be awarded.");
  }
  if (project.status === "Completed") {
    score -= 30;
    risks.push("Project appears completed, reducing new-work opportunity.");
  }
  if (size === "Large" || size === "Mega Project") {
    score += size === "Mega Project" ? 14 : 10;
    reasons.push(`${size} scale suggests multiple trade opportunities.`);
  }
  if (project.project_type === "Residential" && (project.estimated_units ?? 0) >= 25) {
    score += 12;
    reasons.push(`${project.estimated_units} residential units may require fencing, concrete, roofing, landscaping, and related trades.`);
  }
  if (project.project_type === "Commercial" || project.project_type === "Mixed Use") {
    score += 8;
    reasons.push(`${project.project_type} work may create HVAC, roofing, concrete, and buildout opportunities.`);
  }
  if (project.project_type === "Infrastructure" || signalTypes.has("Utility Expansion") || signalTypes.has("Infrastructure Project")) {
    score += 8;
    reasons.push("Infrastructure or utility activity can create site work, fencing, concrete, and electrical demand.");
  }
  if (signalTypes.has("Rezoning") || signalTypes.has("Planning Application") || signalTypes.has("Subdivision Filing")) {
    score += 12;
    reasons.push("Early planning signals suggest contractor selection may still be open.");
  }
  if (signalTypes.has("Permit") || project.status === "Permitted") {
    score += 7;
    reasons.push("Permit activity suggests work may be approaching start.");
  }
  const knownContractors = project.companies.filter((company) => company.role === "contractor").length;
  if (knownContractors === 0) {
    score += 10;
    reasons.push("No known general contractor is attached in public records.");
  } else {
    score -= 8;
    risks.push("A contractor is already identified in public records.");
  }
  if (project.signals.length) {
    evidence.push(...project.signals.slice(0, 3).map((signal) => ({
      label: `${signal.signal_type} signal`,
      href: `/projects/${project.id}#signals`,
    })));
  }
  evidence.push({ label: "Project source record", href: project.source_url });

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons: reasons.slice(0, 5),
    risks: risks.slice(0, 3),
    evidence,
    timeline: getEstimatedTimeline(project),
    timingFit: getTimingFit(project),
    contractorCategories: getContractorCategories(project),
  };
}

export function getOpportunityFitLabel(score: number) {
  if (score >= 82) return "Strong match";
  if (score >= 68) return "Worth pursuing";
  if (score >= 52) return "Monitor";
  return "Weak fit";
}

export function getNextAction(project: ProjectDetail) {
  const primary = getPrimaryContact(project);
  if (project.status === "Permitted") {
    return primary ? `Call ${primary.name} and ask who is bidding trade packages.` : "Pull the permit packet and identify the owner or applicant.";
  }
  if (project.status === "Approved") return "Check conditions of approval, improvement plans, and bid timing.";
  if (project.status === "Under Construction") return "Verify whether specialty scopes are still open before spending sales time.";
  if (project.status === "Planning" || project.status === "Proposed") return "Save this opportunity and watch for hearings, approvals, and permit filings.";
  return "Archive unless new source activity appears.";
}

export function getSourceCoverage(project: ProjectDetail) {
  const coverage = new Set<string>();
  if (project.permits.length) coverage.add("Permits");
  if (project.signals.some((signal) => ["Planning Application", "Subdivision Filing", "Rezoning"].includes(signal.signal_type))) coverage.add("Planning records");
  if (project.signals.some((signal) => ["Infrastructure Project", "Utility Expansion"].includes(signal.signal_type))) coverage.add("Public works");
  if (project.documents.length) coverage.add("Documents");
  if (project.companies.length) coverage.add("Companies");
  coverage.add(project.source_name);
  return [...coverage].slice(0, 5);
}

export const contactRoleLabels: Array<{ role: CompanyRole; label: string }> = [
  { role: "developer", label: "Developer" },
  { role: "builder", label: "Builder" },
  { role: "contractor", label: "General Contractor" },
  { role: "architect", label: "Architect" },
  { role: "engineer", label: "Engineer" },
];
