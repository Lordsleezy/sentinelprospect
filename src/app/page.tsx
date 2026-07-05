import Link from "next/link";
import { ArrowRight, Building2, Clock3, Database, MapPin, SearchCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getOpportunities } from "@/lib/data";
import type { Opportunity } from "@/lib/types";
import { money } from "@/lib/utils";

const suggestedSearches = [
  "Fence opportunities Sacramento six months",
  "Projects starting within 90 days",
  "Roseville subdivisions needing site work",
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

const sourceTypes = [
  "County permits",
  "Planning records",
  "Public bids",
  "SAM.gov",
  "GIS and parcels",
  "Developer activity",
];

const popularSearchCards = [
  { icon: Clock3, text: "Jobs that can start, finish, and pay within six months" },
  { icon: MapPin, text: "Sacramento projects ready for fencing bids" },
  { icon: Building2, text: "Developers active before the GC is obvious" },
];

export default async function Home() {
  const opportunities = await getOpportunities();
  const recent = [...opportunities].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
  const fastMoney = opportunities.filter((opportunity) => opportunity.horizon === "Fast Money").slice(0, 4);
  const pipeline = opportunities.filter((opportunity) => opportunity.horizon === "Pipeline").slice(0, 4);
  const earlySignals = opportunities.filter((opportunity) => opportunity.horizon === "Early Signals").slice(0, 4);

  return (
    <AppShell wide>
      <section className="mx-auto grid min-h-[calc(100vh-8rem)] max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            <SearchCheck className="size-4" />
            Construction opportunity search
          </div>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight text-zinc-950 sm:text-6xl">
            Find Construction Opportunities Before Your Competitors
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-600">
            Search permits, planning records, bids, public records, and development activity to discover contractor-ready opportunities.
          </p>
          <form action="/search" className="mt-8 flex w-full max-w-3xl flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-2 shadow-sm sm:flex-row">
            <input
              name="q"
              autoFocus
              placeholder="Search by trade, location, developer, project type, or timeline..."
              className="h-14 flex-1 rounded-md border-0 bg-white px-4 text-base outline-none placeholder:text-zinc-400"
            />
            <Button className="h-14 gap-2 px-6 text-base">
              Find Opportunities
              <ArrowRight className="size-4" />
            </Button>
          </form>
          <div className="mt-5 space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
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
          <div className="mt-6 flex flex-wrap gap-2">
            {suggestedSearches.map((search) => (
              <Link key={search} href={`/search?q=${encodeURIComponent(search)}`} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:border-zinc-400 hover:text-zinc-950">
                {search}
              </Link>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Database className="size-5 text-zinc-500" />
              <h2 className="font-semibold">Sources Become Signals</h2>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {sourceTypes.map((source) => (
                <div key={source} className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-700">
                  {source}
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Popular Searches</h2>
            <div className="mt-4 space-y-3">
              {popularSearchCards.map((item) => (
                <Link key={item.text} href={`/search?q=${encodeURIComponent(item.text)}`} className="flex items-center gap-3 rounded-md border border-zinc-100 p-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                  <item.icon className="size-4 text-zinc-500" />
                  {item.text}
                </Link>
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-zinc-950 bg-zinc-950 p-5 text-white shadow-sm">
            <p className="text-sm font-semibold text-zinc-300">Opportunity results</p>
            <p className="mt-2 text-2xl font-semibold">Ranked leads with why, timing, source evidence, and next action.</p>
          </section>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-12">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Opportunity Feed</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">New construction opportunities</h2>
          </div>
          <Link href="/search" className="text-sm font-medium underline">Open search</Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <FeedBlock title="Recent Opportunities" opportunities={recent} />
          <FeedBlock title="Fast Money Opportunities" opportunities={fastMoney} />
          <FeedBlock title="Pipeline Opportunities" opportunities={pipeline} />
          <FeedBlock title="Early Signals" opportunities={earlySignals} />
        </div>
      </section>
    </AppShell>
  );
}

function FeedBlock({ title, opportunities }: { title: string; opportunities: Opportunity[] }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-zinc-950">{title}</h3>
      <div className="mt-3 space-y-3">
        {opportunities.length ? opportunities.map((opportunity) => (
          <Link key={opportunity.id} href={opportunity.project_id ? `/projects/${opportunity.project_id}` : `/search?q=${encodeURIComponent(opportunity.title)}`} className="block rounded-md border border-zinc-100 p-3 hover:bg-zinc-50">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-zinc-950 bg-zinc-950 text-white">{opportunity.score}</Badge>
              <Badge>{opportunity.horizon}</Badge>
              <Badge>{opportunity.trade}</Badge>
              <span className="text-xs font-medium text-zinc-500">{opportunity.evidence.length} evidence records</span>
            </div>
            <p className="mt-2 font-semibold text-zinc-950">{opportunity.title}</p>
            <p className="mt-1 text-sm text-zinc-600">{opportunity.nextAction ?? opportunity.recommended_action}</p>
            <p className="mt-1 text-xs font-medium text-zinc-500">Estimated value: {opportunity.estimated_value_label ?? formatRevenue(opportunity.estimated_revenue_low, opportunity.estimated_revenue_high)}</p>
          </Link>
        )) : (
          <p className="text-sm text-zinc-500">No collected opportunities in this horizon yet.</p>
        )}
      </div>
    </section>
  );
}

function formatRevenue(low?: number | null, high?: number | null) {
  if (!low && !high) return "Not estimated";
  return `${money(low ?? 0)} - ${money(high ?? low ?? 0)}`;
}
