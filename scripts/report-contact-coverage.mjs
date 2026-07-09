import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const contacts = (await readJson("data/opportunity_contacts.json")) ?? [];
const actions = (await readJson("data/contractor_action_opportunities.json")) ?? [];
const enrich = (await readJson("data/company_contact_enrichment.json")) ?? [];
const profiles = (await readJson("data/company_profiles.json")) ?? [];
const scope = (await readJson("data/scope_intelligence.json")) ?? [];
const human = (await readJson("data/company_human_contacts.json")) ?? [];

const total = contacts.length;
const withBest = contacts.filter((row) => row.best_contact);
const withPhone = contacts.filter((row) => row.best_contact?.phone);
const withEmail = contacts.filter((row) => row.best_contact?.email);
const namedLead = contacts.filter((row) => row.contact_coverage === "Named Company Lead");
const companyOffice = contacts.filter((row) => row.contact_coverage === "Company Office Contact");
const knownHuman = contacts.filter((row) => row.contact_coverage === "Known Human Contact");
const unknown = contacts.filter((row) => row.contact_coverage === "Unknown" || !row.contact_coverage);
const accessOnly = contacts.filter((row) => row.contact_coverage === "Access Route Only");

const bidableIds = new Set(scope.filter((row) => row.fencing_bidable).map((row) => row.opportunity_id));
const fencingContacts = contacts.filter((row) => bidableIds.has(row.opportunity_id));
const fencingPhone = fencingContacts.filter((row) => row.best_contact?.phone);
const fencingEmail = fencingContacts.filter((row) => row.best_contact?.email);
const fencingNamed = fencingContacts.filter((row) => row.best_contact && !row.best_contact.phone && !row.best_contact.email);

const report = {
  generated_at: new Date().toISOString(),
  baseline_label: "2026-07-09 contact enrichment baseline (CSLB BusinessPhone)",
  overall: {
    opportunities_total: total,
    with_best_contact: withBest.length,
    with_phone: withPhone.length,
    with_email: withEmail.length,
    named_company_lead_only: namedLead.length,
    company_office_contact: companyOffice.length,
    known_human_contact: knownHuman.length,
    access_route_only: accessOnly.length,
    unknown: unknown.length,
    pct_with_best_contact: pct(withBest.length, total),
    pct_with_phone: pct(withPhone.length, total),
    pct_with_email: pct(withEmail.length, total),
  },
  fencing_bidable: {
    opportunities_total: fencingContacts.length,
    with_phone: fencingPhone.length,
    with_email: fencingEmail.length,
    named_lead_no_phone: fencingNamed.length,
    no_contact: fencingContacts.filter((row) => !row.best_contact).length,
    pct_with_phone: pct(fencingPhone.length, fencingContacts.length),
    pct_with_email: pct(fencingEmail.length, fencingContacts.length),
  },
  companies: {
    profiles_total: profiles.length,
    profiles_with_phone: profiles.filter((row) => row.phone).length,
    enrichment_rows: enrich.length,
    enrichment_with_phone: enrich.filter((row) => row.phone).length,
    enrichment_with_email: enrich.filter((row) => row.email).length,
    human_contact_profiles: human.length,
    human_with_best: human.filter((row) => row.best_contact).length,
  },
  action_layer: {
    opportunities_total: actions.length,
    phone_backed: actions.filter((row) => row.best_contact?.phone).length,
    email_backed: actions.filter((row) => row.best_contact?.email).length,
  },
  fencing_detail: fencingContacts
    .map((row) => ({
      opportunity_id: row.opportunity_id,
      project_name: row.project_name,
      coverage: row.contact_coverage,
      company: row.best_contact?.company ?? null,
      phone: row.best_contact?.phone ?? null,
      email: row.best_contact?.email ?? null,
    }))
    .sort((a, b) => a.project_name.localeCompare(b.project_name)),
};

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await writeJson("data/contact_coverage_baseline.json", report);
await writeFile(resolve("reports/contact-coverage-baseline.md"), renderMarkdown(report));

