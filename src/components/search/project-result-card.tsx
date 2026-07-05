import { ArrowRight, PhoneCall } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getNextAction, getOpportunityFitLabel, getPrimaryContact, getProjectSize, getSourceCoverage, scoreOpportunity } from "@/lib/intelligence";
import { generateOpportunities } from "@/lib/opportunities";
import type { ProjectDetail } from "@/lib/types";
import { money, shortDate } from "@/lib/utils";

export function ProjectResultCard({ project }: { project: ProjectDetail }) {
  const primaryContact = getPrimaryContact(project);
  const topSignals = project.signals.slice(0, 3);
  const opportunity = scoreOpportunity(project);
  const coverage = getSourceCoverage(project);
  const generatedOpportunity = generateOpportunities(project)[0];

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-sm font-semibold text-emerald-700">{getOpportunityFitLabel(opportunity.score)}</p>
          <Link href={`/projects/${project.id}`} className="text-xl font-semibold text-zinc-950 hover:underline">
            {project.name}
          </Link>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge className="border-zinc-950 bg-zinc-950 text-white">Opportunity Score {opportunity.score}</Badge>
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{opportunity.timingFit}</Badge>
            <Badge>{project.status}</Badge>
            <Badge>{project.project_type}</Badge>
            <Badge>{getProjectSize(project)}</Badge>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Estimated Value" value={money(project.estimated_value)} />
            <Fact label="Location" value={`${project.city}, ${project.county}`} />
            <Fact label="Primary Contact" value={primaryContact?.name ?? "No contact information available"} />
            <Fact label="Inferred Trade" value={generatedOpportunity?.trade ?? "Not inferred"} />
            <Fact label="Estimated Opportunity Value" value={generatedOpportunity?.estimated_value_label ?? formatRevenueWindow(generatedOpportunity?.estimated_revenue_low, generatedOpportunity?.estimated_revenue_high)} />
            <Fact label="Estimated Timeline" value={opportunity.timeline} />
            <Fact label="Source" value={project.source_name} />
            <Fact label="Last Updated" value={shortDate(project.updated_at)} />
            <Fact label="Signals" value={topSignals.map((signal) => signal.signal_type).join(", ") || "No signals"} />
          </dl>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Why this may be work</p>
              <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                {opportunity.reasons.slice(0, 3).map((reason) => <li key={reason}>+ {reason}</li>)}
              </ul>
            </div>
            <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                <PhoneCall className="size-3.5" />
                Next action
              </div>
              <p className="mt-2 text-sm font-medium text-emerald-950">{getNextAction(project)}</p>
            </div>
          </div>
          {generatedOpportunity?.trade_evidence?.length ? (
            <div className="mt-3 rounded-md border border-zinc-100 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Why {generatedOpportunity.trade}</p>
              <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                {generatedOpportunity.trade_evidence.slice(0, 3).map((item) => <li key={`${item.evidence_id}-${item.reason}`}>+ {item.reason}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {coverage.map((item) => (
              <span key={item} className="rounded-md border border-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">
                {item}
              </span>
            ))}
          </div>
        </div>
        <Link href={`/projects/${project.id}`} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
          Open Brief
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 font-medium text-zinc-800">{value}</dd>
    </div>
  );
}

function formatRevenueWindow(low?: number | null, high?: number | null) {
  if (!low && !high) return "Not estimated";
  return `${money(low ?? 0)} - ${money(high ?? low ?? 0)}`;
}
