import Link from "next/link";
import { Clock3, Database, FileSearch, Mail, MapPin, Phone, Radar, Route } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageTitle } from "@/components/layout/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getContractorOpportunitySearchResults, positiveFenceEvidence, type ContractorOpportunity } from "@/lib/contractor-opportunity-engine";
import { formatHumanContact, getOpportunityHumanContact, type HumanContact } from "@/lib/human-contact-discovery";
import { globalSearch } from "@/lib/search";

const popularSearches = [
  "Fence opportunities in Sacramento",
  "Opportunities starting within 90 days",
  "Public works fencing bids near Sacramento",
  "Commercial projects needing electrical contractors",
  "Developer activity in Placer County",
];

const searchFilters = [
  { label: "Trade", values: ["Fence", "Concrete", "Electrical", "Roofing", "HVAC", "Site Work"] },
  { label: "Location", values: ["Sacramento", "Roseville", "Rocklin", "Placer County"] },
  { label: "Timeline", values: ["Fast Money", "0-6 Months", "6-18 Months", "18+ Months"] },
  { label: "Project Type", values: ["Commercial", "Residential", "Industrial", "Public Works"] },
];

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const q = params.q ?? "";
  const results = await globalSearch(q);
  const ranked = getContractorOpportunitySearchResults(q);
  const top = ranked[0];
  const desiredTrade = inferQueryTrade(q);
  const actionableCount = ranked.filter((item) => item.opportunity_state === "Actionable Opportunity").length;
  const researchCount = ranked.filter((item) => item.opportunity_state === "Research Required").length;
  const opportunityCount = ranked.filter((item) => item.opportunity_state === "Opportunity").length;
  const highSubcontractCount = ranked.filter((item) => item.subcontractor_likelihood === "High").length;
  const majorScopeCount = ranked.filter((item) => item.scope_size === "Major" || item.scope_size === "Large").length;
  const actionableNowCount = ranked.filter((item) => item.actionability_score >= 70).length;
  const tradeLabel = desiredTrade ? `${desiredTrade.toLowerCase()} ` : "";
  const sourceCount = results.signals.length + results.permits.length + results.companies.length;

  return (
    <AppShell>
      <PageTitle title={q ? `Search results: ${q}` : "Opportunity Search"} eyebrow="Prospect intelligence">
        <Link href="/sources" className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          <Database className="size-4" />
          Sources
        </Link>
      </PageTitle>
      <Card className="mb-5 p-4">
        <form className="flex flex-col gap-3 sm:flex-row">
          <Input name="q" placeholder="Search by trade, location, developer, project type, or timeline..." defaultValue={q} className="h-12 text-base" />
          <Button className="h-12 px-6">Find Opportunities</Button>
        </form>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">Popular Searches</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {popularSearches.map((search) => (
            <Link key={search} href={`/search?q=${encodeURIComponent(search)}`} className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
              {search}
            </Link>
          ))}
        </div>
        <div className="mt-4 grid gap-3 border-t border-zinc-100 pt-4">
          {searchFilters.map((group) => (
            <div key={group.label} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="w-24 text-xs font-semibold uppercase tracking-wide text-zinc-500">{group.label}</p>
              <div className="flex flex-wrap gap-2">
                {group.values.map((value) => (
                  <Link key={value} href={`/search?q=${encodeURIComponent(value)}`} className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50">
                    {value}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {q ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
          <section className="space-y-4">
            <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <Radar className="size-4" />
                    Sentinel Analysis
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
                    {top ? `Found ${ranked.length} realistic ${tradeLabel}contractor opportunities. Top match: ${top.project_name}.` : "No matching contractor opportunities found yet."}
                  </h2>
                  {top ? (
                    <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-600">
                      <p>Actionable Now: {actionableNowCount} | Actionable: {actionableCount} | Research Required: {researchCount} | Opportunity: {opportunityCount} | High Subcontract Likelihood: {highSubcontractCount} | Large/Major Scope: {majorScopeCount}</p>
                      <p><span className="font-semibold text-zinc-950">What this is:</span> {top.project_summary}</p>
                      <p><span className="font-semibold text-zinc-950">What to do:</span> {top.recommended_action}</p>
                    </div>
                  ) : (
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">Try a trade plus a location, timing window, source, or project type. Sentinel suppresses tiny repairs, noise matches, and projects already controlled by the searched trade contractor.</p>
                  )}
                </div>
                {top ? (
                  <div className="rounded-md border border-emerald-100 bg-emerald-50 p-4 md:w-64">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{top.primary_contractor_trade}</p>
                    <p className="mt-2 text-3xl font-semibold text-emerald-950">{top.actionability_score}</p>
                    <p className="mt-1 text-sm font-medium text-emerald-900">Actionability Score</p>
                  </div>
                ) : null}
              </div>
              {top ? (
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <AnalysisFact icon={Clock3} label="Likely Scope" value={top.likely_scope} />
                  <AnalysisFact icon={MapPin} label="Location" value={`${top.city}, ${top.county}`} />
                  <AnalysisFact icon={Route} label="Access Path" value={top.access_path.type} />
                </div>
              ) : null}
            </section>
            {ranked.length ? ranked.map((opportunity) => <ContractorOpportunityCard key={opportunity.id} opportunity={opportunity} />) : (
              <Card>
                <CardHeader><h2 className="font-semibold">No realistic contractor opportunities found</h2></CardHeader>
                <CardContent className="space-y-2 text-sm text-zinc-600">
                  <p>Sentinel found no results that clear the contractor opportunity threshold for this search.</p>
                  <p>Try broader terms such as subdivision work, public works, commercial development, utility expansion, or a different trade.</p>
                </CardContent>
              </Card>
            )}
          </section>
          <aside className="space-y-5">
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Ranked Opportunities</h2>
                <p className="mt-1 text-sm text-zinc-500">Prioritized by fit, timing, and evidence.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {ranked.slice(0, 4).map((opportunity, index) => (
                  <div key={opportunity.id} className="rounded-md border border-zinc-100 p-3">
                    <p className="font-semibold">{index + 1}. {opportunity.project_name}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge className="border-zinc-950 bg-zinc-950 text-white">Actionability {opportunity.actionability_score}</Badge>
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{opportunity.primary_contractor_trade}</Badge>
                    </div>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Why</p>
                    <p className="mt-1 text-sm text-zinc-600">{opportunity.recommended_action}</p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sources</p>
                    <Link href={opportunity.source_url} className="mt-1 block text-sm font-medium underline">Evidence source</Link>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><h2 className="font-semibold">Signal Evidence</h2></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-zinc-500">{sourceCount} related records from projects, permits, companies, and signals.</p>
                {results.signals.slice(0, 8).map((signal) => (
                  <Link key={signal.id} href={`/projects/${signal.project_id}`} className="block rounded-md border border-zinc-100 p-3 hover:bg-zinc-50">
                    <p className="text-sm font-semibold">{signal.signal_type}</p>
                    <p className="mt-1 text-xs text-zinc-500">Score {signal.importance_score} - {signal.source}</p>
                  </Link>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><h2 className="font-semibold">Search Includes</h2></CardHeader>
              <CardContent className="space-y-2 text-sm text-zinc-600">
                <p>Permits and permit status</p>
                <p>Planning and subdivision signals</p>
                <p>Access routes and procurement workflows</p>
                <p>Public works and bid-style terms</p>
                <p>Developers, builders, and contractors</p>
                <p>Fence-adjacent terms like utility, perimeter, gate, subdivision, and site work</p>
              </CardContent>
            </Card>
          </aside>
        </div>
      ) : (
        <Card><CardContent><p className="text-sm text-zinc-500">Search for a trade, place, source, project type, or timing window. Sentinel will return ranked opportunities instead of a raw record list.</p></CardContent></Card>
      )}
    </AppShell>
  );
}

function ContractorOpportunityCard({ opportunity }: { opportunity: ContractorOpportunity }) {
  const humanContact = getOpportunityHumanContact(opportunity.id);
  const bestContact = humanContact?.best_contact ?? null;
  const displayContact = bestContact ?? opportunity.best_contact ?? null;
  const nextStep = humanContact?.recommended_next_step ?? opportunity.recommended_next_step;
  const probability = fencingProbability(opportunity);
  const developer = realValue(opportunity.populated_fields.developer);
  const generalContractor = realValue(opportunity.populated_fields.general_contractor);
  const contactName = realValue(displayContactName(displayContact));
  const contactPhone = realValue(displayContactPhone(displayContact));
  const contactEmail = realValue(displayContactEmail(displayContact));
  const summary = conciseProjectSummary(opportunity.project_dossier?.project_summary ?? opportunity.project_summary);
  const whyFencingMatters = buildWhyFencingMatters(opportunity);
  const evidenceSnippets = opportunity.evidence_snippets ?? opportunity.project_dossier?.evidence_snippets ?? [];

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300">
      <div className="min-w-0">
        <h3 className="text-xl font-semibold text-zinc-950">{opportunity.project_name}</h3>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <VisibleDatum label="Fencing Probability" value={`${probability.percent}% - ${probability.label}`} className={probability.className} />
          <OptionalVisibleDatum label="Developer" value={developer} />
          <OptionalVisibleDatum label="General Contractor" value={generalContractor} />
          <OptionalVisibleDatum label="Best Contact" value={contactName} />
          <OptionalVisibleDatum label="Phone Number" value={contactPhone} />
          <OptionalVisibleDatum label="Email" value={contactEmail} />
        </dl>

        <div className="mt-4 rounded-md border border-zinc-100 bg-zinc-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Project Summary</p>
          <p className="mt-2 text-sm leading-6 text-zinc-800">{summary}</p>
          {opportunity.primary_scope ? (
            <p className="mt-2 text-xs text-zinc-600">
              Primary scope: {opportunity.primary_scope}
              {opportunity.fencing_bidable === true ? " · Bidable fencing work" : opportunity.fencing_bidable === false ? " · Not bidable as fencing" : ""}
            </p>
          ) : null}
        </div>

        <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Why a Fencing Contractor Should Care</p>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-emerald-950">
            {whyFencingMatters.map((bullet) => <li key={bullet}>- {bullet}</li>)}
          </ul>
        </div>

        {evidenceSnippets.length ? (
          <div className="mt-4 rounded-md border border-sky-100 bg-sky-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Evidence</p>
            <ul className="mt-2 space-y-3 text-sm leading-6 text-sky-950">
              {evidenceSnippets.slice(0, 4).map((item) => (
                <li key={`${item.source_document_id ?? item.source}-${item.signal}-${item.snippet ?? item.text}`}>
                  <p className="font-medium">“{item.text ?? item.snippet}”</p>
                  <p className="mt-1 text-xs text-sky-800">
                    Source: {item.source_document ?? item.source}
                    {item.confidence ? ` · Confidence: ${item.confidence}` : " · Confidence: direct"}
                  </p>
                  <Link href={item.source_url} className="mt-1 inline-block text-xs font-medium underline">
                    Open source document
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <details className="mt-4 rounded-md border border-zinc-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-800">View Supporting Evidence</summary>
          <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-700">
            {opportunity.project_dossier ? (
              <>
                <p>{opportunity.project_dossier.evidence_summary}</p>
                <p>Related development: {opportunity.project_dossier.related_development}</p>
                <p>Primary objective: {opportunity.project_dossier.primary_objective}</p>
              </>
            ) : (
              <p>{opportunity.confidence_reasoning}</p>
            )}
            {opportunity.project_dossier?.supporting_evidence.length ? (
              <ul className="space-y-1">
                {opportunity.project_dossier.evidence_sources.slice(0, 8).map((source) => <li key={source.source_url}>- <Link href={source.source_url} className="underline">{source.label}</Link></li>)}
              </ul>
            ) : null}
            <Link href={opportunity.source_url} className="inline-flex items-center gap-2 font-medium text-zinc-950 underline">
              Open source evidence
              <FileSearch className="size-4" />
            </Link>
          </div>
        </details>

        <details className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-800">Advanced Intelligence</summary>
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <FenceConfidenceBadge value={opportunity.fence_scope_confidence} />
              <Badge>Evidence Strength {opportunity.evidence_strength_score ?? 0}</Badge>
              <Badge>Sources {opportunity.source_count ?? 0}</Badge>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <AnalysisDatum label="Actionability Score" value={opportunity.actionability_score} />
              <AnalysisDatum label="Contractor Opportunity Score" value={opportunity.contractor_opportunity_score} />
              <AnalysisDatum label="Fence Scope Confidence" value={opportunity.fence_scope_confidence} />
              <AnalysisDatum label="Fencing Bidable" value={opportunity.fencing_bidable === true ? "Yes" : opportunity.fencing_bidable === false ? "No" : "Unknown"} />
              <AnalysisDatum label="Evidence Tier" value={opportunity.fence_evidence_tier ?? "Unknown"} />
              <AnalysisDatum label="Fence Signal Score" value={opportunity.fence_signal_score} />
              <AnalysisDatum label="Likely Scope" value={["Weak Signal", "Weak Opportunity"].includes(opportunity.fence_scope_confidence) ? "Insufficient evidence to determine likely fencing scope" : opportunity.likely_scope} />
              <AnalysisDatum label="Access Path" value={opportunity.access_path.type} />
              <AnalysisDatum label="Subcontractor Likelihood" value={opportunity.subcontractor_likelihood} />
              <AnalysisDatum label="Scope Size" value={opportunity.scope_size} />
              <AnalysisDatum label="Opportunity Size" value={opportunity.opportunity_size} />
              <AnalysisDatum label="Project Stage" value={opportunity.project_stage} />
              <OptionalDatum label="Architect" value={opportunity.populated_fields.architect} />
              <AnalysisDatum label="Existing Contractor Saturation" value={opportunity.existing_contractor_saturation_penalty ? `${opportunity.existing_contractor_saturation} penalty ${opportunity.existing_contractor_saturation_penalty}` : opportunity.existing_contractor_saturation} />
              <OptionalDatum label="Procurement Route" value={knownValue(opportunity.procurement_route)} />
              <OptionalDatum label="Entry Method" value={knownValue(opportunity.entry_method)} />
              <OptionalDatum label="Access Route" value={knownValue(opportunity.access_route)} />
              <AnalysisDatum label="Location" value={`${opportunity.city}, ${opportunity.county}`} />
            </dl>
            {opportunity.missing_intelligence.length ? (
              <p className="text-sm text-zinc-500">Additional intelligence not yet discovered: {opportunity.missing_intelligence.join(", ")}.</p>
            ) : null}
            {opportunity.suppress_reasons.length ? (
              <div className="rounded-md border border-amber-100 bg-amber-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Suppression Reasons</p>
                <p className="mt-2 text-sm font-medium leading-6 text-amber-950">{opportunity.suppress_reasons.join(", ")}</p>
              </div>
            ) : null}
            <HumanContactPanel contact={bestContact} backupRoute={humanContact?.backup_access_route ?? opportunity.access_route} />
            <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Opportunity Execution</p>
              <p className="mt-2 text-sm font-medium leading-6 text-emerald-950">{opportunity.recommended_action}</p>
            </div>
            <div className="rounded-md border border-zinc-100 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">What To Say</p>
              <p className="mt-2 text-sm font-medium leading-6 text-zinc-800">{opportunity.outreach_script}</p>
              <p className="mt-2 text-xs text-zinc-500">Backup next step: {nextStep}</p>
            </div>
          </div>
        </details>
      </div>
    </article>
  );
}

function VisibleDatum({ label, value, className = "text-zinc-800" }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className={`mt-1 break-words font-semibold ${className}`}>{value}</dd>
    </div>
  );
}

function OptionalVisibleDatum({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return <VisibleDatum label={label} value={value} />;
}

function conciseProjectSummary(summary: string) {
  const sentences = summary.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  return (sentences.slice(0, 2).join(" ") || "Project details are available in the supporting evidence.").trim();
}

function fencingProbability(opportunity: ContractorOpportunity) {
  const evidenceCount = positiveFenceEvidence(opportunity).length;
  if (opportunity.fencing_bidable === false || !evidenceCount || ["No Evidence", "No Meaningful Fence Opportunity", "Weak Opportunity", "Weak Signal"].includes(opportunity.fence_scope_confidence)) {
    return { percent: 0, label: "No Evidence", className: "text-red-700" };
  }
  if (["Primary Scope", "Primary Opportunity"].includes(opportunity.fence_scope_confidence)) return { percent: Math.min(100, 80 + evidenceCount * 5), label: "Primary Opportunity", className: "text-emerald-700" };
  if (["Secondary Scope", "Secondary Opportunity"].includes(opportunity.fence_scope_confidence)) return { percent: Math.min(80, 60 + evidenceCount * 5), label: "Secondary Opportunity", className: "text-sky-700" };
  if (["Possible Scope", "Possible Opportunity"].includes(opportunity.fence_scope_confidence)) return { percent: Math.min(50, 30 + evidenceCount * 5), label: "Possible Opportunity", className: "text-amber-700" };
  return { percent: 0, label: "No Evidence", className: "text-red-700" };
}

function displayContactName(contact: HumanContact | NonNullable<ContractorOpportunity["best_contact"]> | null) {
  if (!contact) return "Not identified";
  if (contact.name) return contact.name;
  if (contact.company) return contact.company;
  if ("title" in contact && contact.title) return contact.title;
  return "Not identified";
}

function displayContactPhone(contact: HumanContact | NonNullable<ContractorOpportunity["best_contact"]> | null) {
  return contact?.phone ?? "Not available";
}

function displayContactEmail(contact: HumanContact | NonNullable<ContractorOpportunity["best_contact"]> | null) {
  return contact?.email ?? "Not available";
}

function realValue(value?: string | null) {
  if (!value) return undefined;
  if (["not identified", "not available", "no contact information available", "unknown"].includes(value.trim().toLowerCase())) return undefined;
  return value;
}

function buildWhyFencingMatters(opportunity: ContractorOpportunity) {
  if (opportunity.fencing_bidable === false || ["No Meaningful Fence Opportunity", "No Evidence"].includes(opportunity.fence_scope_confidence)) {
    return [
      opportunity.fencing_bidability_reason
        ?? (opportunity.primary_scope
          ? `Primary project scope is ${opportunity.primary_scope}. Incidental fence/gate mentions are not enough to bid.`
          : "No bid-able fencing scope found."),
      "Available evidence does not support a meaningful fencing opportunity yet.",
      "Additional document review is required before outreach.",
    ];
  }

  if (["Weak Signal", "Weak Opportunity"].includes(opportunity.fence_scope_confidence)) {
    return [
      "Only weak or incidental fencing indicators were found.",
      "This is not yet a clear bid-able fencing opportunity.",
    ];
  }

  const bullets = new Set<string>();
  const snippets = opportunity.evidence_snippets ?? opportunity.project_dossier?.evidence_snippets ?? [];
  const directEvidence = opportunity.fence_evidence ?? [];

  if (opportunity.why_fencing_matters && !/No direct fencing references found|No bid-able fencing scope found/i.test(opportunity.why_fencing_matters)) {
    bullets.add(opportunity.why_fencing_matters);
  }

  for (const snippet of snippets) {
    const text = snippet.text ?? snippet.snippet;
    if (!text) continue;
    bullets.add(`Source evidence: "${text}"`);
    if (bullets.size >= 5) break;
  }

  for (const signal of directEvidence) {
    const bullet = summarizeFenceSignal(signal);
    if (bullet) bullets.add(bullet);
    if (bullets.size >= 5) break;
  }

  if (bullets.size < 5 && opportunity.potential_fencing_scope.length) {
    bullets.add(`Likely scope to verify: ${opportunity.potential_fencing_scope.slice(0, 3).join(", ")}.`);
  }

  if (!bullets.size) {
    bullets.add("Strong fencing installation evidence is not yet available in the connected source records.");
  }

  return Array.from(bullets).slice(0, 5);
}

function summarizeFenceSignal(signal: string) {
  const normalized = signal.toLowerCase();
  if (normalized.includes("subdivision") || normalized.includes("housing") || normalized.includes("residential") || normalized.includes("apartment")) {
    return "Residential development may create perimeter, community, or construction fencing needs.";
  }
  if (normalized.includes("school")) {
    return "School projects commonly require perimeter fencing and controlled access points.";
  }
  if (normalized.includes("park") || normalized.includes("trail") || normalized.includes("public access")) {
    return "Public access areas may require separation, safety fencing, or gates.";
  }
  if (normalized.includes("utility") || normalized.includes("drainage") || normalized.includes("infrastructure") || normalized.includes("public works")) {
    return "Infrastructure evidence is present, but fencing scope must be verified in source documents.";
  }
  if (normalized.includes("security") || normalized.includes("gate") || normalized.includes("boundary") || normalized.includes("access")) {
    return "Boundary, gate, security, or access-control signals appear in the source record.";
  }
  if (normalized.includes("industrial") || normalized.includes("warehouse") || normalized.includes("yard")) {
    return "Industrial or yard uses often need perimeter and security fencing.";
  }
  if (normalized.includes("fence")) {
    return "Fence-related language appears in the source record and should be verified.";
  }
  return null;
}

function HumanContactPanel({ contact, backupRoute }: { contact: HumanContact | null; backupRoute: string }) {
  const sourceIsLink = contact?.source?.startsWith("http");

  return (
    <div className="mt-4 rounded-md border border-sky-100 bg-sky-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Best Available Contact</p>
      {contact ? (
        <div className="mt-2 space-y-3">
          <div>
            <p className="text-base font-semibold text-sky-950">{formatHumanContact(contact)}</p>
            <p className="mt-1 text-sm text-sky-900">{contact.company} - {humanizeContactType(contact.contactType)} - {Math.round(contact.confidence * 100)}% confidence</p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {contact.phone ? <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-medium text-sky-950"><Phone className="size-3.5" /> {contact.phone}</span> : null}
            {contact.email ? <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-medium text-sky-950"><Mail className="size-3.5" /> {contact.email}</span> : null}
            {sourceIsLink ? <Link href={contact.source} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-medium text-sky-950 underline">Source</Link> : null}
          </div>
          <p className="text-sm leading-6 text-sky-900">{contact.evidence[0] ?? "Source-backed contact route."}</p>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-sm leading-6 text-sky-900">Additional contact intelligence not yet discovered. Use the backup access route: {backupRoute || "Unknown"}.</p>
        </div>
      )}
    </div>
  );
}

function FenceConfidenceBadge({ value }: { value: string }) {
  const className = ["Primary Scope", "Primary Opportunity"].includes(value)
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : ["Secondary Scope", "Secondary Opportunity"].includes(value)
      ? "border-sky-200 bg-sky-50 text-sky-800"
      : ["Possible Scope", "Possible Opportunity"].includes(value)
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : ["Weak Signal", "Weak Opportunity"].includes(value)
          ? "border-zinc-200 bg-zinc-50 text-zinc-700"
          : "border-red-200 bg-red-50 text-red-800";
  const label = ["Primary Scope", "Primary Opportunity"].includes(value)
    ? "Primary Opportunity"
    : ["Secondary Scope", "Secondary Opportunity"].includes(value)
      ? "Secondary Opportunity"
      : value === "No Evidence"
        ? "No Evidence"
        : value;
  return <Badge className={className}>{label}</Badge>;
}

function humanizeContactType(value: HumanContact["contactType"]) {
  return value.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function AnalysisDatum({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 break-words font-medium text-zinc-800">{String(value || "Unknown")}</dd>
    </div>
  );
}

function OptionalDatum({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return <AnalysisDatum label={label} value={value} />;
}

function knownValue(value: string) {
  if (!value || value === "Unknown") return undefined;
  return value;
}

function inferQueryTrade(query: string) {
  const q = query.toLowerCase();
  if (q.includes("fence") || q.includes("fencing")) return "Fencing";
  if (q.includes("concrete")) return "Concrete";
  if (q.includes("roof")) return "Roofing";
  if (q.includes("electrical") || q.includes("electric")) return "Electrical";
  if (q.includes("hvac") || q.includes("mechanical")) return "HVAC";
  if (q.includes("landscap")) return "Landscaping";
  if (q.includes("site work") || q.includes("utility")) return "Site work";
  return null;
}

function AnalysisFact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-2 text-sm font-medium leading-6 text-zinc-800">{value}</p>
    </div>
  );
}
