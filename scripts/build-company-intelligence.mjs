import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const cacheFiles = [
  "data/sacramento-county-permits.json",
  "data/placer-county-records.json",
  "data/samgov-opportunities.json",
];

const caches = (await Promise.all(cacheFiles.map(readJson))).filter(Boolean);
const records = caches.flatMap((cache) => cache.records ?? []);
const webSources = await readJson("data/company_web_sources.json") ?? [];
const webSourceByCompany = new Map(webSources.map((item) => [normalizeName(item.company_name), item]));
const capturedAt = new Date().toISOString();

const discovered = discoverCompanies(records);
const company_profiles = discovered.map((company) => buildProfile(company, webSourceByCompany.get(company.normalized_name), capturedAt));
const company_web_sources = company_profiles.flatMap((profile) => buildWebSources(profile, webSourceByCompany.get(profile.normalized_name), capturedAt));
const company_intelligence = company_profiles.flatMap((profile) => buildIntelligence(profile, company_web_sources));

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/company_profiles.json", company_profiles),
  writeJson("data/company_web_sources_resolved.json", company_web_sources),
  writeJson("data/company_intelligence.json", company_intelligence),
  writeFile(resolve("reports/company-intelligence-coverage.md"), renderReport(company_profiles, company_web_sources, company_intelligence)),
]);

console.log(`Built ${company_profiles.length} company profile(s).`);
console.log(`Actionable company profiles: ${company_profiles.filter(isActionableCompany).length}.`);

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

function discoverCompanies(sourceRecords) {
  const companies = new Map();
  for (const record of sourceRecords) {
    const contactCompany = record.normalized?.contactCompany;
    if (!contactCompany?.name || !isSourceBackedText(contactCompany.name)) continue;
    const key = normalizeName(contactCompany.name);
    const existing = companies.get(key) ?? {
      company_name: contactCompany.name,
      normalized_name: key,
      collector_roles: new Set(),
      project_count: 0,
      source_records: [],
    };
    existing.collector_roles.add(roleFromCompany(contactCompany));
    existing.project_count += 1;
    existing.source_records.push({
      source_name: record.sourceName ?? "Unknown source",
      source_url: record.sourceUrl ?? record.normalized?.evidence?.source_url ?? "",
      project_name: record.normalized?.project?.name ?? "Unknown project",
      role: roleFromCompany(contactCompany),
    });
    companies.set(key, existing);
  }

  return [...companies.values()].map((company) => ({
    ...company,
    collector_roles: [...company.collector_roles],
  })).sort((a, b) => b.project_count - a.project_count || a.company_name.localeCompare(b.company_name));
}

function buildProfile(company, webSource, lastVerified) {
  const officialWebsite = safeUrl(webSource?.official_website);
  const phone = safePhone(webSource?.phone);
  const linkedinCompanyPage = safeUrl(webSource?.linkedin_company_page);
  const contactPageUrl = safeUrl(webSource?.contact_page_url);
  const bidOpportunitiesPageUrl = safeUrl(webSource?.bid_opportunities_page_url);
  const vendorRegistrationPageUrl = safeUrl(webSource?.vendor_registration_page_url);
  const subcontractorRegistrationPageUrl = safeUrl(webSource?.subcontractor_registration_page_url);
  const tradePartnerPortalUrl = safeUrl(webSource?.trade_partner_portal_url);
  const sourceCount = (webSource?.sources?.length ?? 0) + company.source_records.length;

  return {
    id: `company-${company.normalized_name.replace(/\s+/g, "-")}`,
    company_name: company.company_name,
    normalized_name: company.normalized_name,
    company_type: resolveCompanyType(company.collector_roles),
    official_website: officialWebsite,
    phone,
    linkedin_company_page: linkedinCompanyPage,
    contact_page_url: contactPageUrl,
    bid_opportunities_page_url: bidOpportunitiesPageUrl,
    vendor_registration_page_url: vendorRegistrationPageUrl,
    subcontractor_registration_page_url: subcontractorRegistrationPageUrl,
    trade_partner_portal_url: tradePartnerPortalUrl,
    source_count: sourceCount,
    profile_confidence: profileConfidence({
      officialWebsite,
      phone,
      linkedinCompanyPage,
      contactPageUrl,
      bidOpportunitiesPageUrl,
      vendorRegistrationPageUrl,
      subcontractorRegistrationPageUrl,
      tradePartnerPortalUrl,
      sourceCount,
    }),
    last_verified: lastVerified,
    metadata: {
      collector_roles: company.collector_roles,
      collector_project_count: company.project_count,
      collector_source_records: company.source_records.slice(0, 25),
      missing_fields: missingFields({
        officialWebsite,
        phone,
        linkedinCompanyPage,
        contactPageUrl,
        bidOpportunitiesPageUrl,
        vendorRegistrationPageUrl,
        subcontractorRegistrationPageUrl,
        tradePartnerPortalUrl,
      }),
    },
  };
}

