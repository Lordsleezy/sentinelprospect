import Link from "next/link";
import { Clock3, Database, FileSearch, MapPin, Radar } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageTitle } from "@/components/layout/page-title";
import { ProjectResultCard } from "@/components/search/project-result-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getProject } from "@/lib/data";
import { getNextAction, getOpportunityFitLabel, getSourceCoverage, scoreOpportunity } from "@/lib/intelligence";
import { generateOpportunities } from "@/lib/opportunities";
import { globalSearch } from "@/lib/search";
import type { Opportunity, OpportunityTrade } from "@/lib/types";

const popularSearches = [
  "Fence opportunities in Sacramento",
  "Projects starting within 90 days",
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
  const projectDetails = (await Promise.all(results.projects.map((project) => getProject(project.id)))).filter(Boolean);
  const desiredTrade = inferQueryTrade(q);
  const wantsFastMoney = /\b(6 months|six months|90 days|fast money|starting|start)\b/i.test(q);
  const ranked = projectDetails
    .map((project) => {
      const generated = pickGeneratedOpportunity(project!, desiredTrade, wantsFastMoney);
      const opportunity = scoreOpportunity(project!);
      const evidenceBoost = (generated?.evidence.length ?? 0) * 2;
      const tradeBoost = desiredTrade && generated?.trade === desiredTrade ? 25 : 0;
      const horizonBoost = wantsFastMoney && generated?.horizon === "Fast Money" ? 20 : 0;
      const rankScore = opportunity.score + Math.round((generated?.score ?? 0) * 0.35) + evidenceBoost + tradeBoost + horizonBoost;
      return { project: project!, opportunity, generated, rankScore };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
  const top = ranked[0];
  const generatedMatches = ranked.map((item) => item.generated).filter(Boolean) as Opportunity[];
  const fastMoneyCount = generatedMatches.filter((item) => item.horizon === "Fast Money").length;
  const pipelineCount = generatedMatches.filter((item) => item.horizon === "Pipeline").length;
  const earlyCount = generatedMatches.filter((item) => item.horizon === "Early Signals").length;
  const tradeLabel = desiredTrade ? `${desiredTrade.toLowerCase()} ` : "";
  const sourceCount = results.signals.length + results.permits.length + results.companies.length;

  return (
    <AppShell>
      <PageTitle title={q ? `Search results: ${q}` : "Search Opportunities"} eyebrow="Construction opportunity intelligence">
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
                    {top ? `Found ${ranked.length} likely ${tradeLabel}opportunities. Top match: ${top.project.name}.` : "No likely opportunities found yet."}
                  </h2>
                  {top?.generated ? (
                    <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-600">
                      <p>Fast Money: {fastMoneyCount} | Pipeline: {pipelineCount} | Early Signals: {earlyCount}</p>
                      <p><span className="font-semibold text-zinc-950">Why top match:</span> {analysisWhy(top.generated)}</p>
                    </div>
                  ) : (
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">Try a trade plus a location, timing window, source, or project type so Sentinel can connect records into work.</p>
                  )}
                </div>
                {top ? (
                  <div className="rounded-md border border-emerald-100 bg-emerald-50 p-4 md:w-64">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{getOpportunityFitLabel(top.opportunity.score)}</p>
                    <p className="mt-2 text-3xl font-semibold text-emerald-950">{top.generated?.score ?? top.opportunity.score}</p>
                    <p className="mt-1 text-sm font-medium text-emerald-900">{top.generated?.horizon ?? top.opportunity.timingFit}</p>
                  </div>
                ) : null}
              </div>
              {top ? (
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <AnalysisFact icon={Clock3} label="Timing" value={top.opportunity.timeline} />
                  <AnalysisFact icon={MapPin} label="Location" value={`${top.project.city}, ${top.project.county}`} />
                  <AnalysisFact icon={FileSearch} label="Next Action" value={top.generated?.nextAction ?? getNextAction(top.project)} />
                </div>
              ) : null}
            </section>
            {ranked.length ? ranked.map(({ project }) => <ProjectResultCard key={project.id} project={project} />) : (
              <Card><CardContent><p className="text-sm text-zinc-500">No project opportunities found.</p></CardContent></Card>
            )}
          </section>
          <aside className="space-y-5">
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Ranked Opportunities</h2>
                <p className="mt-1 text-sm text-zinc-500">Prioritized by fit, timing, and evidence.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {ranked.slice(0, 4).map(({ project, opportunity }, index) => (
                  <div key={project.id} className="rounded-md border border-zinc-100 p-3">
                    <Link href={`/projects/${project.id}`} className="font-semibold underline">{index + 1}. {project.name}</Link>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge className="border-zinc-950 bg-zinc-950 text-white">{opportunity.score}</Badge>
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{opportunity.timingFit}</Badge>
                    </div>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Why</p>
                    <ul className="mt-1 space-y-1 text-sm text-zinc-600">
                      {opportunity.reasons.slice(0, 4).map((reason) => <li key={reason}>+ {reason}</li>)}
                    </ul>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sources</p>
                    <p className="mt-1 text-sm text-zinc-600">{getSourceCoverage(project).join(", ")}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {opportunity.evidence.slice(0, 2).map((item) => (
                        <Link key={item.label} href={item.href} className="text-xs font-medium underline">Evidence: {item.label}</Link>
                      ))}
                    </div>
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
                <p>Public works and bid-style terms</p>
                <p>Developers, builders, and contractors</p>
                <p>Timing language such as six months</p>
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

function pickGeneratedOpportunity(project: NonNullable<Awaited<ReturnType<typeof getProject>>>, desiredTrade: OpportunityTrade | null, wantsFastMoney: boolean) {
  const generated = generateOpportunities(project);
  const matchingTrade = desiredTrade ? generated.find((item) => item.trade === desiredTrade) : null;
  if (matchingTrade && (!wantsFastMoney || matchingTrade.horizon === "Fast Money")) return matchingTrade;
  if (matchingTrade) return matchingTrade;
  if (wantsFastMoney) return generated.find((item) => item.horizon === "Fast Money") ?? generated[0];
  return generated[0];
}

function analysisWhy(opportunity: Opportunity) {
  const tradeReason = opportunity.trade_evidence?.[0]?.reason;
  const scoreReason = opportunity.score_explanations.find((item) => item.points > 0)?.reason;
  const source = opportunity.evidence.find((item) => item.record_type === "source_record")?.source_name;
  return [tradeReason, scoreReason, source ? `Source: ${source}.` : ""].filter(Boolean).join(" ");
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
