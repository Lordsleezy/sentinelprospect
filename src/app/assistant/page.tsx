import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { PageTitle } from "@/components/layout/page-title";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getProject } from "@/lib/data";
import { scoreOpportunity } from "@/lib/intelligence";
import { globalSearch } from "@/lib/search";

const prompts = [
  "Fencing opportunities in Sacramento that could be completed within 6 months",
  "Show me projects where contractors may not be selected yet.",
  "Fencing contractor call list for this week",
  "Best opportunities in Placer County",
];

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const q = params.q ?? "";
  const results = q ? await globalSearch(q) : { projects: [] };
  const details = q ? (await Promise.all(results.projects.slice(0, 8).map((project) => getProject(project.id)))).filter(Boolean) : [];
  const ranked = details
    .map((project) => ({ project: project!, opportunity: scoreOpportunity(project!) }))
    .sort((a, b) => b.opportunity.score - a.opportunity.score);

  return (
    <AppShell>
      <PageTitle title="Sentinel Analysis" eyebrow="Supporting analysis for opportunity searches" />
      <Card className="mb-5 p-4">
        <form className="flex flex-col gap-3 sm:flex-row">
          <Input name="q" placeholder="Analyze opportunities by trade, timing, contractor, county, or source..." defaultValue={q} className="h-12 text-base" />
          <Button className="h-12 px-6">Analyze</Button>
        </form>
      </Card>

      {!q ? (
        <Card>
          <CardHeader><h2 className="font-semibold">Popular Analysis Searches</h2></CardHeader>
          <CardContent className="grid gap-2">
            {prompts.map((prompt) => (
              <Link key={prompt} href={`/assistant?q=${encodeURIComponent(prompt)}`} className="rounded-md border border-zinc-100 p-3 text-sm font-medium hover:bg-zinc-50">
                {prompt}
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
          <section className="space-y-4">
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Sentinel Analysis</h2>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-zinc-700">
                <p>
                  I found {ranked.length} projects that match the request. The strongest opportunities are ranked by stage, signals, project size, known contractor coverage, and likely trade fit.
                </p>
                <p>
                  This is a transparent heuristic assistant: every recommendation below includes the reason and evidence links so it can be verified against project records.
                </p>
              </CardContent>
            </Card>
            {ranked.slice(0, 5).map(({ project, opportunity }, index) => (
              <Card key={project.id}>
                <CardHeader>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <Link href={`/projects/${project.id}`} className="text-lg font-semibold underline">{index + 1}. {project.name}</Link>
                      <p className="mt-1 text-sm text-zinc-500">{project.city}, {project.county} - {project.status}</p>
                    </div>
                    <span className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white">Score {opportunity.score}</span>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Why</p>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                      {opportunity.reasons.map((reason) => <li key={reason}>+ {reason}</li>)}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Evidence</p>
                    <div className="mt-2 grid gap-2">
                      {opportunity.evidence.slice(0, 4).map((item) => (
                        <Link key={item.label} href={item.href} className="text-sm font-medium underline">{item.label}</Link>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
          <aside className="space-y-5">
            <Card>
              <CardHeader><h2 className="font-semibold">Searches Used</h2></CardHeader>
              <CardContent className="space-y-2 text-sm text-zinc-600">
                <p>Projects</p>
                <p>Signals</p>
                <p>Permits</p>
                <p>Companies</p>
                <p>Documents via project records</p>
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
