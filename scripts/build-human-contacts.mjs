import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const companyAccessProfiles = await readJson("data/company_access_profiles.json") ?? [];
const accessOpportunities = await readJson("data/access_opportunity_results.json") ?? [];
const contactResolutionResults = await readJson("data/contact_resolution_results.json") ?? [];
const contactWebSources = await readJson("data/contact_web_sources.json") ?? [];
const companyProfiles = await readJson("data/company_profiles.json") ?? [];
const curatedSources = await readJson("data/company_human_contact_sources.json") ?? [];
const descriptionBusinesses = await readJson("data/description_named_businesses.json") ?? [];
const companyEnrichment = await readJson("data/company_contact_enrichment.json") ?? [];
const capturedAt = new Date().toISOString();

const companyProfilesById = new Map(companyProfiles.map((profile) => [profile.id, profile]));
const contactResolutionByCompany = groupBy(contactResolutionResults, (contact) => normalizeName(contact.company_name));
const contactWebSourceByCompany = new Map(contactWebSources.map((source) => [normalizeName(source.company_name), source]));
const curatedByCompany = new Map(curatedSources.map((source) => [normalizeName(source.company_name), source]));
const enrichmentByCompany = new Map(companyEnrichment.map((row) => [normalizeName(row.company_name), row]));
const descriptionByProject = groupBy(descriptionBusinesses, (row) => normalizeName(row.project_name));
const descriptionByExternalId = groupBy(descriptionBusinesses, (row) => normalizeProjectId(row.opportunity_external_id));

const company_human_contacts = companyAccessProfiles.map(buildCompanyHumanContacts);
const humanContactsByCompanyId = new Map(company_human_contacts.map((row) => [row.company_profile_id, row]));
const opportunity_contacts = accessOpportunities.map(buildOpportunityContacts);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/company_human_contacts.json", company_human_contacts),
  writeJson("data/opportunity_contacts.json", opportunity_contacts),
  writeFile(resolve("reports/human-contact-intelligence.md"), renderHumanContactIntelligence(company_human_contacts, opportunity_contacts)),
  writeFile(resolve("reports/opportunities-with-human-contacts.md"), renderOpportunitiesWithHumanContacts(opportunity_contacts)),
  writeFile(resolve("reports/top-fence-contacts.md"), renderTopFenceContacts(opportunity_contacts)),
]);

console.log(`Company human contact profiles: ${company_human_contacts.length}.`);
console.log(`Opportunity contact rows: ${opportunity_contacts.length}.`);
console.log(`Opportunities with human contact: ${opportunity_contacts.filter((row) => row.best_contact).length}.`);
console.log(`Human contact coverage: ${pct(opportunity_contacts.filter((row) => row.best_contact).length / Math.max(opportunity_contacts.length, 1))}.`);

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

function buildCompanyHumanContacts(accessProfile) {
  const profile = companyProfilesById.get(accessProfile.company_profile_id);
  const contacts = [
    ...contactsFromResolution(accessProfile.company),
    ...contactsFromWebSource(accessProfile.company),
    ...contactsFromProfile(accessProfile, profile),
    ...contactsFromCurated(accessProfile.company),
    ...contactsFromAccess(accessProfile),
  ];
  const deduped = dedupeContacts(contacts).sort(compareContacts);
  return {
    company_profile_id: accessProfile.company_profile_id,
    company: accessProfile.company,
    company_type: accessProfile.company_type,
    best_contact: deduped[0] ?? null,
    contacts: deduped,
    contact_count: deduped.length,
    last_verified: capturedAt,
  };
}

