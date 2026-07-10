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
  const emptyTradeMessage = desiredTrade
    ? `No matching ${desiredTrade} opportunities were found for this search. Sentinel does not fall back to fencing results when another trade is requested.`
    : "Sentinel found no results that clear the contractor opportunity threshold for this search.";
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
                {top
                  ? `${ranked.length} ${tradeLabel}opportunities worth your time`
                  : "No matching contractor opportunities found yet."}
              </h2>
              {top ? (
                <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-600">
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
                      {opportunity.primary_contractor_trade ? ` · ${opportunity.primary_contractor_trade}` : ""}
                    </p>
                    <p className="mt-2 text-sm text-zinc-700">{opportunity.likely_scope || opportunity.primary_scope || "Scope to verify"}</p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {opportunity.opportunity_size && opportunity.opportunity_size !== "Unknown" ? `${opportunity.opportunity_size} job` : opportunity.scope_size}
                      {opportunity.project_stage && opportunity.project_stage !== "Unknown" ? ` · ${opportunity.project_stage}` : ""}
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
  const showFencingUi = !searchedTrade || searchedTrade === "Fencing";
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
      ? `${opportunity.second_contact}${opportunity.second_contact_phone ? ` · ${opportunity.second_contact_phone}` : ""}`
      : null,
  );
  const whyBullets = (showFencingUi ? buildWhyFencingMatters(opportunity) : buildWhyTradeMatters(opportunity, searchedTrade)).slice(0, 3);
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
    recommendedFirstCall: realValue(opportunity.recommended_first_call),
  });
  const timeline = buildTimeline(opportunity);
  const recommendedAction = opportunity.recommended_first_call
    || opportunity.recommended_action
    || nextStep
    || "Research the GC or developer before outreach.";

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300">
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{tradeLabel} · {location || "Location TBD"}</p>
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
                {developer && generalContractor ? " · " : null}
                {generalContractor ? <>GC: <span className="font-medium text-zinc-800">{generalContractor}</span></> : null}
              </p>
            ) : null}
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Likely Scope</p>
            <p className="mt-2 text-sm text-zinc-600">Probable work categories to verify before bidding.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {likelyScopeCategories.map((category) => (
                <Badge key={category} className="border-zinc-200 bg-zinc-50 text-zinc-800">{category}</Badge>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Why a {tradeLabel.toLowerCase()} contractor should care</p>
            <ul className="mt-2 space-y-1 text-sm leading-6 text-emerald-950">
              {whyBullets.map((bullet) => <li key={bullet}>- {bullet}</li>)}
            </ul>
          </section>

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
                No direct phone yet. {nextStep || "Research the GC or developer before outreach."}
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
                      <p className="font-medium">“{item.text ?? item.snippet}”</p>
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

function buildContractorProjectSummary(opportunity: ContractorOpportunity, tradeLabel: string) {
  const paragraphs: string[] = [];
  const built = opportunity.primary_scope
    || opportunity.project_dossier?.primary_objective
    || opportunity.project_categories?.[0]
    || opportunity.project_type
    || "A construction project";
  const location = [opportunity.city, opportunity.county].filter(Boolean).join(", ");
  paragraphs.push(
    `${built}${location ? ` in ${location}` : ""}. This looks like ${friendlySize(opportunity).toLowerCase()} work rather than a one-line permit note.`,
  );

  const stage = friendlyStage(opportunity);
  paragraphs.push(
    `Current phase appears to be ${stage.toLowerCase()}. ${
      /permit|issued|construction|open|active/i.test(stage)
        ? "That usually means subcontractors can still get in if they move quickly."
        : "Confirm timing before spending estimating hours."
    }`,
  );

  const work = opportunity.likely_scope
    || opportunity.evidence_likely_fence_scope
    || opportunity.scope_summary
    || (opportunity.work_categories?.length ? opportunity.work_categories.slice(0, 3).join(", ") : null)
    || `${tradeLabel} scope to verify from plans`;
  paragraphs.push(`Likely work involved: ${work}.`);

  const whyTrade = showTradeRelevance(opportunity, tradeLabel);
  paragraphs.push(whyTrade);

  return paragraphs;
}

function showTradeRelevance(opportunity: ContractorOpportunity, tradeLabel: string) {
  if (tradeLabel === "Fencing") {
    if (opportunity.fencing_bidable === false) {
      return opportunity.fencing_bidability_reason
        || "Fence mentions look incidental, so this may not be worth a fencing bid yet.";
    }
    if (opportunity.why_fencing_matters && !/No direct fencing references found|No bid-able fencing scope found/i.test(opportunity.why_fencing_matters)) {
      return opportunity.why_fencing_matters;
    }
    if (opportunity.potential_fencing_scope?.length) {
      return `Fencing is relevant because the records point to ${opportunity.potential_fencing_scope.slice(0, 2).join(" and ").toLowerCase()}.`;
    }
  }
  if (opportunity.qualification_reason && !/score|confidence|intelligence/i.test(opportunity.qualification_reason)) {
    return opportunity.qualification_reason;
  }
  return `${tradeLabel} is relevant because the project name, trade tags, or scope language point to ${tradeLabel.toLowerCase()} work a subcontractor can pursue.`;
}

const SCOPE_CATEGORY_RULES: Array<{ label: string; terms: string[] }> = [
  { label: "Foundation", terms: ["foundation", "footing", "stem wall"] },
  { label: "Flatwork", terms: ["flatwork", "sidewalk", "curb", "gutter", "slab"] },
  { label: "Site Prep", terms: ["site prep", "grading", "earthwork", "excavation", "clearing"] },
  { label: "Driveways", terms: ["driveway", "drive way", "parking"] },
  { label: "Utilities", terms: ["utility", "utilities", "sewer", "water main", "storm", "drainage"] },
  { label: "Structural Concrete", terms: ["structural concrete", "concrete wall", "tilt-up", "retaining"] },
  { label: "Retaining Walls", terms: ["retaining wall", "retaining walls"] },
  { label: "Gates", terms: ["gate", "gates", "sliding gate", "vehicle gate"] },
  { label: "Fencing", terms: ["fence", "fencing", "perimeter", "chain link"] },
  { label: "Roofing", terms: ["roof", "roofing", "reroof", "membrane", "shingle"] },
  { label: "HVAC", terms: ["hvac", "heat pump", "package unit", "mechanical", "rtu"] },
  { label: "Electrical", terms: ["electrical", "solar", "panel", "lighting", "power"] },
  { label: "Plumbing", terms: ["plumbing", "repipe", "backflow", "gas line"] },
  { label: "Demolition", terms: ["demo", "demolition"] },
  { label: "Landscaping", terms: ["landscape", "irrigation", "planting"] },
  { label: "Asphalt", terms: ["asphalt", "paving"] },
];

function inferLikelyScopeCategories(opportunity: ContractorOpportunity, tradeLabel: string) {
  const haystack = [
    opportunity.project_name,
    opportunity.project_summary,
    opportunity.scope_summary,
    opportunity.likely_scope,
    opportunity.primary_scope,
    opportunity.trade,
    ...(opportunity.work_categories ?? []),
    ...(opportunity.project_categories ?? []),
    ...(opportunity.potential_fencing_scope ?? []),
    opportunity.evidence_likely_fence_scope,
  ].filter(Boolean).join(" ").toLowerCase();

  const matched = SCOPE_CATEGORY_RULES
    .filter((rule) => rule.terms.some((term) => haystack.includes(term)))
    .map((rule) => rule.label);

  if (tradeLabel && !matched.includes(tradeLabel)) matched.unshift(tradeLabel);
  if (opportunity.potential_fencing_scope?.length) {
    for (const scope of opportunity.potential_fencing_scope.slice(0, 3)) {
      const cleaned = scope.replace(/\b(installation|package|work)\b/gi, "").trim();
      if (cleaned && !matched.some((item) => item.toLowerCase() === cleaned.toLowerCase())) matched.push(cleaned);
    }
  }

  const unique = [...new Set(matched)].slice(0, 8);
  return unique.length ? unique : [`${tradeLabel} scope to verify`];
}

function buildWhyThisContact(input: {
  decisionMaker?: string;
  decisionMakerRole?: string;
  decisionMakerCompany?: string;
  decisionMakerPhone?: string;
  accessPath?: string;
  generalContractor?: string;
  developer?: string;
  recommendedFirstCall?: string;
}) {
  if (input.recommendedFirstCall) return input.recommendedFirstCall;
  if (input.decisionMakerPhone && input.decisionMaker) {
    if (input.accessPath?.toLowerCase().includes("owner")) {
      return `${input.decisionMaker} looks like the site/owner contact with a working phone, so they are the fastest path to ask who awards ${input.decisionMakerRole ? input.decisionMakerRole.toLowerCase() + " " : ""}work.`;
    }
    if (input.accessPath?.toLowerCase().includes("developer")) {
      return `${input.decisionMaker} is tied to the developer side and has a phone on file, so start there for subcontractor introductions.`;
    }
    return `${input.decisionMaker}${input.decisionMakerRole ? ` (${input.decisionMakerRole})` : ""} has a reachable phone and appears closest to awarding or directing the work.`;
  }
  if (input.decisionMakerCompany || input.generalContractor) {
    const company = input.decisionMakerCompany || input.generalContractor;
    return `${company} is the best company lead on this job${input.accessPath ? ` via a ${input.accessPath.toLowerCase()} path` : ""}. Ask for estimating, purchasing, or the project manager.`;
  }
  if (input.developer) {
    return `${input.developer} is the developer of record. Use them to find who is selecting trade subcontractors.`;
  }
  return "No strong direct contact is confirmed yet. Start with the GC or developer listed on the permit and ask who handles trade pricing.";
}

function buildTimeline(opportunity: ContractorOpportunity) {
  const currentStage = friendlyStage(opportunity);
  const projectStatus = (() => {
    if (/research/i.test(opportunity.pursuit_confidence ?? "") || opportunity.opportunity_state === "Research Required") {
      return "Needs more research before outreach";
    }
    if (opportunity.opportunity_state === "Actionable Opportunity" || opportunity.pursuit_confidence === "High Confidence") {
      return "Ready to pursue";
    }
    if (opportunity.opportunity_state === "Opportunity" || opportunity.pursuit_confidence === "Medium Confidence") {
      return "Active opportunity";
    }
    return "Active opportunity";
  })();
  const bidStatus = realValue(opportunity.subcontractor_award_probability)
    || (opportunity.subcontractor_likelihood === "High"
      ? "Likely still open to subcontractors"
      : opportunity.subcontractor_likelihood === "Low"
        ? "May already be covered"
        : "Bid window not confirmed");
  let outreachTiming = "Research first, then call once a contact is confirmed";
  if (/permit issued|construction|open|active/i.test(currentStage) && (opportunity.decision_maker_phone || opportunity.best_contact?.phone)) {
    outreachTiming = "Call this week while the job is still active";
  } else if (/permit issued|construction|open|active/i.test(currentStage)) {
    outreachTiming = "Act soon — find the right phone and call within a few days";
  } else if (/planning|entitlement|design/i.test(currentStage)) {
    outreachTiming = "Early relationship call — introduce yourself before bidding starts";
  } else if (opportunity.fast_money_potential && /high|fast/i.test(opportunity.fast_money_potential)) {
    outreachTiming = "Prioritize this week if you can reach a decision maker";
  }

  return {
    currentStage,
    projectStatus,
    bidStatus,
    outreachTiming,
  };
}

function buildWhyTradeMatters(opportunity: ContractorOpportunity, trade: string | null) {
  const label = trade ?? opportunity.primary_contractor_trade ?? "trade";
  const bullets = new Set<string>();
  const relevance = showTradeRelevance(opportunity, label);
  if (relevance) bullets.add(relevance);
  if (opportunity.likely_scope) bullets.add(`Probable scope: ${opportunity.likely_scope}.`);
  if (opportunity.opportunity_size && opportunity.opportunity_size !== "Unknown") {
    bullets.add(`Job size looks ${opportunity.opportunity_size.toLowerCase()}, which can support a real ${label.toLowerCase()} package.`);
  }
  if (opportunity.subcontractor_likelihood === "High") {
    bullets.add("Subcontractor involvement looks likely rather than fully self-performed.");
  }
  if (bullets.size === 0) {
    bullets.add(`This project shows ${label.toLowerCase()} relevance worth a quick review.`);
    bullets.add("Confirm scope in the source documents before estimating.");
  }
  return [...bullets].slice(0, 5);
}

function buildWhyFencingMatters(opportunity: ContractorOpportunity) {
  if (opportunity.fencing_bidable === false || ["No Meaningful Fence Opportunity", "No Evidence"].includes(opportunity.fence_scope_confidence)) {
    return [
      opportunity.fencing_bidability_reason
        ?? (opportunity.primary_scope
          ? `Primary project scope is ${opportunity.primary_scope}. Incidental fence/gate mentions are not enough to bid.`
          : "No clear fencing package found yet."),
      "Do not spend estimating time until stronger fencing scope shows up.",
    ];
  }

  if (["Weak Signal", "Weak Opportunity"].includes(opportunity.fence_scope_confidence)) {
    return [
      "Only weak fencing indicators were found.",
      "Treat this as a research lead, not a ready bid.",
    ];
  }

  const bullets = new Set<string>();
  if (opportunity.why_fencing_matters && !/No direct fencing references found|No bid-able fencing scope found/i.test(opportunity.why_fencing_matters)) {
    bullets.add(opportunity.why_fencing_matters);
  }
  if (opportunity.potential_fencing_scope.length) {
    bullets.add(`Likely fencing package: ${opportunity.potential_fencing_scope.slice(0, 3).join(", ")}.`);
  }
  if (opportunity.subcontractor_likelihood === "High") {
    bullets.add("A fencing subcontractor still appears to have a path in.");
  }
  if (!bullets.size) {
    bullets.add("Source records support a fencing package worth verifying.");
  }
  return Array.from(bullets).slice(0, 5);
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
          <p className="text-sm leading-6 text-sky-900">{contact.evidence[0] ?? "Listed because this is the strongest reachable contact on file."}</p>
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-sky-900">
          No backup phone yet. Try the known access path: {backupRoute && backupRoute !== "Unknown" ? backupRoute : "GC or developer on the permit"}.
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
