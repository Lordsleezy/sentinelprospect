import { getContractorCategories, getPrimaryContact, getProjectSize } from "./intelligence";
import { isPlaceholderContact, isSourceBackedCompanyName } from "./contact-quality";
import type {
  Document,
  ContactIntelligence,
  EvidenceRecord,
  Opportunity,
  OpportunityHorizon,
  OpportunityScoreExplanation,
  OpportunityTrade,
  Permit,
  ProjectDetail,
  RevenueEstimate,
  Signal,
  TradeEvidence,
} from "./types";

const pipelineStatuses = new Set(["Approved", "Planning", "Proposed"]);
const earlySignalTypes = new Set(["Land Purchase", "Parcel Split", "Rezoning", "CEQA"]);
const pipelineSignalTypes = new Set(["Planning Application", "Subdivision Filing", "Environmental Review", "Utility Expansion"]);
const directTrades = new Set<OpportunityTrade>(["Fencing", "Concrete", "HVAC", "Roofing", "Electrical", "Landscaping"]);

export function classifyOpportunityHorizon(project: ProjectDetail): {
  horizon: OpportunityHorizon;
  estimatedStartMonths: number | null;
  estimatedCompletionMonths: number | null;
  reason: string;
} {
  const signalTypes = new Set(project.signals.map((signal) => signal.signal_type));

  if (project.status === "Permitted" || signalTypes.has("Permit")) {
    return {
      horizon: "Fast Money",
      estimatedStartMonths: 0,
      estimatedCompletionMonths: 6,
      reason: "Permit activity suggests near-term work that may start, finish, and invoice inside six months.",
    };
  }

  if (project.status === "Under Construction" || signalTypes.has("Construction Start") || signalTypes.has("Groundbreaking")) {
    return {
      horizon: "Fast Money",
      estimatedStartMonths: 0,
      estimatedCompletionMonths: 6,
      reason: "Construction activity is active now; only open or late specialty scopes should be pursued.",
    };
  }

  if (project.status === "Approved" || [...signalTypes].some((type) => pipelineSignalTypes.has(type))) {
    return {
      horizon: "Pipeline",
      estimatedStartMonths: 6,
      estimatedCompletionMonths: 18,
      reason: "Planning or approval evidence indicates a real project, but timing likely requires follow-up.",
    };
  }

  if ([...signalTypes].some((type) => earlySignalTypes.has(type))) {
    return {
      horizon: "Early Signals",
      estimatedStartMonths: 18,
      estimatedCompletionMonths: null,
      reason: "Land, parcel, rezoning, or CEQA evidence indicates upstream activity before bid timing is clear.",
    };
  }

  if (pipelineStatuses.has(project.status)) {
    return {
      horizon: "Pipeline",
      estimatedStartMonths: 6,
      estimatedCompletionMonths: 18,
      reason: `${project.status} status implies a medium-term opportunity watch.`,
    };
  }

  return {
    horizon: "Early Signals",
    estimatedStartMonths: 18,
    estimatedCompletionMonths: null,
    reason: "Insufficient near-term evidence; keep only as an early watch item.",
  };
}

export function buildEvidencePanel(project: ProjectDetail): EvidenceRecord[] {
  const capturedAt = new Date().toISOString();
  const projectEvidence: EvidenceRecord = {
    id: `ev-project-${project.id}`,
    record_type: "project",
    record_id: project.id,
    source_name: project.source_name,
    source_url: project.source_url,
    title: project.name,
    summary: project.description,
    captured_at: project.updated_at || capturedAt,
    confidence: 0.72,
    metadata: {
      status: project.status,
      project_type: project.project_type,
      estimated_units: project.estimated_units,
      estimated_value: project.estimated_value,
    },
  };

  return [
    projectEvidence,
    ...(project.evidence_records ?? []),
    ...project.permits.map((permit) => permitEvidence(permit, capturedAt)),
    ...project.signals.map((signal) => signalEvidence(signal, capturedAt)),
    ...project.documents.map((document) => documentEvidence(document, capturedAt)),
  ];
}

export function generateOpportunities(project: ProjectDetail): Opportunity[] {
  const categories = getContractorCategories(project);
  const evidenceTrades = getEvidenceTrades(project.evidence_records ?? []);
  const trades = evidenceTrades.length ? normalizeTrades(evidenceTrades) : normalizeTrades(categories);
  return trades.map((trade) => generateOpportunity(project, trade));
}