function buildWebSources(profile, webSource, capturedAtValue) {
  const rows = [];
  for (const record of profile.metadata.collector_source_records) {
    if (!record.source_url) continue;
    rows.push({
      id: `${profile.id}-collector-${rows.length + 1}`,
      company_profile_id: profile.id,
      source_type: "collector_record",
      source_name: record.source_name,
      source_url: record.source_url,
      field_name: "company_name",
      field_value: profile.company_name,
      excerpt: `${profile.company_name} listed as ${record.role} on ${record.project_name}.`,
      confidence: 0.7,
      captured_at: capturedAtValue,
    });
  }

  for (const source of webSource?.sources ?? []) {
    if (!source.source_url || !source.field_name || !source.field_value || !source.excerpt) continue;
    rows.push({
      id: `${profile.id}-${normalizeName(`${source.source_type}-${source.field_name}-${source.source_url}`).replace(/\s+/g, "-")}`,
      company_profile_id: profile.id,
      source_type: source.source_type,
      source_name: source.source_name ?? "Public web source",
      source_url: source.source_url,
      field_name: source.field_name,
      field_value: source.field_value,
      excerpt: source.excerpt,
      confidence: source.source_type === "official_website" ? 0.9 : 0.78,
      captured_at: capturedAtValue,
    });
  }
  return rows;
}

function buildIntelligence(profile, sources) {
  const profileSources = sources.filter((source) => source.company_profile_id === profile.id);
  const sourceIds = profileSources.map((source) => source.id);
  const rows = [{
    id: `${profile.id}-coverage-summary`,
    company_profile_id: profile.id,
    intelligence_type: "coverage_summary",
    summary: isActionableCompany(profile)
      ? "Actionable company intelligence exists through at least one web, phone, contact, vendor, subcontractor, or trade partner route."
      : "Company is source-backed by collector records, but actionable company web intelligence is incomplete.",
    confidence: profile.profile_confidence,
    evidence_source_ids: sourceIds,
  }, {
    id: `${profile.id}-company-type`,
    company_profile_id: profile.id,
    intelligence_type: "company_type_evidence",
    summary: `Company type resolved as ${profile.company_type} from collector role evidence.`,
    confidence: 0.7,
    evidence_source_ids: sourceIds.filter((id) => id.includes("collector")),
  }, {
    id: `${profile.id}-missing-fields`,
    company_profile_id: profile.id,
    intelligence_type: "missing_fields",
    summary: profile.metadata.missing_fields.length ? `Missing: ${profile.metadata.missing_fields.join(", ")}.` : "No requested company web fields are missing.",
    confidence: 0.8,
    evidence_source_ids: sourceIds,
  }];

  if (profile.official_website || profile.phone || profile.linkedin_company_page || profile.contact_page_url) {
    rows.push({
      id: `${profile.id}-web-presence`,
      company_profile_id: profile.id,
      intelligence_type: "web_presence",
      summary: "Company has source-backed web or phone presence.",
      confidence: profile.profile_confidence,
      evidence_source_ids: sourceIds.filter((id) => !id.includes("collector")),
    });
  }
  if (profile.vendor_registration_page_url || profile.bid_opportunities_page_url) {
    rows.push({
      id: `${profile.id}-vendor-access`,
      company_profile_id: profile.id,
      intelligence_type: "vendor_access",
      summary: "Company has a source-backed vendor or bid opportunities access route.",
      confidence: 0.85,
      evidence_source_ids: sourceIds,
    });
  }
  if (profile.subcontractor_registration_page_url || profile.trade_partner_portal_url) {
    rows.push({
      id: `${profile.id}-subcontractor-access`,
      company_profile_id: profile.id,
      intelligence_type: "subcontractor_access",
      summary: "Company has a source-backed subcontractor or trade partner access route.",
      confidence: 0.85,
      evidence_source_ids: sourceIds,
    });
  }
  return rows;
}

