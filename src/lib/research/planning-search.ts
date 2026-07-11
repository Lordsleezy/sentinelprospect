import planningArtifact from "../../../data/planning_signals.json";
import type { PlanningSignal } from "./planning-signals";
import { inferLikelyTradesFromPlanningText } from "./planning-signals";

export type PlanningSearchLead = PlanningSignal & {
  relevance_score: number;
  why_it_matches: string;
};

const planningSignals: PlanningSignal[] = Array.isArray((planningArtifact as { signals?: PlanningSignal[] }).signals)
  ? ((planningArtifact as { signals: PlanningSignal[] }).signals)
  : [];

export function getPlanningSearchLeads(query: string, tradeHint?: string | null, limit = 12): PlanningSearchLead[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tradeTerms = tradeHint ? [tradeHint.toLowerCase()] : [];
  const wantsPlanning = /\b(planning|entitlement|subdivision|housing|development|tentative|rezone|ceqa|pre-?app)\b/.test(q)
    || Boolean(tradeHint);

  return planningSignals
    .map((signal) => scoreLead(signal, q, tradeHint, tradeTerms, wantsPlanning))
    .filter((lead) => lead.relevance_score >= 20)
    .sort((a, b) => b.relevance_score - a.relevance_score || packageRank(b) - packageRank(a))
    .slice(0, limit);
}

export function getPlanningSignalInventory() {
  return planningSignals;
}

function scoreLead(
  signal: PlanningSignal,
  query: string,
  tradeHint: string | null | undefined,
  tradeTerms: string[],
  wantsPlanning: boolean,
) {
  const blob = [
    signal.title,
    signal.summary,
    signal.raw_excerpt,
    signal.location_text,
    signal.city,
    signal.county,
    signal.stage,
    signal.package_hint,
    ...(signal.trades_likely ?? []),
    ...(signal.developers ?? []),
  ].filter(Boolean).join(" ").toLowerCase();

  let score = 0;
  const why: string[] = [];

  if (signal.package_hint === "development") {
    score += 28;
    why.push("development-scale planning package");
  } else if (signal.package_hint === "commercial") {
    score += 18;
    why.push("commercial-scale entitlement");
  }

  if (/\bsacramento|placer|roseville|rocklin|natomas|antelope|carmichael\b/.test(query)) {
    if (blob.includes("sacramento") && query.includes("sacramento")) score += 16;
    if (blob.includes("placer") && query.includes("placer")) score += 16;
    if (signal.city && query.includes(signal.city.toLowerCase())) score += 10;
  }

  if (wantsPlanning) score += 10;

  const trades = signal.trades_likely?.length
    ? signal.trades_likely
    : inferLikelyTradesFromPlanningText(blob);
  if (tradeHint && trades.some((trade) => trade.toLowerCase() === tradeHint.toLowerCase())) {
    score += 24;
    why.push(`likely ${tradeHint.toLowerCase()} package once building starts`);
  } else if (tradeTerms.some((term) => blob.includes(term))) {
    score += 12;
  }

  for (const token of query.split(/[^a-z0-9]+/).filter((part) => part.length > 2)) {
    if (blob.includes(token)) score += 3;
  }

  if (signal.contact_phone) {
    score += 8;
    why.push("planner phone on file");
  } else if (signal.contact_email) {
    score += 4;
  }

  if (!why.length) why.push("early public-record planning signal");

  return {
    ...signal,
    relevance_score: score,
    why_it_matches: why.slice(0, 2).join("; "),
  };
}

function packageRank(signal: PlanningSignal) {
  return signal.package_hint === "development" ? 3 : signal.package_hint === "commercial" ? 2 : 1;
}