function buildOpportunityContacts(opportunity) {
  const contacts = [];
  for (const company of opportunity.companies ?? []) {
    contacts.push(...(humanContactsByCompanyId.get(company.company_profile_id)?.contacts ?? []));
  }
  const directProjectContacts = contactResolutionResults
    .filter((contact) => sameProject(contact.project_name, opportunity.project_name) || normalizeProjectId(contact.project_external_id) === normalizeProjectId(opportunity.id))
    .flatMap(contactFromResolution);
  contacts.push(...directProjectContacts);
  contacts.push(...contactsFromDescriptionBusinesses(opportunity));
  const deduped = dedupeContacts(contacts).sort(compareContacts);
  const best = deduped[0] ?? null;
  const backupAccessRoute = opportunity.procurement_route !== "Unknown" ? opportunity.procurement_route : opportunity.access_route ?? "Unknown";
  return {
    opportunity_id: opportunity.id,
    project_name: opportunity.project_name,
    opportunity_state: opportunity.opportunity_state,
    developer: opportunity.developer,
    general_contractor: opportunity.general_contractor,
    trade: opportunity.trade,
    fence_probability: opportunity.fence_probability,
    access_score: opportunity.access_score,
    qualification_score: opportunity.qualification_score,
    best_contact: best,
    contacts: deduped,
    contact_count: deduped.length,
    backup_access_route: backupAccessRoute,
    recommended_next_step: nextStep(opportunity, best, backupAccessRoute),
    contact_coverage: contactCoverage(best, backupAccessRoute),
    source_url: opportunity.source_url,
    last_verified: capturedAt,
  };
}

function contactsFromResolution(companyName) {
  return (contactResolutionByCompany.get(normalizeName(companyName)) ?? []).flatMap(contactFromResolution);
}

function contactFromResolution(contact) {
  if (!contact.phone && !contact.email && !contact.contact_name && !contact.resolved_website) return [];
  const hasPerson = Boolean(contact.contact_name);
  const hasDirectPhone = Boolean(contact.contact_name && contact.phone);
  return [{
    name: contact.contact_name ?? undefined,
    title: contact.contact_title ?? contact.project_role ?? undefined,
    company: contact.company_name,
    phone: contact.phone ?? undefined,
    email: contact.email ?? undefined,
    contactType: hasDirectPhone || hasPerson ? "direct" : contact.project_role === "General Contractor" ? "construction" : "corporate",
    confidence: hasDirectPhone ? 0.95 : contact.phone ? 0.85 : contact.email ? 0.7 : Math.max(0.25, contact.confidence ?? 0.55),
    source: contact.source_url,
    evidence: [
      contact.contact_name
        ? `Source-backed contact ${contact.contact_name} listed for ${contact.company_name}.`
        : contact.phone
          ? `Source-backed company phone listed for ${contact.company_name}.`
          : `Source-backed company route listed for ${contact.company_name}.`,
    ],
  }];
}

function contactsFromWebSource(companyName) {
  const source = contactWebSourceByCompany.get(normalizeName(companyName));
  if (!source) return [];
  const contacts = [];
  if (source.contact_name || source.phone || source.email) {
    contacts.push({
      name: source.contact_name ?? undefined,
      title: source.contact_title ?? source.contact_role ?? undefined,
      company: source.company_name,
      phone: source.phone ?? undefined,
      email: source.email ?? undefined,
      contactType: source.contact_name && source.phone ? "direct" : "corporate",
      confidence: source.contact_name && source.phone ? 0.95 : source.phone ? 0.85 : source.email ? 0.7 : 0.55,
      source: source.sources?.[0]?.source_url ?? source.website ?? "Unknown",
      evidence: (source.sources ?? []).map((item) => item.excerpt).filter(Boolean),
    });
  }
  return contacts;
}

function contactsFromProfile(accessProfile, profile) {
  if (!profile?.phone && !profile?.email) return [];
  return [{
    name: undefined,
    title: officeTitle(accessProfile.company_type),
    company: accessProfile.company,
    phone: profile.phone ?? undefined,
    email: profile.email ?? undefined,
    contactType: contactTypeForCompany(accessProfile.company_type),
    confidence: accessProfile.company_type === "General Contractor" ? 0.85 : 0.65,
    source: profile.contact_page_url ?? profile.official_website ?? profile.metadata?.cslb_source_url ?? "Company profile",
    evidence: [
      profile.phone ? `Company profile lists phone ${profile.phone} for ${accessProfile.company}.` : null,
      profile.email ? `Company profile lists email ${profile.email} for ${accessProfile.company}.` : null,
    ].filter(Boolean),
  }];
}