console.log(`Contact coverage baseline written.`);
console.log(`Overall phone coverage: ${report.overall.with_phone}/${report.overall.opportunities_total} (${report.overall.pct_with_phone}%).`);
console.log(`Bidable fencing phone coverage: ${report.fencing_bidable.with_phone}/${report.fencing_bidable.opportunities_total} (${report.fencing_bidable.pct_with_phone}%).`);

function pct(count, denominator) {
  if (!denominator) return 0;
  return Math.round((1000 * count) / denominator) / 10;
}

function renderMarkdown(data) {
  const o = data.overall;
  const f = data.fencing_bidable;
  return [
    "# Contact Coverage Baseline",
    "",
    `Generated: ${data.generated_at}`,
    "",
    `**Baseline label:** ${data.baseline_label}`,
    "",
    "Use this report to measure future contact enrichment improvements.",
    "",
    "## Overall opportunity coverage",
    "",
    "| Metric | Count | % |",
    "| --- | ---: | ---: |",
    `| Opportunities total | ${o.opportunities_total} | 100 |`,
    `| With best contact | ${o.with_best_contact} | ${o.pct_with_best_contact} |`,
    `| With phone | ${o.with_phone} | ${o.pct_with_phone} |`,
    `| With email | ${o.with_email} | ${o.pct_with_email} |`,
    `| Known human contact | ${o.known_human_contact} | ${pct(o.known_human_contact, o.opportunities_total)} |`,
    `| Company office contact | ${o.company_office_contact} | ${pct(o.company_office_contact, o.opportunities_total)} |`,
    `| Named company lead only | ${o.named_company_lead_only} | ${pct(o.named_company_lead_only, o.opportunities_total)} |`,
    `| Access route only | ${o.access_route_only} | ${pct(o.access_route_only, o.opportunities_total)} |`,
    `| Unknown | ${o.unknown} | ${pct(o.unknown, o.opportunities_total)} |`,
    "",
    "## Bidable fencing opportunities",
    "",
    "| Metric | Count | % |",
    "| --- | ---: | ---: |",
    `| Bidable fencing total | ${f.opportunities_total} | 100 |`,
    `| With phone | ${f.with_phone} | ${f.pct_with_phone} |`,
    `| With email | ${f.with_email} | ${f.pct_with_email} |`,
    `| Named lead, no phone | ${f.named_lead_no_phone} | ${pct(f.named_lead_no_phone, f.opportunities_total)} |`,
    `| No contact | ${f.no_contact} | ${pct(f.no_contact, f.opportunities_total)} |`,
    "",
    "## Company enrichment layer",
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Company profiles | ${data.companies.profiles_total} |`,
    `| Profiles with phone | ${data.companies.profiles_with_phone} |`,
    `| Enrichment rows | ${data.companies.enrichment_rows} |`,
    `| Enrichment with phone | ${data.companies.enrichment_with_phone} |`,
    `| Enrichment with email | ${data.companies.enrichment_with_email} |`,
    `| Human contact profiles with best contact | ${data.companies.human_with_best} / ${data.companies.human_contact_profiles} |`,
    "",
    "## Action layer",
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Action opportunities | ${data.action_layer.opportunities_total} |`,
    `| Phone-backed | ${data.action_layer.phone_backed} |`,
    `| Email-backed | ${data.action_layer.email_backed} |`,
    "",
    "## Bidable fencing detail",
    "",
    "| Project | Coverage | Company | Phone | Email |",
    "| --- | --- | --- | --- | --- |",
    ...data.fencing_detail.map((row) => `| ${escapeCell(row.project_name).slice(0, 60)} | ${row.coverage} | ${row.company ?? "-"} | ${row.phone ?? "-"} | ${row.email ?? "-"} |`),
    "",
    "## How to refresh",
    "",
    "```bash",
    "npm run intelligence:contacts",
    "node scripts/report-contact-coverage.mjs",
    "```",
    "",
    "Compare new `data/contact_coverage_baseline.json` / `reports/contact-coverage-baseline.md` against this commit.",
    "",
  ].join("\n");
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "/");
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(resolve(file), "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await writeFile(resolve(file), `${JSON.stringify(value, null, 2)}\n`);
}
