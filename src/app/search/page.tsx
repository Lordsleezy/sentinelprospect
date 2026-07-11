import Link from "next/link";
import { Database, FileSearch, Mail, Phone, Radar } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageTitle } from "@/components/layout/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getContractorOpportunitySearchResults,
  getSimilarContractorOpportunities,
  inferSearchTrades,
  type ContractorOpportunity,
} from "@/lib/contractor-opportunity-engine";
import { formatHumanContact, getOpportunityHumanContact, type HumanContact } from "@/lib/human-contact-discovery";

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
  const ranked = getContractorOpportunitySearchResults(q);
  const top = ranked[0];
  const desiredTrades = inferSearchTrades(q);
  const desiredTrade = desiredTrades[0] ?? inferQueryTrade(q);
  const highConfidenceCount = ranked.filter((item) => item.pursuit_confidence === "High Confidence").length;
  const mediumConfidenceCount = ranked.filter((item) => item.pursuit_confidence === "Medium Confidence").length;
  const researchCount = ranked.filter((item) => item.pursuit_confidence === "Research Required" || item.opportunity_state === "Research Required").length;
  const tradeLabel = desiredTrade ? `${desiredTrade.toLowerCase()} ` : "";
  const emptyTradeMessage = desiredTrade === "Fencing"
    ? "No callable development-scale fencing opportunities matched this search. Sentinel only shows fencing jobs with a point of contact, and it hides tiny residential gate/repair permits."
    : desiredTrade
      ? `No matching ${desiredTrade} opportunities were found for this search. Sentinel does not fall back to fencing results when another trade is requested.`
      : "Sentinel found no results that clear the contractor opportunity threshold for this search.";
  const resultHeadline = top
    ? desiredTrade === "Fencing"
      ? `${ranked.length} fencing opportunities with contacts`
      : `${ranked.length} ${tradeLabel}opportunities worth your time`
    : "No matching contractor opportunities found yet.";
  const resultSubcopy = top && desiredTrade === "Fencing"
    ? ranked.length <= 6
      ? `Prioritized for housing developments and larger fence packages with a point of contact. Only ${ranked.length} cleared the bar — more results need better contact coverage on big projects.`
      : "Prioritized for housing developments and larger fence packages. Every result has a point of contact."
    : null;
  const similarNearby = top ? getSimilarContractorOpportunities(top, 4) : [];

  return (
    <AppShell>
      <PageTitle title={q ? `Search results: ${q}` : "Opportunity Search"} eyebrow="Find work worth calling on">
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
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <Radar className="size-4" />
                Jobs you can pursue
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
                {resultHeadline}
              </h2>
              {top ? (
                <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-600">
                  {resultSubcopy ? <p>{resultSubcopy}</p> : null}
                  <p>
                    {highConfidenceCount} ready to call · {mediumConfidenceCount} need a little research · {researchCount} research only
                  </p>
                  <p>
                    Start with <span className="font-semibold text-zinc-950">{top.project_name}</span>
                    {top.city ? ` in ${top.city}` : ""}.
                    {top.recommended_first_call || top.decision_maker_phone
                      ? " Contact details are on the card below."
                      : " Open the card for who to call and when to act."}
                  </p>
                </div>
              ) : (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{emptyTradeMessage} Try a different trade, location, timing window, or project type.</p>
              )}
            </section>
            {ranked.length ? ranked.map((opportunity) => <ContractorOpportunityCard key={opportunity.id} opportunity={opportunity} searchedTrade={desiredTrade} />) : (
              <Card>
                <CardHeader><h2 className="font-semibold">{desiredTrade ? `No ${desiredTrade} opportunities found` : "No realistic contractor opportunities found"}</h2></CardHeader>
                <CardContent className="space-y-2 text-sm text-zinc-600">
                  <p>{emptyTradeMessage}</p>
                  <p>Try broader terms such as subdivision work, public works, commercial development, utility expansion, or a different trade.</p>
                </CardContent>
              </Card>
            )}
          </section>
          <aside className="space-y-5">
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Similar Opportunities Nearby</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Related by trade, location, and scope{top ? ` to ${top.project_name}` : ""}.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {similarNearby.length ? similarNearby.map((opportunity) => (
                  <div key={opportunity.id} className="rounded-md border border-zinc-100 p-3">
                    <p className="font-semibold">{opportunity.project_name}</p>
                    <p className="mt-1 text-sm text-zinc-600">
                      {[opportunity.city, opportunity.county].filter(Boolean).join(", ") || "Nearby"}
                      {opportunity.primary_contractor_trade ? ` Â· ${opportunity.primary_contractor_trade}` : ""}
                    </p>
                    <p className="mt-2 text-sm text-zinc-700">
                      {opportunity.primary_scope
                        || (!/fence|gate/i.test(opportunity.likely_scope ?? "") ? opportunity.likely_scope : null)
                        || opportunity.project_categories?.[0]
                        || "Scope in source records"}
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {opportunity.opportunity_size && opportunity.opportunity_size !== "Unknown" ? `${opportunity.opportunity_size} job` : opportunity.scope_size}
                      {opportunity.project_stage && opportunity.project_stage !== "Unknown" ? ` Â· ${opportunity.project_stage}` : ""}
                    </p>
                  </div>
                )) : (
                  <p className="text-sm text-zinc-500">No nearby matches with similar trade and scope yet.</p>
                )}
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

function ContractorOpportunityCard({ opportunity, searchedTrade }: { opportunity: ContractorOpportunity; searchedTrade: string | null }) {
  const humanContact = getOpportunityHumanContact(opportunity.id);
  const bestContact = humanContact?.best_contact ?? null;
  const displayContact = bestContact ?? opportunity.best_contact ?? null;
  const nextStep = humanContact?.recommended_next_step ?? opportunity.recommended_next_step;
  const tradeLabel = searchedTrade ?? opportunity.primary_contractor_trade ?? "Trade";
  const developer = realValue(opportunity.populated_fields.developer);
  const generalContractor = realValue(opportunity.populated_fields.general_contractor);
  const contactName = realValue(displayContactName(displayContact));
  const contactPhone = realValue(displayContactPhone(displayContact));
  const contactEmail = realValue(displayContactEmail(displayContact));
  const decisionMaker = realValue(opportunity.decision_maker) ?? contactName;
  const decisionMakerRole = realValue(opportunity.decision_maker_role);
  const decisionMakerPhone = realValue(opportunity.decision_maker_phone) ?? contactPhone;
  const decisionMakerEmail = realValue(opportunity.decision_maker_email) ?? contactEmail;
  const decisionMakerCompany = realValue(opportunity.decision_maker_company)
    ?? realValue(displayContact?.company)
    ?? generalContractor
    ?? developer;
  const secondContact = realValue(
    opportunity.second_contact
      ? `${opportunity.second_contact}${opportunity.second_contact_phone ? ` Â· ${opportunity.second_contact_phone}` : ""}`
      : null,
  );
  const whyBullets = buildEvidenceWhyTradeMatters(opportunity, tradeLabel).slice(0, 3);
  const evidenceSnippets = opportunity.evidence_snippets ?? opportunity.project_dossier?.evidence_snippets ?? [];
  const whoToCall = decisionMaker ?? decisionMakerCompany ?? "Contact not identified yet";
  const location = [opportunity.city, opportunity.county].filter(Boolean).join(", ");
  const projectSummary = buildContractorProjectSummary(opportunity, tradeLabel);
  const likelyScopeCategories = inferLikelyScopeCategories(opportunity, tradeLabel);
  const whyThisContact = buildWhyThisContact({
    decisionMaker,
    decisionMakerRole,
    decisionMakerCompany,
    decisionMakerPhone,
    accessPath: realValue(opportunity.access_path_type ?? opportunity.access_path?.type),
    generalContractor,
    developer,
    tradeLabel,
    recommendedFirstCall: tradeSafeText(realValue(opportunity.recommended_first_call), tradeLabel),
  });
  const timeline = buildTimeline(opportunity);
  const recommendedAction = pickRecommendedAction(opportunity, tradeLabel, nextStep);

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300">
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{tradeLabel} Â· {location || "Location TBD"}</p>
            <h3 className="mt-1 text-xl font-semibold text-zinc-950">{opportunity.project_name}</h3>
          </div>
          <Badge className={pursuitConfidenceBadgeClass(opportunity.pursuit_confidence)}>
            {contractorReadinessLabel(opportunity.pursuit_confidence)}
          </Badge>
        </div>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <VisibleDatum label="Opportunity Size" value={friendlySize(opportunity)} />
          <VisibleDatum label="Project Stage" value={friendlyStage(opportunity)} />
          <VisibleDatum label="Subcontractor Likelihood" value={opportunity.subcontractor_likelihood || "Unknown"} />
          <VisibleDatum label="Recommended Action" value={shortAction(recommendedAction)} />
        </dl>

        <div className="mt-5 space-y-4">
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Project Summary</p>
            <div className="mt-2 space-y-2 text-sm leading-6 text-zinc-700">
              {projectSummary.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
            {(developer || generalContractor) ? (
              <p className="mt-3 text-sm text-zinc-600">
                {developer ? <>Developer: <span className="font-medium text-zinc-800">{developer}</span></> : null}
                {developer && generalContractor ? " Â· " : null}
                {generalContractor ? <>GC: <span className="font-medium text-zinc-800">{generalContractor}</span></> : null}
              </p>
            ) : null}
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Likely Scope</p>
            {likelyScopeCategories.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {likelyScopeCategories.map((category) => (
                  <Badge key={category} className="border-zinc-200 bg-zinc-50 text-zinc-800">{category}</Badge>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">No specific work categories confirmed in the source records yet.</p>
            )}
          </section>

          {whyBullets.length ? (
            <section className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Why a {tradeLabel.toLowerCase()} contractor should care</p>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-emerald-950">
                {whyBullets.map((bullet) => <li key={bullet}>- {bullet}</li>)}
              </ul>
            </section>
          ) : null}

          <section className="rounded-md border border-amber-100 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Who should I call?</p>
            <p className="mt-2 text-base font-semibold leading-6 text-amber-950">{whoToCall}</p>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <OptionalVisibleDatum label="Role" value={decisionMakerRole} />
              <OptionalVisibleDatum label="Company" value={decisionMakerCompany} />
              <OptionalVisibleDatum label="Phone" value={decisionMakerPhone} />
              <OptionalVisibleDatum label="Email" value={decisionMakerEmail} />
              <OptionalVisibleDatum label="Second contact" value={secondContact} />
            </dl>
            <div className="mt-3 rounded-md border border-amber-200/70 bg-white/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Why this contact?</p>
              <p className="mt-2 text-sm leading-6 text-amber-950">{whyThisContact}</p>
            </div>
            {!decisionMakerPhone && !decisionMakerEmail ? (
              <p className="mt-2 text-sm text-amber-900">
                No direct phone yet. {tradeSafeText(nextStep, tradeLabel) || "Research the GC or developer before outreach."}
              </p>
            ) : null}
          </section>

          <section className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Timeline</p>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <VisibleDatum label="Current Stage" value={timeline.currentStage} />
              <VisibleDatum label="Project Status" value={timeline.projectStatus} />
              <VisibleDatum label="Bid Status" value={timeline.bidStatus} />
              <VisibleDatum label="Recommended Outreach Timing" value={timeline.outreachTiming} />
            </dl>
          </section>

          {opportunity.document_intelligence ? (
            <section className="rounded-md border border-sky-200 bg-sky-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Project Dossier</p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <VisibleDatum label="What Is Being Built" value={opportunity.document_intelligence.what_is_being_built || "Not yet extracted"} />
                <VisibleDatum label="Procurement Path" value={opportunity.document_intelligence.procurement_path || "Unknown"} />
              </dl>
              <div className="mt-3 space-y-3 text-sm leading-6 text-sky-950">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Scope Summary</p>
                  <p className="mt-1">{opportunity.document_intelligence.scope_summary}</p>
                </div>
                {opportunity.document_intelligence.identified_quantities?.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Identified Quantities</p>
                    <ul className="mt-1 space-y-1">
                      {opportunity.document_intelligence.identified_quantities.slice(0, 5).map((item) => (
                        <li key={`${item.kind}-${item.quantity}`}>{item.quantity} — {item.context.slice(0, 120)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {opportunity.document_intelligence.timeline_summary ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Timeline</p>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{opportunity.document_intelligence.timeline_summary}</pre>
                  </div>
                ) : null}
                {opportunity.document_intelligence.best_contact ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Best Contact</p>
                    <p className="mt-1 font-medium">
                      {opportunity.document_intelligence.best_contact.name}
                      {opportunity.document_intelligence.best_contact.role ? ` · ${opportunity.document_intelligence.best_contact.role}` : ""}
                    </p>
                  </div>
                ) : null}
                {opportunity.document_intelligence.evidence?.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Supporting Evidence</p>
                    <ul className="mt-2 space-y-3">
                      {opportunity.document_intelligence.evidence.slice(0, 4).map((item) => (
                        <li key={`${item.source}-${item.signal}-${item.text.slice(0, 40)}`}>
                          <p className="font-medium">“{item.text}”</p>
                          <p className="mt-1 text-xs text-sky-800">Source: {item.source}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {opportunity.document_intelligence.why_this_trade_matters ? (
                  <p className="text-xs text-sky-800">{opportunity.document_intelligence.why_this_trade_matters}</p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        <details className="mt-5 rounded-md border border-zinc-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-800">Project Evidence</summary>
          <div className="mt-4 space-y-4">
            {evidenceSnippets.length ? (
              <div className="rounded-md border border-sky-100 bg-sky-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Source excerpts</p>
                <ul className="mt-2 space-y-3 text-sm leading-6 text-sky-950">
                  {evidenceSnippets.slice(0, 4).map((item) => (
                    <li key={`${item.source_document_id ?? item.source}-${item.signal}-${item.snippet ?? item.text}`}>
                      <p className="font-medium">â€œ{item.text ?? item.snippet}â€</p>
                      <p className="mt-1 text-xs text-sky-800">Source: {item.source_document ?? item.source}</p>
                      <Link href={item.source_url} className="mt-1 inline-block text-xs font-medium underline">
                        Open source document
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">What the records show</p>
              <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-700">
                {opportunity.project_dossier ? (
                  <>
                    <p>{opportunity.project_dossier.evidence_summary}</p>
                    {opportunity.project_dossier.related_development ? (
                      <p>Related development: {opportunity.project_dossier.related_development}</p>
                    ) : null}
                    {opportunity.project_dossier.primary_objective ? (
                      <p>Primary objective: {opportunity.project_dossier.primary_objective}</p>
                    ) : null}
                  </>
                ) : (
                  <p>{opportunity.scope_summary || opportunity.project_summary || "Source records are linked below."}</p>
                )}
                {opportunity.project_dossier?.evidence_sources?.length ? (
                  <ul className="space-y-1">
                    {opportunity.project_dossier.evidence_sources.slice(0, 8).map((source) => (
                      <li key={source.source_url}>- <Link href={source.source_url} className="underline">{source.label}</Link></li>
                    ))}
                  </ul>
                ) : null}
                <Link href={opportunity.source_url} className="inline-flex items-center gap-2 font-medium text-zinc-950 underline">
                  Open source evidence
                  <FileSearch className="size-4" />
                </Link>
              </div>
            </div>

            {(developer || generalContractor || opportunity.populated_fields.architect) ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <OptionalVisibleDatum label="Developer" value={developer} />
                <OptionalVisibleDatum label="General Contractor" value={generalContractor} />
                <OptionalDatum label="Architect" value={opportunity.populated_fields.architect} />
                <OptionalVisibleDatum label="Location" value={location} />
              </dl>
            ) : null}

            <div className="mt-1">
              <HumanContactPanel contact={bestContact} backupRoute={humanContact?.backup_access_route ?? opportunity.access_route} />
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

function OptionalDatum({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return <VisibleDatum label={label} value={value} className="font-medium text-zinc-800" />;
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
  if (/^unknown\b/i.test(value.trim())) return undefined;
  return value;
}

function pursuitConfidenceBadgeClass(value?: string) {
  if (value === "High Confidence") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (value === "Medium Confidence") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function contractorReadinessLabel(value?: string) {
  if (value === "High Confidence") return "Ready to call";
  if (value === "Medium Confidence") return "Worth pursuing";
  return "Needs research";
}


function friendlySize(opportunity: ContractorOpportunity) {
  const size = realValue(opportunity.opportunity_size) || realValue(opportunity.scope_size);
  return size || "Size not confirmed";
}

function friendlyStage(opportunity: ContractorOpportunity) {
  return realValue(opportunity.procurement_stage) || realValue(opportunity.project_stage) || "Stage not confirmed";
}

function shortAction(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 72) return cleaned;
  return `${cleaned.slice(0, 69).trim()}...`;
}

function isFencingContaminated(text: string, tradeLabel: string) {
  if (/^fencing$/i.test(tradeLabel)) return false;
  return /\bfenc(?:e|ing)\b|\bgates?\b|fence package|who awards fence/i.test(text);
}

function tradeSafeText(value: string | undefined, tradeLabel: string) {
  if (!value) return undefined;
  if (isFencingContaminated(value, tradeLabel)) return undefined;
  return value;
}

function pickRecommendedAction(opportunity: ContractorOpportunity, tradeLabel: string, nextStep?: string) {
  const candidates = [
    tradeSafeText(opportunity.document_intelligence?.recommended_action, tradeLabel),
    tradeSafeText(opportunity.recommended_action, tradeLabel),
    tradeSafeText(opportunity.recommended_first_call ?? undefined, tradeLabel),
    tradeSafeText(nextStep, tradeLabel),
  ].filter(Boolean) as string[];
  if (candidates[0]) return candidates[0];
  const contact = opportunity.decision_maker || opportunity.best_contact?.name || opportunity.best_contact?.company;
  const phone = opportunity.decision_maker_phone || opportunity.best_contact?.phone;
  if (contact && phone) return `Call ${contact} about ${tradeLabel.toLowerCase()} work on this project.`;
  if (contact) return `Reach ${contact} and ask who handles ${tradeLabel.toLowerCase()} pricing.`;
  return `Find the GC or developer and ask who handles ${tradeLabel.toLowerCase()} work.`;
}

const TRADE_EVIDENCE_TERMS: Record<string, string[]> = {
  Fencing: ["fence", "fencing", "gate", "gates", "chain link", "perimeter fence"],
  Concrete: ["concrete", "stemwall", "stem wall", "foundation", "footing", "flatwork", "sidewalk", "curb", "gutter", "slab", "driveway"],
  Roofing: ["roofing", "reroof", "re-roof", "shingle", "tpo", "membrane", "roof geometry", "capsheet"],
  HVAC: ["hvac", "heat pump", "package unit", "package units", "rtu", "air conditioning", "split system", "mech ("],
  Electrical: ["electrical", "electrician", "solar", "photovoltaic", "service panel", "panel upgrade", "lighting"],
  Plumbing: ["plumbing", "repipe", "backflow", "gas line", "sewer"],
  Landscaping: ["landscape", "landscaping", "irrigation", "planting"],
  Demolition: ["demo", "demolition"],
  "Site work": ["site work", "grading", "earthwork", "excavation"],
  Asphalt: ["asphalt", "paving"],
  Utility: ["utility", "utilities", "drainage", "water main", "storm"],
};

function projectEvidenceText(opportunity: ContractorOpportunity, tradeLabel: string) {
  const snippets = (opportunity.evidence_snippets ?? opportunity.project_dossier?.evidence_snippets ?? [])
    .map((item) => item.text ?? item.snippet)
    .filter(Boolean);
  const docIntel = opportunity.document_intelligence;
  const fencingBits = /^fencing$/i.test(tradeLabel)
    ? [
        ...(opportunity.fence_evidence ?? []),
        ...(opportunity.potential_fencing_scope ?? []),
        opportunity.evidence_likely_fence_scope,
        opportunity.why_fencing_matters,
      ]
    : [];
  return [
    opportunity.project_name,
    docIntel?.project_description,
    docIntel?.construction_summary,
    docIntel?.scope_summary,
    docIntel?.why_this_trade_matters,
    ...(docIntel?.evidence ?? []).map((item) => item.text),
    ...(docIntel?.trade_evidence ?? []).map((item) => item.snippet),
    opportunity.project_summary,
    opportunity.scope_summary,
    opportunity.primary_scope,
    opportunity.project_dossier?.project_summary,
    opportunity.project_dossier?.primary_objective,
    opportunity.project_dossier?.evidence_summary,
    ...(opportunity.work_categories ?? []),
    ...(opportunity.project_categories ?? []),
    ...snippets,
    ...fencingBits,
  ].filter(Boolean).join(" ");
}

function extractEvidencePhrases(opportunity: ContractorOpportunity, tradeLabel: string) {
  const terms = TRADE_EVIDENCE_TERMS[tradeLabel] ?? [tradeLabel.toLowerCase()];
  const phrases: string[] = [];
  const docIntel = opportunity.document_intelligence;
  const sources = [
    ...(docIntel?.evidence ?? []).map((item) => item.text),
    ...(docIntel?.trade_evidence ?? []).map((item) => item.snippet),
    docIntel?.why_this_trade_matters,
    docIntel?.scope_summary,
    opportunity.project_name,
    opportunity.project_summary,
    opportunity.scope_summary,
    opportunity.primary_scope,
    opportunity.project_dossier?.primary_objective,
    ...(opportunity.evidence_snippets ?? opportunity.project_dossier?.evidence_snippets ?? []).map((item) => item.text ?? item.snippet),
    ...(/^fencing$/i.test(tradeLabel) ? (opportunity.fence_evidence ?? []) : []),
  ].filter(Boolean) as string[];

  for (const source of sources) {
    const lower = source.toLowerCase();
    const hit = terms.find((term) => lower.includes(term));
    if (!hit) continue;
    const cleaned = source.replace(/\s+/g, " ").trim();
    if (cleaned.length <= 140) phrases.push(cleaned);
    else {
      const idx = lower.indexOf(hit);
      const start = Math.max(0, idx - 40);
      const end = Math.min(cleaned.length, idx + hit.length + 60);
      phrases.push(cleaned.slice(start, end).trim());
    }
    if (phrases.length >= 3) break;
  }
  return [...new Set(phrases)];
}

function buildContractorProjectSummary(opportunity: ContractorOpportunity, tradeLabel: string) {
  const paragraphs: string[] = [];
  const location = [opportunity.city, opportunity.county].filter(Boolean).join(", ");
  const built = realValue(opportunity.document_intelligence?.what_is_being_built)
    || realValue(opportunity.primary_scope)
    || realValue(opportunity.project_dossier?.primary_objective)
    || realValue(opportunity.project_categories?.[0])
    || realValue(opportunity.project_type)
    || opportunity.project_name.replace(/\s+/g, " ").trim();

  paragraphs.push(`${built}${location ? ` — ${location}` : ""}.`);

  const stage = friendlyStage(opportunity);
  if (stage !== "Stage not confirmed") paragraphs.push(`Current stage: ${stage}.`);

  const evidencePhrases = extractEvidencePhrases(opportunity, tradeLabel);
  if (evidencePhrases.length) paragraphs.push(`Source record: “${evidencePhrases[0]}”`);
  else {
    const scope = tradeSafeText(opportunity.likely_scope, tradeLabel);
    if (scope) paragraphs.push(`Likely work: ${scope}.`);
  }

  return paragraphs;
}

const SCOPE_CATEGORY_RULES: Array<{ label: string; terms: string[]; trades?: string[] }> = [
  { label: "Foundation", terms: ["foundation", "footing", "stem wall", "stemwall"] },
  { label: "Flatwork", terms: ["flatwork", "sidewalk", "curb", "gutter"] },
  { label: "Site Prep", terms: ["site prep", "grading", "earthwork", "excavation", "clearing"] },
  { label: "Driveways", terms: ["driveway"] },
  { label: "Utilities", terms: ["utility", "utilities", "sewer", "water main", "storm drain", "drainage"] },
  { label: "Structural Concrete", terms: ["structural concrete", "concrete wall", "tilt-up"] },
  { label: "Retaining Walls", terms: ["retaining wall", "retaining walls"] },
  { label: "Gates", terms: ["gate", "gates", "sliding gate", "vehicle gate"], trades: ["Fencing", "Security"] },
  { label: "Fencing", terms: ["fence", "fencing", "chain link", "perimeter fence"], trades: ["Fencing", "Security"] },
  { label: "Roofing", terms: ["roofing", "reroof", "re-roof", "shingle", "tpo", "membrane", "capsheet"], trades: ["Roofing"] },
  { label: "HVAC", terms: ["hvac", "heat pump", "package unit", "rtu", "split system", "air conditioning"], trades: ["HVAC"] },
  { label: "Electrical", terms: ["electrical", "solar", "photovoltaic", "service panel", "panel upgrade"], trades: ["Electrical", "Solar"] },
  { label: "Plumbing", terms: ["plumbing", "repipe", "backflow", "gas line"], trades: ["Plumbing"] },
  { label: "Demolition", terms: ["demolition", "demo "] },
  { label: "Landscaping", terms: ["landscape", "landscaping", "irrigation", "planting"], trades: ["Landscaping"] },
  { label: "Asphalt", terms: ["asphalt", "paving"], trades: ["Asphalt", "Site work"] },
  { label: "Slab", terms: ["slab"] },
];

function inferLikelyScopeCategories(opportunity: ContractorOpportunity, tradeLabel: string) {
  const haystack = projectEvidenceText(opportunity, tradeLabel).toLowerCase();
  const concreteAdjacent = ["Foundation", "Flatwork", "Driveways", "Structural Concrete", "Retaining Walls", "Slab", "Site Prep", "Utilities", "Demolition"];
  const matched = SCOPE_CATEGORY_RULES
    .filter((rule) => {
      if (!rule.terms.some((term) => haystack.includes(term))) return false;
      if (rule.trades && !rule.trades.some((trade) => trade.toLowerCase() === tradeLabel.toLowerCase())) {
        return concreteAdjacent.includes(rule.label) && ["Concrete", "Site work", "General Contractor"].includes(tradeLabel);
      }
      return true;
    })
    .map((rule) => rule.label);

  return [...new Set(matched)].slice(0, 8);
}

function buildWhyThisContact(input: {
  decisionMaker?: string;
  decisionMakerRole?: string;
  decisionMakerCompany?: string;
  decisionMakerPhone?: string;
  accessPath?: string;
  generalContractor?: string;
  developer?: string;
  tradeLabel: string;
  recommendedFirstCall?: string;
}) {
  if (input.recommendedFirstCall && !isFencingContaminated(input.recommendedFirstCall, input.tradeLabel)) {
    return input.recommendedFirstCall;
  }
  if (input.decisionMakerPhone && input.decisionMaker) {
    const role = input.decisionMakerRole ? ` (${input.decisionMakerRole})` : "";
    if (input.accessPath?.toLowerCase().includes("owner")) {
      return `${input.decisionMaker}${role} is listed as the owner/site contact with a phone on file.`;
    }
    if (input.accessPath?.toLowerCase().includes("developer")) {
      return `${input.decisionMaker}${role} is the developer-side contact with a phone on file.`;
    }
    if (input.accessPath?.toLowerCase().includes("gc")) {
      return `${input.decisionMaker}${role} is the GC-side contact with a phone on file.`;
    }
    return `${input.decisionMaker}${role} has a phone on file for this project.`;
  }
  if (input.decisionMakerCompany || input.generalContractor) {
    const company = input.decisionMakerCompany || input.generalContractor;
    return `${company} is the company listed on the project record${input.accessPath ? ` (${input.accessPath})` : ""}.`;
  }
  if (input.developer) return `${input.developer} is the developer listed on the project record.`;
  return "No direct contact is confirmed in the source records yet.";
}

function buildTimeline(opportunity: ContractorOpportunity) {
  const currentStage = friendlyStage(opportunity);
  const projectStatus = (() => {
    if (/research/i.test(opportunity.pursuit_confidence ?? "") || opportunity.opportunity_state === "Research Required") {
      return "Needs research before outreach";
    }
    if (opportunity.pursuit_confidence === "High Confidence") return "Ready to pursue";
    if (opportunity.pursuit_confidence === "Medium Confidence") return "Active opportunity";
    return "Active opportunity";
  })();
  const bidStatus = realValue(opportunity.subcontractor_award_probability)
    || (opportunity.subcontractor_likelihood === "High"
      ? "Likely still open to subcontractors"
      : opportunity.subcontractor_likelihood === "Low"
        ? "May already be covered"
        : "Bid window not confirmed");
  let outreachTiming = "Confirm a contact before calling";
  if (/permit issued|construction|open|active/i.test(currentStage) && (opportunity.decision_maker_phone || opportunity.best_contact?.phone)) {
    outreachTiming = "Call this week";
  } else if (/permit issued|construction|open|active/i.test(currentStage)) {
    outreachTiming = "Find a phone and call within a few days";
  } else if (/planning|entitlement|design/i.test(currentStage)) {
    outreachTiming = "Early intro call before bidding starts";
  }

  return { currentStage, projectStatus, bidStatus, outreachTiming };
}

function buildEvidenceWhyTradeMatters(opportunity: ContractorOpportunity, tradeLabel: string) {
  const bullets: string[] = [];
  if (/^fencing$/i.test(tradeLabel)) {
    const housingPackage = /subdivision|housing-development fence package|villages?\s+at|unit\s+\d+|lennar|kb home/i.test(
      `${opportunity.likely_scope ?? ""} ${opportunity.project_name} ${opportunity.developer ?? ""}`,
    );
    const noDirectFence = ["No Evidence", "No Meaningful Fence Opportunity"].includes(opportunity.fence_scope_confidence)
      || opportunity.fencing_bidable === false;
    if (housingPackage && noDirectFence) {
      bullets.push("Housing development with a callable developer/GC contact — chase as a likely fence package, not a confirmed fence permit.");
    }
  }
  const docWhy = opportunity.document_intelligence?.why_this_trade_matters;
  if (docWhy && !isFencingContaminated(docWhy, tradeLabel)) {
    bullets.push(docWhy.startsWith("Source document:") ? docWhy : `Source document: ${docWhy}`);
  }
  for (const item of (opportunity.document_intelligence?.evidence ?? []).slice(0, 2)) {
    if (item.text) bullets.push(`Source document: “${item.text}”`);
  }
  for (const phrase of extractEvidencePhrases(opportunity, tradeLabel)) {
    bullets.push(`Source record: “${phrase}”`);
  }
  if (/^fencing$/i.test(tradeLabel)) {
    if (opportunity.fencing_bidable === false && opportunity.fencing_bidability_reason && !bullets.some((b) => /housing development/i.test(b))) {
      return [opportunity.fencing_bidability_reason];
    }
    for (const scope of (opportunity.potential_fencing_scope ?? []).slice(0, 2)) {
      bullets.push(`Likely fencing package: ${scope}.`);
    }
  }
  const scope = tradeSafeText(opportunity.likely_scope, tradeLabel);
  if (scope && !bullets.some((bullet) => bullet.toLowerCase().includes(scope.toLowerCase()))) {
    bullets.push(`Likely work: ${scope}.`);
  }
  return [...new Set(bullets)].slice(0, 4);
}

function HumanContactPanel({ contact, backupRoute }: { contact: HumanContact | null; backupRoute: string }) {
  const sourceIsLink = contact?.source?.startsWith("http");
  return (
    <div className="rounded-md border border-sky-100 bg-sky-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Backup contact route</p>
      {contact ? (
        <div className="mt-2 space-y-3">
          <div>
            <p className="text-base font-semibold text-sky-950">{formatHumanContact(contact)}</p>
            <p className="mt-1 text-sm text-sky-900">{contact.company} · {humanizeContactType(contact.contactType)}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {contact.phone ? <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-medium text-sky-950"><Phone className="size-3.5" /> {contact.phone}</span> : null}
            {contact.email ? <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-medium text-sky-950"><Mail className="size-3.5" /> {contact.email}</span> : null}
            {sourceIsLink ? <Link href={contact.source} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-medium text-sky-950 underline">Source</Link> : null}
          </div>
          {contact.evidence[0] ? <p className="text-sm leading-6 text-sky-900">{contact.evidence[0]}</p> : null}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-sky-900">
          No backup phone on file. Try: {backupRoute && backupRoute !== "Unknown" ? backupRoute : "GC or developer on the permit"}.
        </p>
      )}
    </div>
  );
}

function humanizeContactType(value: HumanContact["contactType"]) {
  return value.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