export function generateOpportunity(project: ProjectDetail, trade: OpportunityTrade): Opportunity {
  const evidence = buildEvidencePanel(project);
  const horizon = classifyOpportunityHorizon(project);
  const scoreResult = scoreOpportunityEvidence(project, evidence, trade, horizon.horizon);
  const revenue = getRevenueEstimate(project, evidence, trade);
  const contactIntelligence = getContactIntelligence(project);
  const contacts = getStructuredContacts(project);
  const tradeEvidence = getTradeEvidence(project, evidence, trade);
  const action = getOpportunityAction(project, horizon.horizon);
  const now = new Date().toISOString();

  return {
    id: `opp-${project.id}-${trade.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title: `${trade} opportunity: ${project.name}`,
    trade,
    horizon: horizon.horizon,
    project_id: project.id,
    city: project.city,
    county: project.county,
    state: project.state,
    score: scoreResult.score,
    score_explanations: scoreResult.explanations,
    evidence,
    recommended_action: action,
    nextAction: action,
    recommendation_explanations: getRecommendationExplanations(project, horizon.horizon, evidence),
    confidenceBreakdown: getConfidenceBreakdown(project, evidence),
    resolutionConfidence: getResolutionConfidence(project, evidence),
    estimated_start_months: horizon.estimatedStartMonths,
    estimated_completion_months: horizon.estimatedCompletionMonths,
    estimated_value: project.estimated_value,
    estimated_revenue_low: revenue.low,
    estimated_revenue_high: revenue.high,
    estimated_value_label: revenue.label,
    revenue_estimate: revenue,
    contact_intelligence: contactIntelligence,
    contacts,
    trade_evidence: tradeEvidence,
    created_at: now,
    updated_at: now,
  };
}

function getRecommendationExplanations(project: ProjectDetail, horizon: OpportunityHorizon, evidence: EvidenceRecord[]) {
  const explanations = [`${horizon} horizon was selected from project stage ${project.status} and ${evidence.length} supporting evidence records.`];
  if (project.permits.length) explanations.push("Permit evidence exists, so contractor follow-up can be tied to a concrete public record.");
  if (project.companies.length) explanations.push("At least one source-supported contact is available.");
  if (!project.companies.length) explanations.push("No source-supported contact is available; next step is source-record review rather than invented outreach.");
  return explanations;
}

function getConfidenceBreakdown(project: ProjectDetail, evidence: EvidenceRecord[]) {
  const sourceNames = new Set(evidence.map((item) => item.source_name));
  return [
    {
      factor: "Permit Evidence",
      confidence: project.permits.length ? 0.86 : 0,
      explanation: project.permits.length ? `${project.permits.length} permit record(s) support the opportunity.` : "No permit evidence attached.",
    },
    {
      factor: "Planning Evidence",
      confidence: project.signals.some((signal) => ["Planning Application", "Subdivision Filing", "Rezoning", "CEQA"].includes(signal.signal_type)) ? 0.76 : 0,
      explanation: "Planning confidence is based on planning, subdivision, rezoning, or CEQA signals.",
    },
    {
      factor: "Bid Evidence",
      confidence: sourceNames.has("SAM.gov Contract Opportunities") ? 0.88 : 0,
      explanation: sourceNames.has("SAM.gov Contract Opportunities") ? "SAM.gov notice indicates an active bid-style opportunity." : "No SAM.gov bid evidence attached.",
    },
    {
      factor: "Source Agreement",
      confidence: Math.min(0.95, sourceNames.size * 0.25),
      explanation: `${sourceNames.size} independent source family/families attached. Confidence increases when multiple sources agree.`,
    },
  ];
}

function getResolutionConfidence(project: ProjectDetail, evidence: EvidenceRecord[]) {
  let confidence = 0.45;
  const parcels = new Set(evidence.map((item) => item.metadata?.parcel_number).filter(Boolean));
  const applications = new Set(evidence.map((item) => item.metadata?.application ?? item.metadata?.notice_id).filter(Boolean));
  if (project.address) confidence += 0.15;
  if (parcels.size === 1) confidence += 0.2;
  if (applications.size === 1) confidence += 0.15;
  if (evidence.length > 1) confidence += 0.05;
  return Math.min(0.95, confidence);
}

export function scoreOpportunityEvidence(
  project: ProjectDetail,
  evidence: EvidenceRecord[],
  trade: OpportunityTrade,
  horizon: OpportunityHorizon,
): { score: number; explanations: OpportunityScoreExplanation[] } {
  const explanations: OpportunityScoreExplanation[] = [];
  const signalTypes = new Set(project.signals.map((signal) => signal.signal_type));
  const permitEvidenceIds = evidence.filter((item) => item.record_type === "permit").map((item) => item.id);
  const signalEvidenceIds = evidence.filter((item) => item.record_type === "signal").map((item) => item.id);
  const projectEvidenceIds = evidence.filter((item) => item.record_type === "project").map((item) => item.id);
  const sourceEvidenceIds = evidence.filter((item) => item.record_type === "source_record").map((item) => item.id);

  add(explanations, "Base opportunity", 30, "A normalized public project record exists.", [...projectEvidenceIds, ...sourceEvidenceIds]);

  if (horizon === "Fast Money") {
    add(explanations, "Near-term horizon", 20, "Timing evidence places this in the 0-6 month Fast Money window.", [...permitEvidenceIds, ...signalEvidenceIds]);
  } else if (horizon === "Pipeline") {
    add(explanations, "Pipeline horizon", 12, "Planning or approval evidence places this in the 6-18 month pipeline.", signalEvidenceIds);
  } else {
    add(explanations, "Early signal", 5, "Evidence is upstream and useful for monitoring, but bid timing is not yet mature.", signalEvidenceIds);
  }

  if (project.permits.length > 0 || signalTypes.has("Permit")) {
    add(explanations, "Permit evidence", 15, "Permit records increase confidence that work is moving toward execution.", permitEvidenceIds);
  }

  if (sourceEvidenceIds.length > 0) {
    add(explanations, "Real source record", 10, "This recommendation is backed by a collected public source record, not only synthetic project data.", sourceEvidenceIds);
  }

  if ([...signalTypes].some((type) => pipelineSignalTypes.has(type) || earlySignalTypes.has(type))) {
    add(explanations, "Planning evidence", 12, "Planning, land, parcel, CEQA, or utility records support the recommendation.", signalEvidenceIds);
  }

  const size = getProjectSize(project);
  if (size === "Large" || size === "Mega Project") {
    add(explanations, "Project scale", size === "Mega Project" ? 12 : 9, `${size} scale suggests multiple trade packages.`, projectEvidenceIds);
  }

  const tradeEvidence = getTradeEvidence(project, evidence, trade);
  if (tradeEvidence.length > 0 && trade !== "General") {
    add(explanations, "Trade fit", tradeEvidence.length > 1 ? 12 : 8, `${trade} is supported by ${tradeEvidence.length} source-backed trade signal(s).`, tradeEvidence.map((item) => item.evidence_id));
  } else if (trade !== "General") {
    add(explanations, "Trade fit", 3, `${trade} appears relevant, but supporting trade evidence is limited.`, [...projectEvidenceIds, ...sourceEvidenceIds]);
  } else {
    add(explanations, "Weak trade specificity", -10, "The source record did not support a specific trade match.", [...projectEvidenceIds, ...sourceEvidenceIds]);
  }

  const knownContractors = project.companies.filter((company) => company.role === "contractor").length;
  if (knownContractors === 0) {
    add(explanations, "Open contractor slot", 10, "No general contractor is attached in the available public evidence.", projectEvidenceIds);
  } else {
    add(explanations, "Known contractor", -8, "A contractor is already named, so outreach should verify whether this scope remains open.", projectEvidenceIds);
  }

  if (project.status === "Completed") {
    add(explanations, "Completed project", -35, "Completed status substantially reduces new-work potential.", projectEvidenceIds);
  }

  if (project.status === "Completed" && sourceEvidenceIds.length > 0) {
    add(explanations, "False-positive control", -20, "Collected source indicates completed work; only pursue if a related follow-on scope exists.", sourceEvidenceIds);
  }

  const score = explanations.reduce((total, item) => total + item.points, 0);
  return { score: Math.max(0, Math.min(100, score)), explanations };
}

function getEvidenceTrades(evidence: EvidenceRecord[]): string[] {
  return evidence.flatMap((item) => {
    const trades = item.metadata?.inferred_trades;
    return Array.isArray(trades) ? trades.filter((trade): trade is string => typeof trade === "string") : [];
  });
}

function getEstimatedRevenueWindow(evidence: EvidenceRecord[], trade: OpportunityTrade) {
  for (const item of evidence) {
    const windows = item.metadata?.revenue_windows;
    if (windows && typeof windows === "object" && trade in windows) {
      const window = (windows as Record<string, unknown>)[trade];
      if (window && typeof window === "object") {
        const low = (window as Record<string, unknown>).low;
        const high = (window as Record<string, unknown>).high;
        return {
          low: typeof low === "number" ? low : null,
          high: typeof high === "number" ? high : null,
        };
      }
    }
  }
  return { low: null, high: null };
}

function getRevenueEstimate(project: ProjectDetail, evidence: EvidenceRecord[], trade: OpportunityTrade): RevenueEstimate {
  const explicit = getEstimatedRevenueWindow(evidence, trade);
  if (explicit.low || explicit.high) {
    return {
      label: valueLabel(explicit.low, explicit.high),
      low: explicit.low,
      high: explicit.high,
      confidence: 0.78,
      reasoning: [
        "Based on permit valuation from source record.",
        `${trade} matched source text or project characteristics.`,
        `${project.project_type} project type affects expected trade share.`,
      ],
    };
  }

  const base = project.estimated_value;
  if (!base || base <= 0) {
    return {
      label: "Not estimated",
      low: null,
      high: null,
      confidence: 0.2,
      reasoning: ["No permit valuation or project value was available in the supporting evidence."],
    };
  }

  const [lowPct, highPct] = tradeRevenuePercent(trade, project.project_type);
  const low = Math.round(base * lowPct);
  const high = Math.round(base * highPct);
  return {
    label: valueLabel(low, high),
    low,
    high,
    confidence: 0.55,
    reasoning: [
      `Based on ${project.project_type.toLowerCase()} project type.`,
      `Project value is ${formatMoney(base)}.`,
      `${trade} trade share estimated from project type and stage.`,
      `Current stage is ${project.status}.`,
    ],
  };
}

function tradeRevenuePercent(trade: OpportunityTrade, projectType: string): [number, number] {
  if (trade === "Fencing" && ["Industrial", "Infrastructure", "Government"].includes(projectType)) return [0.02, 0.06];
  if (trade === "Fencing") return [0.015, 0.045];
  if (trade === "Concrete") return [0.04, 0.12];
  if (trade === "Electrical") return [0.05, 0.16];
  if (trade === "Roofing") return [0.1, 0.24];
  if (trade === "HVAC") return [0.08, 0.18];
  if (trade === "Landscaping") return [0.02, 0.08];
  if (trade === "Site work") return [0.05, 0.15];
  return [0.01, 0.04];
}

function valueLabel(low: number | null, high: number | null): RevenueEstimate["label"] {
  const value = high ?? low ?? 0;
  if (!value) return "Not estimated";
  if (value < 25_000) return "Under $25k";
  if (value < 75_000) return "$25k-$75k";
  if (value < 250_000) return "$75k-$250k";
  if (value < 1_000_000) return "$250k-$1M";
  return "$1M+";
}

function getTradeEvidence(project: ProjectDetail, evidence: EvidenceRecord[], trade: OpportunityTrade): TradeEvidence[] {
  const evidenceItems: TradeEvidence[] = [];
  const blob = `${project.name} ${project.description} ${evidence.map((item) => `${item.title} ${item.summary}`).join(" ")}`.toLowerCase();
  const sourceEvidence = evidence.find((item) => item.record_type === "source_record") ?? evidence[0];
  const addTradeReason = (reason: string, confidence = 0.68) => {
    evidenceItems.push({ trade, reason, evidence_id: sourceEvidence.id, confidence });
  };

  if (trade === "Fencing") {
    if (blob.includes("logistics") || blob.includes("industrial")) addTradeReason("Industrial or logistics facility implies perimeter and access-control needs.", 0.78);
    if (blob.includes("outdoor") || blob.includes("storage")) addTradeReason("Outdoor storage area suggests fencing or security perimeter scope.", 0.8);
    if (blob.includes("subdivision") || blob.includes("production home") || blob.includes("master plan")) addTradeReason("Residential subdivision can require perimeter, yard, or phase fencing.", 0.74);
    if (blob.includes("demo") || blob.includes("demolition")) addTradeReason("Demolition activity may require temporary safety fencing.", 0.64);
    if (blob.includes("pool") || blob.includes("spa")) addTradeReason("Pool or spa scope often requires code-compliant barriers.", 0.62);
  }
  if (trade === "Concrete") {
    if (blob.includes("foundation") || blob.includes("footing")) addTradeReason("Foundation or footing language points to concrete scope.", 0.84);
    if (blob.includes("flatwork") || blob.includes("slab")) addTradeReason("Flatwork or slab language supports concrete relevance.", 0.82);
    if (blob.includes("parking") || blob.includes("site")) addTradeReason("Site or parking improvements can require concrete work.", 0.68);
    if (blob.includes("pool") || blob.includes("spa")) addTradeReason("Pool or spa construction can include concrete and hardscape scope.", 0.66);
  }
  if (trade === "Electrical") {
    if (blob.includes("electric") || blob.includes("service")) addTradeReason("Electrical service or power upgrade appears in source text.", 0.86);
    if (blob.includes("solar") || blob.includes("pv") || blob.includes("battery")) addTradeReason("Solar, PV, or battery scope requires electrical work.", 0.88);
    if (blob.includes("utility")) addTradeReason("Utility connection language supports electrical opportunity.", 0.74);
  }
  if (trade === "Roofing") {
    if (blob.includes("roof") || blob.includes("tpo")) addTradeReason("Roofing material or roof work appears directly in the source record.", 0.9);
    if (blob.includes("addition") || blob.includes("new building")) addTradeReason("New structures or additions can create roofing scope.", 0.62);
  }
  if (trade === "HVAC") {
    if (blob.includes("hvac") || blob.includes("heat pump") || blob.includes("mechanical")) addTradeReason("HVAC, heat pump, or mechanical language appears in source text.", 0.9);
    if (blob.includes("commercial")) addTradeReason("Commercial occupancy can create HVAC replacement or commissioning work.", 0.58);
  }
  if (trade === "Landscaping") {
    if (blob.includes("residential") || blob.includes("subdivision")) addTradeReason("Residential development commonly creates landscape and exterior improvement scope.", 0.58);
    if (blob.includes("site improvement")) addTradeReason("Site improvement language supports landscaping relevance.", 0.66);
  }
  if (trade === "Site work") {
    if (blob.includes("sewer") || blob.includes("utility")) addTradeReason("Sewer or utility language supports site work scope.", 0.86);
    if (blob.includes("grading") || blob.includes("demo")) addTradeReason("Grading or demolition indicates site preparation work.", 0.78);
  }

  if (!evidenceItems.length && trade !== "General") {
    const inferred = evidence.some((item) => {
      const trades = item.metadata?.inferred_trades;
      return Array.isArray(trades) && trades.includes(trade);
    });
    if (inferred) addTradeReason(`${trade} was selected from source-record trade inference.`, 0.6);
  }

  return evidenceItems.slice(0, 5);
}

function getContactIntelligence(project: ProjectDetail) {
  const lines: string[] = [];
  for (const company of project.companies) {
    lines.push(`${company.name} is listed as ${company.role}${company.notes ? `: ${company.notes}` : "."}`);
  }
  for (const evidence of project.evidence_records ?? []) {
    const contractor = evidence.metadata?.contractor;
    if (typeof contractor === "string" && isSourceBackedCompanyName(contractor)) {
      lines.push(`Source record lists contractor: ${contractor.trim()}.`);
    }
  }
  if (!lines.length) lines.push("No contractor contact was listed in the collected source record.");
  return [...new Set(lines)];
}

function getStructuredContacts(project: ProjectDetail): ContactIntelligence[] {
  const contacts: ContactIntelligence[] = [];
  for (const company of project.companies) {
    contacts.push({
      name: null,
      company: company.name,
      phone: company.phone,
      email: company.email,
      website: company.website,
      role: companyRoleToContactRole(company.role),
      confidence: company.phone || company.email || company.website ? 0.78 : 0.62,
      source: company.notes ?? "Project company record",
    });
  }
  for (const evidence of project.evidence_records ?? []) {
    const metadata = evidence.metadata ?? {};
    const contractor = textValue(metadata.contractor);
    if (contractor && isSourceBackedCompanyName(contractor)) {
      contacts.push({
        name: null,
        company: contractor,
        phone: textValue(metadata.phone),
        email: textValue(metadata.email),
        website: textValue(metadata.website),
        role: contractor.toLowerCase().includes("owner") ? "Property Owner" : "General Contractor",
        confidence: contractor.toLowerCase().includes("owner builder") ? 0.55 : 0.74,
        source: evidence.source_name,
      });
    }
    const agency = textValue(metadata.agency);
    if (agency) {
      contacts.push({
        name: null,
        company: agency,
        phone: null,
        email: null,
        website: evidence.source_url,
        role: "Government Contact",
        confidence: 0.72,
        source: evidence.source_name,
      });
    }
  }
  return dedupeContacts(contacts);
}

function companyRoleToContactRole(role: string): ContactIntelligence["role"] {
  if (role === "developer") return "Developer";
  if (role === "builder") return "Builder";
  if (role === "contractor") return "General Contractor";
  if (role === "architect") return "Architect";
  if (role === "engineer") return "Engineer";
  return "Applicant";
}

function dedupeContacts(contacts: ContactIntelligence[]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    if (isPlaceholderContact(contact)) return false;
    const key = `${contact.company}-${contact.role}-${contact.source}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function add(
  explanations: OpportunityScoreExplanation[],
  factor: string,
  points: number,
  reason: string,
  evidenceIds: string[],
) {
  explanations.push({ factor, points, reason, evidence_ids: [...new Set(evidenceIds)].slice(0, 6) });
}

function normalizeTrades(categories: string[]): OpportunityTrade[] {
  const trades: OpportunityTrade[] = categories.map((category): OpportunityTrade => {
    if (category === "Security fencing") return "Security fencing";
    if (category === "Site work") return "Site work";
    if (directTrades.has(category as OpportunityTrade)) return category as OpportunityTrade;
    return "General";
  });
  const fallback: OpportunityTrade[] = ["General"];
  return [...new Set(trades.length ? trades : fallback)];
}

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}

function getOpportunityAction(project: ProjectDetail, horizon: OpportunityHorizon) {
  const primary = getPrimaryContact(project);
  if (horizon === "Fast Money") {
    return primary ? `Contact ${primary.name} and verify whether the trade package is still open.` : "Pull the permit packet and identify the applicant, owner, or listed contractor.";
  }
  if (horizon === "Pipeline") return "Save the opportunity, monitor permit conversion, and contact the developer before bid packages close.";
  return "Track parcel, planning, CEQA, and utility activity until a project application or permit appears.";
}

function permitEvidence(permit: Permit, capturedAt: string): EvidenceRecord {
  return {
    id: `ev-permit-${permit.id}`,
    record_type: "permit",
    record_id: permit.id,
    source_name: "Permit record",
    source_url: permit.source_url,
    title: `${permit.permit_type} ${permit.permit_number}`,
    summary: `${permit.permit_status} permit dated ${permit.permit_date}.`,
    captured_at: permit.created_at || capturedAt,
    confidence: 0.86,
    metadata: {
      permit_status: permit.permit_status,
      permit_value: permit.permit_value,
    },
  };
}

function signalEvidence(signal: Signal, capturedAt: string): EvidenceRecord {
  return {
    id: `ev-signal-${signal.id}`,
    record_type: "signal",
    record_id: signal.id,
    source_name: signal.source,
    source_url: signal.source_url ?? null,
    title: signal.signal_type,
    summary: signal.description,
    captured_at: signal.signal_date || capturedAt,
    confidence: Math.max(0.35, Math.min(0.98, signal.importance_score / 100)),
    metadata: {
      signal_type: signal.signal_type,
      parcel_number: signal.parcel_number,
      jurisdiction: signal.jurisdiction,
      external_id: signal.external_id,
    },
  };
}

function documentEvidence(document: Document, capturedAt: string): EvidenceRecord {
  return {
    id: `ev-document-${document.id}`,
    record_type: "document",
    record_id: document.id,
    source_name: document.document_type,
    source_url: document.source_url,
    title: document.title,
    summary: document.summary ?? "Source document attached to this project.",
    captured_at: document.created_at || capturedAt,
    confidence: 0.76,
    metadata: {
      document_type: document.document_type,
    },
  };
}