function renderReport(profiles, sources) {
  const actionable = profiles.filter(isActionableCompany);
  const withWebsite = profiles.filter((profile) => profile.official_website);
  const withPhone = profiles.filter((profile) => profile.phone);
  const withContact = profiles.filter((profile) => profile.contact_page_url);
  const withVendor = profiles.filter((profile) => profile.vendor_registration_page_url || profile.bid_opportunities_page_url);
  const withSub = profiles.filter((profile) => profile.subcontractor_registration_page_url || profile.trade_partner_portal_url);

  return [
    "# Company Intelligence Coverage",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Discovered companies: ${profiles.length}`,
    `- Actionable company intelligence profiles: ${actionable.length}`,
    `- Companies with official website: ${withWebsite.length}`,
    `- Companies with phone: ${withPhone.length}`,
    `- Companies with LinkedIn company page: ${profiles.filter((profile) => profile.linkedin_company_page).length}`,
    `- Companies with contact page: ${withContact.length}`,
    `- Companies with bid/vendor registration route: ${withVendor.length}`,
    `- Companies with subcontractor/trade partner route: ${withSub.length}`,
    `- Company web source evidence rows: ${sources.length}`,
    "",
    "## Coverage Detail",
    "",
    table(profiles, [
      ["Company", (row) => row.company_name],
      ["Type", (row) => row.company_type],
      ["Projects", (row) => row.metadata.collector_project_count],
      ["Website", (row) => row.official_website ?? "Unknown"],
      ["Phone", (row) => row.phone ?? "Unknown"],
      ["LinkedIn", (row) => row.linkedin_company_page ?? "Unknown"],
      ["Contact Page", (row) => row.contact_page_url ?? "Unknown"],
      ["Vendor/Bid Page", (row) => row.vendor_registration_page_url ?? row.bid_opportunities_page_url ?? "Unknown"],
      ["Sub/Trade Portal", (row) => row.subcontractor_registration_page_url ?? row.trade_partner_portal_url ?? "Unknown"],
      ["Confidence", (row) => pct(row.profile_confidence)],
      ["Actionable", (row) => isActionableCompany(row) ? "Yes" : "No"],
    ]),
    "",
    "## Gaps",
    "",
    table(profiles.filter((profile) => !isActionableCompany(profile)), [
      ["Company", (row) => row.company_name],
      ["Type", (row) => row.company_type],
      ["Projects", (row) => row.metadata.collector_project_count],
      ["Missing", (row) => row.metadata.missing_fields.join(", ")],
    ]),
  ].join("\n");
}

function roleFromCompany(company) {
  const value = `${company.role ?? ""} ${company.company_type ?? ""}`.toLowerCase();
  if (value.includes("developer") || value.includes("builder")) return "Developer";
  if (value.includes("architect")) return "Architect";
  if (value.includes("engineer")) return "Engineer";
  if (value.includes("owner")) return "Property Owner";
  if (value.includes("contractor")) return "General Contractor";
  return "Unknown";
}

function resolveCompanyType(roles) {
  for (const role of ["Developer", "General Contractor", "Architect", "Engineer", "Property Owner"]) {
    if (roles.includes(role)) return role;
  }
  return "Unknown";
}

function profileConfidence(fields) {
  let score = fields.sourceCount ? 0.35 : 0;
  if (fields.officialWebsite) score += 0.2;
  if (fields.phone) score += 0.18;
  if (fields.linkedinCompanyPage) score += 0.08;
  if (fields.contactPageUrl) score += 0.08;
  if (fields.bidOpportunitiesPageUrl || fields.vendorRegistrationPageUrl) score += 0.08;
  if (fields.subcontractorRegistrationPageUrl || fields.tradePartnerPortalUrl) score += 0.08;
  return Math.min(1, Number(score.toFixed(2)));
}

function missingFields(fields) {
  const entries = [
    ["Official Website", fields.officialWebsite],
    ["Phone", fields.phone],
    ["LinkedIn Company Page", fields.linkedinCompanyPage],
    ["Contact Page", fields.contactPageUrl],
    ["Bid Opportunities Page", fields.bidOpportunitiesPageUrl],
    ["Vendor Registration Page", fields.vendorRegistrationPageUrl],
    ["Subcontractor Registration Page", fields.subcontractorRegistrationPageUrl],
    ["Trade Partner Portal", fields.tradePartnerPortalUrl],
  ];
  return entries.filter(([, value]) => !value).map(([name]) => name);
}

function isActionableCompany(profile) {
  return Boolean(
    profile.official_website ||
    profile.phone ||
    profile.contact_page_url ||
    profile.bid_opportunities_page_url ||
    profile.vendor_registration_page_url ||
    profile.subcontractor_registration_page_url ||
    profile.trade_partner_portal_url
  );
}

function safeUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) && isSourceBackedText(trimmed) ? trimmed : null;
}

function safePhone(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /\d{3}[-.\s)]*\d{3}[-.\s]*\d{4}/.test(trimmed) && !/\b555[-\s]?\d{4}\b/.test(trimmed) ? trimmed : null;
}

function isSourceBackedText(value) {
  if (!value) return false;
  const blob = String(value).toLowerCase();
  return ![
    /example\.(com|gov|org)/i,
    /\b555[-\s]?\d{4}\b/i,
    /\b(to be determined|tbd|unknown|n\/a|none)\b/i,
    /select edit below/i,
    /enter name/i,
    /\b(owner builder|owner-builder)\b/i,
    /\b(contact|developer|project manager)\s+\d+\b/i,
    /\b\w+\s+(construction|development|builders|contractor|developer)\s+\d+\b/i,
  ].some((pattern) => pattern.test(blob));
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|incorporated|company|co|limited|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function table(rows, columns) {
  if (!rows.length) return "_None._";
  return [
    `| ${columns.map(([name]) => name).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, getter]) => escapeCell(getter(row))).join(" | ")} |`),
  ].join("\n");
}

function escapeCell(value) {
  return String(value ?? "Unknown").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}