function contactsFromDescriptionBusinesses(opportunity) {
  const rows = [
    ...(descriptionByProject.get(normalizeName(opportunity.project_name)) ?? []),
    ...(descriptionByExternalId.get(normalizeProjectId(opportunity.id)) ?? []),
  ];
  const seen = new Set();
  const contacts = [];
  for (const row of rows) {
    const key = normalizeName(row.business_name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const enriched = enrichmentByCompany.get(key);
    const web = contactWebSourceByCompany.get(key);
    contacts.push({
      name: undefined,
      title: "Named site business",
      company: row.business_name,
      phone: enriched?.phone ?? web?.phone ?? undefined,
      email: enriched?.email ?? web?.email ?? undefined,
      contactType: "corporate",
      confidence: enriched?.phone || web?.phone ? 0.7 : 0.35,
      source: enriched?.cslb_source_url ?? row.source_url ?? "permit_description",
      evidence: [
        row.evidence,
        enriched?.phone ? `CSLB/public enrichment lists phone ${enriched.phone}.` : null,
        enriched?.email ? `Website enrichment lists email ${enriched.email}.` : null,
      ].filter(Boolean),
    });
  }
  return contacts;
}

function contactsFromCurated(companyName) {
  const source = curatedByCompany.get(normalizeName(companyName));
  if (!source) return [];
  return (source.contacts ?? []).map((contact) => ({
    name: contact.name ?? undefined,
    title: contact.title ?? undefined,
    company: source.company_name,
    phone: contact.phone ?? undefined,
    email: contact.email ?? undefined,
    contactType: contact.contact_type,
    confidence: contact.confidence,
    source: contact.source_url,
    evidence: contact.evidence ?? [`${contact.source} provides a source-backed contact route.`],
  }));
}

function contactsFromAccess(accessProfile) {
  const contacts = [];
  if (accessProfile.trade_partner_registration !== "Unknown") {
    contacts.push({
      name: undefined,
      title: "Trade Partner Contact",
      company: accessProfile.company,
      phone: undefined,
      email: undefined,
      contactType: "trade_partner",
      confidence: 0.55,
      source: accessProfile.trade_partner_registration,
      evidence: [`Trade partner route exists for ${accessProfile.company}.`],
    });
  }
  if (accessProfile.vendor_registration !== "Unknown") {
    contacts.push({
      name: undefined,
      title: "Vendor Registration Contact",
      company: accessProfile.company,
      phone: undefined,
      email: undefined,
      contactType: "vendor",
      confidence: 0.55,
      source: accessProfile.vendor_registration,
      evidence: [`Vendor registration route exists for ${accessProfile.company}.`],
    });
  }
  if (!contacts.length && accessProfile.procurement_path !== "Unknown") {
    contacts.push({
      name: undefined,
      title: "Generic Contact Form",
      company: accessProfile.company,
      phone: undefined,
      email: undefined,
      contactType: accessProfile.entry_method === "Trade Partner Registration" ? "trade_partner" : "vendor",
      confidence: 0.25,
      source: accessProfile.procurement_path,
      evidence: [`Generic source-backed access route exists for ${accessProfile.company}.`],
    });
  }
  return contacts;
}

function nextStep(opportunity, contact, backupAccessRoute) {
  if (contact?.phone) {
    const name = contact.name ?? `${contact.company} ${contact.title ?? "office"}`.trim();
    return `Call ${name} at ${contact.phone} about ${opportunity.project_name}; if they are not the right desk, ask for purchasing, estimating, or subcontractor intake.`;
  }
  if (contact?.email) {
    return `Email ${contact.name ?? contact.company} at ${contact.email} about ${opportunity.project_name}; ask who handles subcontractor pricing.`;
  }
  if (contact?.source && contact.source !== "Unknown") {
    return `Use ${contact.company}'s source-backed contact route for ${opportunity.project_name}: ${contact.source}.`;
  }
  if (backupAccessRoute && backupAccessRoute !== "Unknown") {
    return `No human contact is known yet; use the backup access route for ${opportunity.project_name}: ${backupAccessRoute}.`;
  }
  return "No human contact or access route is known yet. Keep as an opportunity and research the awarding company.";
}

function contactCoverage(contact, backupAccessRoute) {
  if (!contact) return backupAccessRoute && backupAccessRoute !== "Unknown" ? "Access Route Only" : "Unknown";
  if (contact.name && (contact.phone || contact.email)) return "Known Human Contact";
  if (contact.phone || contact.email) return "Company Office Contact";
  if (contact.company) return "Named Company Lead";
  return backupAccessRoute && backupAccessRoute !== "Unknown" ? "Access Route Only" : "Unknown";
}

function compareContacts(a, b) {
  return contactRank(b) - contactRank(a) || b.confidence - a.confidence;
}

function contactRank(contact) {
  if (contact.name && contact.phone) return 100;
  if (contact.name && contact.email) return 95;
  if (contact.phone) {
    if (contact.contactType === "construction") return 85;
    if (contact.contactType === "sales") return 75;
    if (contact.contactType === "regional") return 70;
    if (contact.contactType === "corporate") return 65;
    return 60;
  }
  if (contact.email) return 55;
  if (contact.contactType === "trade_partner") return 40;
  if (contact.contactType === "vendor") return 35;
  if (contact.company) return 30;
  return 25;
}

function officeTitle(companyType) {
  if (companyType === "General Contractor") return "Construction Office";
  if (companyType === "Developer") return "Regional Office";
  return "Corporate Office";
}

function contactTypeForCompany(companyType) {
  if (companyType === "General Contractor") return "construction";
  if (companyType === "Developer") return "regional";
  return "corporate";
}

function dedupeContacts(contacts) {
  const seen = new Set();
  return contacts.filter((contact) => {
    const key = normalizeName(`${contact.company}|${contact.name ?? ""}|${contact.phone ?? ""}|${contact.email ?? ""}|${contact.source}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderHumanContactIntelligence(companyRows, opportunityRows) {
  const totalContacts = opportunityRows.reduce((sum, row) => sum + row.contact_count, 0);
  const covered = opportunityRows.filter((row) => row.best_contact);
  return [
    "# Human Contact Intelligence",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Company contact profiles: ${companyRows.length}`,
    `- Opportunities evaluated: ${opportunityRows.length}`,
    `- Opportunities with human contact: ${covered.length}`,
    `- Human contact coverage: ${pct(covered.length / Math.max(opportunityRows.length, 1))}`,
    `- Average contacts per opportunity: ${(totalContacts / Math.max(opportunityRows.length, 1)).toFixed(2)}`,
    "",
    table(companyRows, [
      ["Company", (row) => row.company],
      ["Type", (row) => row.company_type],
      ["Best Contact", (row) => formatContact(row.best_contact)],
      ["Contacts", (row) => row.contact_count],
    ]),
  ].join("\n");
}

function renderOpportunitiesWithHumanContacts(rows) {
  return [
    "# Opportunities With Human Contacts",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows.filter((row) => row.best_contact), opportunityColumns()),
  ].join("\n");
}

function renderTopFenceContacts(rows) {
  const fenceRows = rows
    .filter((row) => row.fence_probability >= 50 || /fenc|gate/i.test(row.trade))
    .sort((a, b) => contactRank(b.best_contact ?? {}) - contactRank(a.best_contact ?? {}) || b.access_score - a.access_score);
  return [
    "# Top Fence Contacts",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(fenceRows, opportunityColumns()),
  ].join("\n");
}

function opportunityColumns() {
  return [
    ["Project", (row) => row.project_name],
    ["State", (row) => row.opportunity_state],
    ["Developer", (row) => row.developer],
    ["GC", (row) => row.general_contractor],
    ["Best Contact", (row) => formatContact(row.best_contact)],
    ["Coverage", (row) => row.contact_coverage],
    ["Backup Route", (row) => row.backup_access_route],
    ["Next Step", (row) => row.recommended_next_step],
  ];
}

function formatContact(contact) {
  if (!contact) return "Unknown";
  const name = contact.name ?? contact.title ?? contact.company;
  const route = contact.phone ?? contact.email ?? contact.source;
  return `${name} | ${contact.company} | ${route} | ${contact.contactType} | ${pct(contact.confidence)}`;
}

function table(rows, columns) {
  if (!rows.length) return "_None._";
  return [
    `| ${columns.map(([name]) => name).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, getter]) => escapeCell(getter(row))).join(" | ")} |`),
  ].join("\n");
}

function groupBy(items, fn) {
  const groups = new Map();
  for (const item of items) {
    const key = fn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function sameProject(a, b) {
  return normalizeName(a) && normalizeName(a) === normalizeName(b);
}

function normalizeProjectId(value) {
  return String(value ?? "").toLowerCase().replace(/^sac-/, "");
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|incorporated|company|co|limited|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeCell(value) {
  return String(value ?? "Unknown").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}
