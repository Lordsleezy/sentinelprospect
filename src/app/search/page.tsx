import Link from "next/link";
import { Clock3, Database, FileSearch, Mail, MapPin, Phone, Radar, Route } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageTitle } from "@/components/layout/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getAccessSearchResults, type AccessOpportunity } from "@/lib/access-intelligence";
import { formatHumanContact, getOpportunityHumanContact, type HumanContact } from "@/lib/human-contact-discovery";
import { globalSearch } from "@/lib/search";
import type { OpportunityTrade } from "@/lib/types";

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
  const ranked = getAccessSearchResults(q);
  const top = ranked[0];
  const desiredTrade = inferQueryTrade(q);
  const actionableCount = ranked.filter((item) => item.opportunity_state === "Actionable Opportunity").length;
  const researchCount = ranked.filter((item) => item.opportunity_state === "Research Required").length;
  const opportunityCount = ranked.filter((item) => item.opportunity_state === "Opportunity").length;
  const fastMoneyCount = ranked.filter((item) => item.fast_money_potential === "High").length;
  const fenceCount = ranked.filter((item) => item.fence_probability >= 50).length;
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
                    {top ? `Found ${ranked.length} ${tradeLabel}opportunities with access intelligence. Top match: ${top.project_name}.` : "No matching access intelligence found yet."}
                  </h2>
                  {top ? (
                    <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-600">
                      <p>Actionable: {actionableCount} | Research Required: {researchCount} | Opportunity: {opportunityCount} | Fast Money: {fastMoneyCount} | Fence Signals: {fenceCount}</p>
                      <p><span className="font-semibold text-zinc-950">How to get in:</span> {top.entry_method}. {top.recommended_next_step}</p>
                    </div>
                  ) : (
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">Try a trade plus a location, timing window, source, or project type. Sentinel no longer hides opportunities only because a phone number is unknown.</p>
                  )}
                </div>
                {top ? (
                  <div className="rounded-md border border-emerald-100 bg-emerald-50 p-4 md:w-64">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{top.opportunity_state}</p>
                    <p className="mt-2 text-3xl font-semibold text-emerald-950">{top.access_score}</p>
                    <p className="mt-1 text-sm font-medium text-emerald-900">Access Score</p>
                  </div>
                ) : null}
              </div>
              {top ? (
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <AnalysisFact icon={Clock3} label="Fast Money" value={top.fast_money_potential} />
                  <AnalysisFact icon={MapPin} label="Location" value={`${top.city}, ${top.county}`} />
                  <AnalysisFact icon={Route} label="Entry Method" value={top.entry_method} />
                </div>
              ) : null}
            </section>
            {ranked.length ? ranked.map((opportunity) => <AccessOpportunityCard key={opportunity.id} opportunity={opportunity} />) : (
              <Card>
                <CardHeader><h2 className="font-semibold">No matching access intelligence yet</h2></CardHeader>
                <CardContent className="space-y-2 text-sm text-zinc-600">
                  <p>Sentinel searches opportunities, research-required leads, and actionable access routes. No phone number is required for an opportunity to appear.</p>
                  <p>Try broader terms such as subdivision fencing, utility expansion, public works fencing, or perimeter security.</p>
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
                      <Badge className="border-zinc-950 bg-zinc-950 text-white">Access {opportunity.access_score}</Badge>
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{opportunity.opportunity_state}</Badge>
                    </div>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Why</p>
                    <p className="mt-1 text-sm text-zinc-600">{opportunity.entry_method}. Qualification {opportunity.qualification_score}, fence probability {opportunity.fence_probability}%.</p>
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

function AccessOpportunityCard({ opportunity }: { opportunity: AccessOpportunity }) {
  const humanContact = getOpportunityHumanContact(opportunity.id);
  const bestContact = humanContact?.best_contact ?? null;
  const nextStep = humanContact?.recommended_next_step ?? opportunity.recommended_next_step;

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-sm font-semibold text-emerald-700">{opportunity.opportunity_state}</p>
          <h3 className="text-xl font-semibold text-zinc-950">{opportunity.project_name}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge className="border-zinc-950 bg-zinc-950 text-white">Access {opportunity.access_score}</Badge>
            <Badge>Qualification {opportunity.qualification_score}</Badge>
            <Badge>Fence Probability {opportunity.fence_probability}%</Badge>
            <Badge>{opportunity.fast_money_potential} Fast Money</Badge>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <AnalysisDatum label="Project" value={opportunity.project_name} />
            <AnalysisDatum label="Developer" value={opportunity.developer} />
            <AnalysisDatum label="GC" value={opportunity.general_contractor} />
            <AnalysisDatum label="Architect" value={opportunity.architect} />
            <AnalysisDatum label="Procurement Route" value={opportunity.procurement_route} />
            <AnalysisDatum label="Entry Method" value={opportunity.entry_method} />
            <AnalysisDatum label="Access Route" value={opportunity.access_route} />
            <AnalysisDatum label="Trade" value={opportunity.trade} />
            <AnalysisDatum label="Location" value={`${opportunity.city}, ${opportunity.county}`} />
          </dl>
          <HumanContactPanel contact={bestContact} backupRoute={humanContact?.backup_access_route ?? opportunity.access_route} />
          <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Recommended Next Step</p>
            <p className="mt-2 text-sm font-medium leading-6 text-emerald-950">{nextStep}</p>
          </div>
        </div>
        <Link href={opportunity.source_url} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
          Evidence
          <FileSearch className="size-4" />
        </Link>
      </div>
    </article>
  );
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
          <p className="text-base font-semibold text-sky-950">Unknown</p>
          <p className="text-sm leading-6 text-sky-900">No source-backed human contact is available yet. Use the backup access route: {backupRoute || "Unknown"}.</p>
        </div>
      )}
    </div>
  );
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

function inferQueryTrade(query: string): OpportunityTrade | null {
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
