import { Activity, Bookmark, Clock, Radar } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { PageTitle } from "@/components/layout/page-title";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { ProjectTable } from "@/components/projects/project-table";
import { getDashboardStats, getProjects, getSources } from "@/lib/data";
import { shortDate } from "@/lib/utils";

export default async function Dashboard() {
  const [stats, recentProjects, sourceRows] = await Promise.all([
    getDashboardStats(),
    getProjects(),
    getSources(),
  ]);
  const savedSearches = ["Roseville subdivisions", "Fence opportunities", "Warehouse developments"];
  const metrics = [
    { label: "Saved Opportunity Searches", value: savedSearches.length, icon: Radar },
    { label: "Tracked Opportunities", value: recentProjects.slice(0, 24).length, icon: Bookmark },
    { label: "New Source Activity", value: 18, icon: Clock },
    { label: "Active Intelligence Sources", value: stats.activeSources, icon: Activity },
  ];

  return (
    <AppShell>
      <PageTitle title="Opportunity Workspace" eyebrow="Saved leads, watches, and source health" />
      <div className="grid gap-4 md:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500">{metric.label}</p>
                <p className="mt-2 text-3xl font-semibold">{metric.value}</p>
              </div>
              <metric.icon className="size-5 text-zinc-500" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[.75fr_1.25fr]">
        <Card>
          <CardHeader><h2 className="font-semibold">Saved Opportunity Searches</h2></CardHeader>
          <CardContent className="space-y-3">
            {savedSearches.map((search) => (
              <Link key={search} href={`/search?q=${encodeURIComponent(search)}`} className="block rounded-md border border-zinc-100 p-3 text-sm font-medium hover:bg-zinc-50">
                {search}
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h2 className="font-semibold">Tracked Opportunity Records</h2></CardHeader>
          <ProjectTable rows={recentProjects.slice(0, 6)} />
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader><h2 className="font-semibold">Source Coverage Health</h2></CardHeader>
        <Table>
          <thead><tr><Th>Source</Th><Th>Type</Th><Th>Status</Th><Th>Last Sync</Th><Th>Records</Th></tr></thead>
          <tbody>
            {sourceRows.map((source) => (
              <tr key={source.id}>
                <Td className="font-medium text-zinc-950">{source.name}</Td>
                <Td>{source.source_type}</Td>
                <Td><Badge className={source.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{source.active ? "Active" : "Paused"}</Badge></Td>
                <Td>{shortDate(source.last_sync)}</Td>
                <Td>{source.records_collected}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </AppShell>
  );
}
