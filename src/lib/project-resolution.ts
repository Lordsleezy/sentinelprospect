import { generateOpportunities } from "./opportunities";
import { isPlaceholderContact } from "./contact-quality";
import type { CanonicalProjectOpportunity, ContactIntelligence, EvidenceRecord, Opportunity, ProjectDetail } from "./types";

export const CONTACT_CONFIDENCE_THRESHOLD = 0.65;

export function resolveCanonicalProject(project: ProjectDetail): CanonicalProjectOpportunity {
  const opportunities = dedupeOpportunities(generateOpportunities(project));
  const evidence = dedupeEvidence(opportunities.flatMap((opportunity) => opportunity.evidence));
  const contacts = dedupeContacts(opportunities.flatMap((opportunity) => opportunity.contacts ?? []))
    .filter(isActionableContact)
    .sort((a, b) => b.confidence - a.confidence);
  const contactConfidence = contacts[0]?.confidence ?? 0;
  const resolutionConfidence = Math.max(...opportunities.map((opportunity) => opportunity.resolutionConfidence ?? 0), 0);
  const score = Math.max(...opportunities.map((opportunity) => opportunity.score), 0);
  const fastMoneyScore = getFastMoneyScore(opportunities);
  const eligibility = getEligibility(project, evidence, contacts, contactConfidence);

  return {
    project,
    canonical_key: canonicalProjectKey(project),
    trades: [...new Set(opportunities.map((opportunity) => opportunity.trade))],
    opportunities,
    evidence,
    contacts,
    score,
    fast_money_score: fastMoneyScore,
    contact_confidence: contactConfidence,
    resolution_confidence: resolutionConfidence,
    eligibility,
  };
}

export function resolveCanonicalProjects(projects: ProjectDetail[]) {
  const groups = new Map<string, CanonicalProjectOpportunity>();
  for (const project of projects) {
    const resolved = resolveCanonicalProject(project);
    const existing = groups.get(resolved.canonical_key);
    if (!existing) {
      groups.set(resolved.canonical_key, resolved);
      continue;
    }
    groups.set(resolved.canonical_key, mergeResolved(existing, resolved));
  }
  return [...groups.values()].sort((a, b) => b.score - a.score || b.fast_money_score - a.fast_money_score);
}

export function getContractorVisibleProjects(projects: ProjectDetail[]) {
  return resolveCanonicalProjects(projects).filter((item) => item.eligibility.contractor_visible);
}

export function canonicalProjectKey(project: ProjectDetail) {
  const permit = project.permits[0]?.permit_number ?? "";
  const applicant = project.companies.find((company) => ["developer", "builder", "contractor"].includes(company.role))?.name ?? "";
  return normalizeKey([project.name, project.address, permit, applicant].filter(Boolean).join("|"));
}

export function isActionableContact(contact: ContactIntelligence) {
  if (!contact.company || contact.confidence < CONTACT_CONFIDENCE_THRESHOLD) return false;
  if (isPlaceholderContact(contact)) return false;
  return Boolean(contact.phone || contact.email || contact.website);
}

function getEligibility(project: ProjectDetail, evidence: EvidenceRecord[], contacts: ContactIntelligence[], contactConfidence: number) {
  const missing: string[] = [];
  const reasons: string[] = [];
  if (!contacts.length) missing.push("No actionable contact above confidence threshold");
  else reasons.push(`Actionable contact found: ${contacts[0].company} (${Math.round(contactConfidence * 100)}% confidence)`);
  if (!evidence.length) missing.push("No supporting evidence");
  else reasons.push(`${evidence.length} evidence record(s) attached`);
  if (!project.latitude || !project.longitude || !project.address) missing.push("Missing location");
  else reasons.push("Location is present");
  if (!project.name || !project.id) missing.push("Missing project identity");
  else reasons.push("Project identity is present");
  return {
    contractor_visible: missing.length === 0,
    reasons,
    missing,
  };
}

function mergeResolved(a: CanonicalProjectOpportunity, b: CanonicalProjectOpportunity): CanonicalProjectOpportunity {
  const opportunities = dedupeOpportunities([...a.opportunities, ...b.opportunities]);
  const evidence = dedupeEvidence([...a.evidence, ...b.evidence]);
  const contacts = dedupeContacts([...a.contacts, ...b.contacts]).sort((x, y) => y.confidence - x.confidence);
  const project = a.project.updated_at > b.project.updated_at ? a.project : b.project;
  const contactConfidence = contacts[0]?.confidence ?? 0;
  return {
    project,
    canonical_key: a.canonical_key,
    trades: [...new Set([...a.trades, ...b.trades])],
    opportunities,
    evidence,
    contacts,
    score: Math.max(a.score, b.score),
    fast_money_score: Math.max(a.fast_money_score, b.fast_money_score),
    contact_confidence: contactConfidence,
    resolution_confidence: Math.max(a.resolution_confidence, b.resolution_confidence),
    eligibility: getEligibility(project, evidence, contacts, contactConfidence),
  };
}

function getFastMoneyScore(opportunities: Opportunity[]) {
  return Math.max(...opportunities.map((opportunity) => {
    let score = opportunity.horizon === "Fast Money" ? 70 : opportunity.horizon === "Pipeline" ? 45 : 25;
    if ((opportunity.estimated_start_months ?? 99) <= 3) score += 12;
    if ((opportunity.estimated_completion_months ?? 99) <= 6) score += 12;
    if ((opportunity.contacts?.some(isActionableContact)) ?? false) score += 6;
    return Math.min(100, score);
  }), 0);
}

function dedupeOpportunities(opportunities: Opportunity[]) {
  const seen = new Set<string>();
  return opportunities.filter((opportunity) => {
    const key = `${opportunity.project_id}-${opportunity.trade}-${opportunity.horizon}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeEvidence(evidence: EvidenceRecord[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.record_type}-${item.record_id}-${item.source_url ?? item.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeContacts(contacts: ContactIntelligence[]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const key = normalizeKey(`${contact.company}|${contact.role}|${contact.phone ?? ""}|${contact.email ?? ""}|${contact.website ?? ""}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|company|co|limited|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
