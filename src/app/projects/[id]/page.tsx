import { ExternalLink, Mail, Phone, Building2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type React from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ProjectMap } from "@/components/map/project-map";
import { PermitExplorer } from "@/components/projects/permit-explorer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { getProject } from "@/lib/data";
import { formatHumanContact, getOpportunityHumanContactForProject, type HumanContact } from "@/lib/human-contact-discovery";
import { contactRoleLabels, getPrimaryContact, getProjectSize, scoreOpportunity, statusStages } from "@/lib/intelligence";
import { generateOpportunities } from "@/lib/opportunities";
import { resolveCanonicalProject } from "@/lib/project-resolution";
import { cn, money, shortDate } from "@/lib/utils";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const size = getProjectSize(project);
  const primaryContact = getPrimaryContact(project);
  const developer = project.companies.find((company) => company.role === "developer");
  const builder = project.companies.find((company) => company.role === "builder");
  const opportunity = scoreOpportunity(project);
  const resolved = resolveCanonicalProject(project);
  const generatedOpportunities = generateOpportunities(project);
  const primaryGeneratedOpportunity = generatedOpportunities[0];
  const humanContactRoute = getOpportunityHumanContactForProject(project.id, project.name);
  const bestHumanContact = humanContactRoute?.best_contact ?? null;
  const currentStageIndex = statusStages.indexOf(project.status);

  return (
    <AppShell>
      <header className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm lg:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{project.project_type}</Badge>
              <Badge>{project.city}</Badge>
              <Badge>{project.county}</Badge>
            </div>
            <h1 className="max-w-5xl text-2xl font-semibold tracking-tight text-zinc-950 lg:text-4xl">{project.name}</h1>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-7">
              <HeaderFact label="Opportunity Score" value={String(opportunity.score)} strong />
              <HeaderFact label="Project Stage" value={project.status} />
              <HeaderFact label="Timeline" value={opportunity.timeline} />
              <HeaderFact label="Size / Value" value={`${size} / ${money(project.estimated_value)}`} />
              <HeaderFact label="Location" value={`${project.city}, ${project.county}`} />
              <HeaderFact label="Primary Contact" value={primaryContact?.name ?? "No contact information available"} />
              <HeaderFact label="Developer / Builder" value={`${developer?.name ?? "No developer"} / ${builder?.name ?? "No builder"}`} />
            </div>
          </div>
          <div className="min-w-56 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Current Stage</p>
            <p className="mt-1 text-lg font-semibold text-zinc-950">{project.status}</p>
            <p className="mt-1 text-sm text-zinc-500">Updated {shortDate(project.updated_at)}</p>
          </div>
        </div>
      </header>

      <Card className={cn("mb-5", resolved.eligibility.contractor_visible ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className={cn("text-sm font-semibold", resolved.eligibility.contractor_visible ? "text-emerald-800" : "text-amber-800")}>
                {resolved.eligibility.contractor_visible ? "Contractor-facing opportunity" : "Internal research record"}
              </p>
              <p className="mt-1 text-sm text-zinc-700">
                {resolved.eligibility.contractor_visible
                  ? resolved.eligibility.reasons.join(" · ")
                  : `Not shown in contractor-facing search because: ${resolved.eligibility.missing.join(", ")}.`}
              </p>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-3 md:min-w-[28rem]">
              <HeaderFact label="Fast Money Score" value={String(resolved.fast_money_score)} strong={resolved.fast_money_score >= 80} />
              <HeaderFact label="Contact Confidence" value={`${Math.round(resolved.contact_confidence * 100)}%`} />
              <HeaderFact label="Resolution Confidence" value={`${Math.round(resolved.resolution_confidence * 100)}%`} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-5">
          <Card className="border-sky-200 bg-sky-50">
            <CardHeader>
              <h2 className="text-base font-semibold">Best Available Contact</h2>
              <p className="mt-1 text-sm text-sky-900">Highest-ranked source-backed route for reaching a human before falling back to procurement access.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {bestHumanContact ? (
                <>
                  <div className="grid gap-3 md:grid-cols-4">
                    <HeaderFact label="Contact" value={formatHumanContact(bestHumanContact)} strong />
                    <HeaderFact label="Company" value={bestHumanContact.company} />
                    <HeaderFact label="Contact Type" value={humanizeContactType(bestHumanContact.contactType)} />
                    <HeaderFact label="Confidence" value={`${Math.round(bestHumanContact.confidence * 100)}%`} strong={bestHumanContact.confidence >= 0.8} />
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {bestHumanContact.phone ? <span className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 font-medium text-sky-950"><Phone className="size-4" /> {bestHumanContact.phone}</span> : null}
                    {bestHumanContact.email ? <span className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 font-medium text-sky-950"><Mail className="size-4" /> {bestHumanContact.email}</span> : null}
                    {bestHumanContact.source.startsWith("http") ? (
                      <a href={bestHumanContact.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 font-medium text-sky-950 underline">
                        <ExternalLink className="size-4" />
                        Source
                      </a>
                    ) : null}
                  </div>
                  <p className="text-sm leading-6 text-sky-950">{humanContactRoute?.recommended_next_step}</p>
                  {bestHumanContact.evidence.length ? <p className="text-sm text-sky-900">Evidence: {bestHumanContact.evidence[0]}</p> : null}
                </>
              ) : (
                <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
                  <HeaderFact label="Contact" value="Unknown" />
                  <p className="text-sm leading-6 text-sky-900">
                    No source-backed human contact is available yet. Use the known access route or continue research before direct outreach.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold">Opportunity Analysis</h2>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[14rem_1fr]">
              <div className="rounded-lg border border-zinc-950 bg-zinc-950 p-5 text-white">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-300">Opportunity Score</p>
                <p className="mt-2 text-5xl font-semibold">{opportunity.score}</p>
                <p className="mt-2 text-sm text-zinc-300">Estimated timeline: {opportunity.timeline}</p>
                <p className="mt-1 text-sm text-zinc-300">Fast Money score: {resolved.fast_money_score}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reasoning</p>
                  <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                    {opportunity.reasons.map((reason) => <li key={reason}>+ {reason}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Estimated Contractor Categories</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {resolved.trades.map((category) => <Badge key={category}>{category}</Badge>)}
                  </div>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">Evidence</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {resolved.evidence.slice(0, 4).map((item) => (
                      <Link key={item.id} href={item.source_url ?? `#${item.id}`} className="text-sm font-medium underline">{item.title}</Link>
                    ))}
                  </div>
                  {opportunity.risks.length ? (
                    <>
                      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">Caveats</p>
                      <ul className="mt-2 space-y-1 text-sm text-zinc-600">{opportunity.risks.map((risk) => <li key={risk}>- {risk}</li>)}</ul>
                    </>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          {primaryGeneratedOpportunity ? (
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold">Generated Opportunity</h2>
                <p className="mt-1 text-sm text-zinc-500">Generated from collected signals and supporting evidence.</p>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-5">
                  <HeaderFact label="Trade" value={primaryGeneratedOpportunity.trade} />
                  <HeaderFact label="Horizon" value={primaryGeneratedOpportunity.horizon} />
                  <HeaderFact label="Score" value={String(primaryGeneratedOpportunity.score)} strong />
                  <HeaderFact label="Estimated Opportunity Value" value={primaryGeneratedOpportunity.estimated_value_label ?? formatRevenueWindow(primaryGeneratedOpportunity.estimated_revenue_low, primaryGeneratedOpportunity.estimated_revenue_high)} />
                  <HeaderFact label="Payment Potential" value={formatPaymentWindow(primaryGeneratedOpportunity.estimated_completion_months)} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Revenue Reasoning</p>
                      <span className="text-xs font-medium text-zinc-500">Confidence {Math.round((primaryGeneratedOpportunity.revenue_estimate?.confidence ?? 0) * 100)}%</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-zinc-950">{formatRevenueWindow(primaryGeneratedOpportunity.revenue_estimate?.low, primaryGeneratedOpportunity.revenue_estimate?.high)}</p>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                      {primaryGeneratedOpportunity.revenue_estimate?.reasoning.map((reason) => <li key={reason}>+ {reason}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Why This Trade</p>
                    {primaryGeneratedOpportunity.trade_evidence?.length ? (
                      <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                        {primaryGeneratedOpportunity.trade_evidence.map((item) => (
                          <li key={`${item.evidence_id}-${item.reason}`}>+ {item.reason} <span className="text-xs text-zinc-500">({Math.round(item.confidence * 100)}%)</span></li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-zinc-500">No strong source-supported trade evidence was found.</p>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Transparent Score Explanation</p>
                  <div className="mt-2 space-y-2">
                    {primaryGeneratedOpportunity.score_explanations.map((item) => (
                      <div key={`${item.factor}-${item.points}`} className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-zinc-950">{item.factor}</p>
                          <Badge className={item.points >= 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{item.points > 0 ? "+" : ""}{item.points}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-zinc-600">{item.reason}</p>
                        <p className="mt-1 text-xs text-zinc-500">Evidence: {item.evidence_ids.join(", ") || "No evidence id attached"}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Who To Contact</p>
                    {resolved.contacts.length ? (
                      <div className="mt-2 overflow-x-auto rounded-md border border-zinc-100">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                            <tr><th className="p-2">Company</th><th className="p-2">Contact</th><th className="p-2">Phone</th><th className="p-2">Email</th><th className="p-2">Website</th><th className="p-2">Role</th><th className="p-2">Confidence</th><th className="p-2">Source</th></tr>
                          </thead>
                          <tbody>
                            {resolved.contacts.map((contact) => (
                              <tr key={`${contact.company}-${contact.role}-${contact.source}`} className="border-t border-zinc-100">
                                <td className="p-2 font-medium text-zinc-950">{contact.company}</td>
                                <td className="p-2">{contact.name ?? "Not listed"}</td>
                                <td className="p-2">{contact.phone ?? "Not listed"}</td>
                                <td className="p-2">{contact.email ?? "Not listed"}</td>
                                <td className="p-2">{contact.website ? <a href={contact.website} className="underline" target="_blank" rel="noreferrer">Open</a> : "Not listed"}</td>
                                <td className="p-2">{contact.role}</td>
                                <td className="p-2">{Math.round(contact.confidence * 100)}%</td>
                                <td className="p-2">{contact.source}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-zinc-500">No source-supported contact information was found.</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Next Action</p>
                    <p className="mt-2 text-sm text-zinc-700">{primaryGeneratedOpportunity.nextAction ?? primaryGeneratedOpportunity.recommended_action}</p>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                      {primaryGeneratedOpportunity.recommendation_explanations?.map((line) => <li key={line}>+ {line}</li>)}
                    </ul>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Confidence Breakdown</p>
                    <span className="text-xs font-medium text-zinc-500">Resolution confidence {Math.round((primaryGeneratedOpportunity.resolutionConfidence ?? 0) * 100)}%</span>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {primaryGeneratedOpportunity.confidenceBreakdown?.map((item) => (
                      <div key={item.factor} className="rounded-md border border-zinc-100 bg-zinc-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-zinc-950">{item.factor}</p>
                          <span className="text-sm font-semibold text-zinc-700">{Math.round(item.confidence * 100)}%</span>
                        </div>
                        <p className="mt-1 text-sm text-zinc-600">{item.explanation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-zinc-950">
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="size-5 text-zinc-700" />
                  <h2 className="text-lg font-semibold">Contacts</h2>
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-zinc-950">Primary Contact: </span>
                  <span className="text-zinc-700">{primaryContact?.name ?? "No contact information available"}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {contactRoleLabels.map(({ role, label }) => {
                const contacts = project.companies.filter((company) => company.role === role);
                return (
                  <div key={role} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
                    {contacts.length ? contacts.map((company) => (
                      <div key={`${company.id}-${role}`} className="mt-3">
                        <p className="text-base font-semibold text-zinc-950">{company.name}</p>
                        <p className="mt-1 text-sm text-zinc-500">{company.company_type} - {label}</p>
                        <div className="mt-3 space-y-2 text-sm">
                          <ContactLine icon={<Phone className="size-4" />} value={company.phone} />
                          <ContactLine icon={<Mail className="size-4" />} value={company.email} />
                          {company.website ? (
                            <a href={company.website} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-zinc-700 underline">
                              <ExternalLink className="size-4" />
                              Website
                            </a>
                          ) : <ContactLine icon={<ExternalLink className="size-4" />} value={null} />}
                        </div>
                      </div>
                    )) : (
                      <p className="mt-3 text-sm text-zinc-500">No contact information available</p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <h2 id="signals" className="text-base font-semibold">Signals</h2>
          <p className="mt-1 text-sm text-zinc-500">Opportunity indicators detected before, during, and after permits.</p>
        </CardHeader>
        <Table>
          <thead>
            <tr><Th>Signal</Th><Th>Date</Th><Th>Importance</Th><Th>Description</Th><Th>Source</Th></tr>
          </thead>
          <tbody>
            {project.signals.map((signal) => (
              <tr key={signal.id}>
                <Td className="font-medium text-zinc-950">{signal.signal_type}</Td>
                <Td>{shortDate(signal.signal_date)}</Td>
                <Td>{signal.importance_score}</Td>
                <Td>{signal.description}</Td>
                <Td>{signal.source}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-base font-semibold">Permits</h2>
          <p className="mt-1 text-sm text-zinc-500">Supporting records, searchable and sortable.</p>
        </CardHeader>
        <PermitExplorer permits={project.permits} />
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-base font-semibold">Documents</h2>
        </CardHeader>
        <Table>
          <thead>
            <tr><Th>Title</Th><Th>Type</Th><Th>Date</Th><Th>Source</Th></tr>
          </thead>
          <tbody>
            {project.documents.map((doc) => (
              <tr key={doc.id}>
                <Td className="font-medium text-zinc-950">{doc.title}</Td>
                <Td>{doc.document_type}</Td>
                <Td>{shortDate(doc.created_at)}</Td>
                <Td><Link href={doc.source_url} className="underline">Open source</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-base font-semibold">Timeline</h2>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {statusStages.map((stage, index) => {
              const complete = index < currentStageIndex;
              const current = index === currentStageIndex;
              return (
                <li key={stage} className="flex items-center gap-3">
                  <span className={cn("size-3 rounded-full border", complete || current ? "border-zinc-950 bg-zinc-950" : "border-zinc-300 bg-white")} />
                  <span className={cn("text-sm", current ? "font-semibold text-zinc-950" : complete ? "text-zinc-700" : "text-zinc-400")}>{stage}</span>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-base font-semibold">Evidence Panel</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {resolved.evidence.map((evidence) => (
            <div key={evidence.id} className="rounded-md border border-zinc-100 p-3 text-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-zinc-950">{evidence.title}</p>
                  <p className="mt-1 text-zinc-600">{evidence.summary}</p>
                  <p className="mt-2 text-xs text-zinc-500">{evidence.record_type} - {evidence.source_name} - confidence {Math.round(evidence.confidence * 100)}%</p>
                </div>
                {evidence.source_url ? (
                  <a href={evidence.source_url} className="inline-flex shrink-0 items-center gap-2 font-medium text-zinc-950 underline" target="_blank" rel="noreferrer">
                    Open source
                    <ExternalLink className="size-4" />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold">Map</h2>
        <ProjectMap projects={[project]} />
      </section>
    </AppShell>
  );
}

function HeaderFact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3", strong && "border-zinc-950 bg-zinc-950 text-white")}>
      <p className={cn("text-[11px] font-semibold uppercase tracking-wide text-zinc-500", strong && "text-zinc-300")}>{label}</p>
      <p className="mt-1 truncate font-semibold" title={value}>{value}</p>
    </div>
  );
}

function humanizeContactType(value: HumanContact["contactType"]) {
  return value.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ContactLine({ icon, value }: { icon: React.ReactNode; value: string | null }) {
  if (!value) return <p className="flex items-center gap-2 text-zinc-500">{icon}No contact information available</p>;
  return <p className="flex items-center gap-2 text-zinc-700">{icon}{value}</p>;
}

function formatRevenueWindow(low?: number | null, high?: number | null) {
  if (!low && !high) return "Not estimated";
  return `${money(low ?? 0)} - ${money(high ?? low ?? 0)}`;
}

function formatPaymentWindow(completion?: number | null) {
  if (completion === null || completion === undefined) return "Unknown";
  if (completion <= 6) return "3-6 months";
  if (completion <= 12) return "6-12 months";
  return "12+ months";
}
