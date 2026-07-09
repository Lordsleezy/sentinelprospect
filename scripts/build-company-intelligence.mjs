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
const documentExtractions = await readJson("data/document_extraction_results.json") ?? [];
const webSourceByCompany = new Map(webSources.map((item) => [normalizeName(item.company_name), item]));
const capturedAt = new Date().toISOString();

const discovered = discoverCompanies(records, documentExtractions);
const company_profiles = discovered.map((company) => buildProfile(company, webSourceByCompany.get(company.normalized_name), capturedAt));
const company_web_sources = company_profiles.flatMap((profile) => buildWebSources(profile, webSourceByCompany.get(profile.normalized_name), capturedAt));
const company_procurement_paths = company_profiles.flatMap((profile) => buildProcurementPaths(profile, webSourceByCompany.get(profile.normalized_name), capturedAt));
const company_registration_portals = company_procurement_paths.filter((path) => ["vendor_registration", "subcontractor_registration", "trade_partner"].includes(path.path_type)).map(registrationPortalFromPath);
const company_bid_opportunities = company_procurement_paths.filter((path) => ["bid_portal", "public_procurement", "plan_room"].includes(path.path_type)).map(bidOpportunityFromPath);
const company_intelligence = company_profiles.flatMap((profile) => buildIntelligence(profile, company_web_sources, company_procurement_paths));

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/company_profiles.json", company_profiles),
  writeJson("data/company_web_sources_resolved.json", company_web_sources),
  writeJson("data/company_procurement_paths.json", company_procurement_paths),
  writeJson("data/company_registration_portals.json", company_registration_portals),
  writeJson("data/company_bid_opportunities.json", company_bid_opportunities),
  writeJson("data/company_intelligence.json", company_intelligence),
  writeFile(resolve("reports/company-intelligence-coverage.md"), renderReport(company_profiles, company_web_sources, company_procurement_paths)),
  writeFile(resolve("reports/procurement-path-coverage.md"), renderProcurementReport(company_profiles, company_procurement_paths, company_registration_portals, company_bid_opportunities)),
  writeFile(resolve("reports/company-profiles.md"), renderCompanyProfiles(company_profiles, company_procurement_paths)),
]);

console.log(`Built ${company_profiles.length} company profile(s).`);
console.log(`Actionable company profiles: ${company_profiles.filter(isActionableCompany).length}.`);
console.log(`Procurement paths found: ${company_procurement_paths.length}.`);

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

function discoverCompanies(sourceRecords, extractionDocuments = []) {
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

  for (const document of extractionDocuments) {
    for (const company of document.companies ?? []) {
      if (!company.name || !isSourceBackedText(company.name)) continue;
      const key = normalizeName(company.name);
      const existing = companies.get(key) ?? {
        company_name: canonicalCompanyName(company.name),
        normalized_name: key,
        collector_roles: new Set(),
        project_count: 0,
        source_records: [],
      };
      existing.company_name = canonicalCompanyName(existing.company_name);
      existing.collector_roles.add(roleFromCompany(company));
      existing.project_count += 1;
      existing.source_records.push({
        source_name: document.source_name ?? "Evidence document",
        source_url: document.source_url ?? "",
        project_name: document.project_name ?? "Unknown project",
        role: roleFromCompany(company),
      });
      companies.set(key, existing);
    }
  }

  return [...companies.values()].map((company) => ({
    ...company,
    collector_roles: [...company.collector_roles],
  })).sort((a, b) => b.project_count - a.project_count || a.company_name.localeCompare(b.company_name));
}

function buildProfile(company, webSource, lastVerified) {
  const officialWebsite = safeUrl(webSource?.official_website);
  const phone = safePhone(webSource?.phone);
  const email = safeEmail(webSource?.email);
  const linkedinCompanyPage = safeUrl(webSource?.linkedin_company_page);
  const contactPageUrl = safeUrl(webSource?.contact_page_url);
  const bidOpportunitiesPageUrl = safeUrl(webSource?.bid_opportunities_page_url);
  const vendorRegistrationPageUrl = safeUrl(webSource?.vendor_registration_page_url);
  const subcontractorRegistrationPageUrl = safeUrl(webSource?.subcontractor_registration_page_url);
  const tradePartnerPortalUrl = safeUrl(webSource?.trade_partner_portal_url);
  const planRoomUrl = safeUrl(webSource?.plan_room_url);
  const procurementPortalUrl = safeUrl(webSource?.procurement_portal_url);
  const estimatingDepartment = safeText(webSource?.estimating_department);
  const estimatingDepartmentUrl = safeUrl(webSource?.estimating_department_url);
  const procurementPaths = validProcurementPaths(webSource?.procurement_paths);
  const sourceCount = (webSource?.sources?.length ?? 0) + company.source_records.length;

  return {
    id: `company-${company.normalized_name.replace(/\s+/g, "-")}`,
    company_name: company.company_name,
    normalized_name: company.normalized_name,
    company_type: resolveCompanyType(company.collector_roles, webSource?.company_type),
    official_website: officialWebsite,
    phone,
    email,
    linkedin_company_page: linkedinCompanyPage,
    contact_page_url: contactPageUrl,
    bid_opportunities_page_url: bidOpportunitiesPageUrl,
    vendor_registration_page_url: vendorRegistrationPageUrl,
    subcontractor_registration_page_url: subcontractorRegistrationPageUrl,
    trade_partner_portal_url: tradePartnerPortalUrl,
    plan_room_url: planRoomUrl,
    procurement_portal_url: procurementPortalUrl,
    estimating_department: estimatingDepartment,
    estimating_department_url: estimatingDepartmentUrl,
    source_count: sourceCount,
    profile_confidence: profileConfidence({
      officialWebsite,
      phone,
      email,
      linkedinCompanyPage,
      contactPageUrl,
      bidOpportunitiesPageUrl,
      vendorRegistrationPageUrl,
      subcontractorRegistrationPageUrl,
      tradePartnerPortalUrl,
      planRoomUrl,
      procurementPortalUrl,
      estimatingDepartment,
      estimatingDepartmentUrl,
      procurementPaths,
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
        email,
        linkedinCompanyPage,
        contactPageUrl,
        bidOpportunitiesPageUrl,
        vendorRegistrationPageUrl,
        subcontractorRegistrationPageUrl,
        tradePartnerPortalUrl,
        planRoomUrl,
        procurementPortalUrl,
        estimatingDepartment,
        estimatingDepartmentUrl,
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

function buildProcurementPaths(profile, webSource, capturedAtValue) {
  const explicitPaths = validProcurementPaths(webSource?.procurement_paths);
  const rows = explicitPaths.map((path, index) => ({
    id: `${profile.id}-procurement-${index + 1}-${path.path_type}`,
    company_profile_id: profile.id,
    path_type: path.path_type,
    path_url: path.path_url,
    source_url: path.source_url,
    source_type: path.source_type,
    confidence: path.confidence,
    contractor_value: path.contractor_value,
    last_verified: capturedAtValue,
    evidence_summary: path.evidence_summary,
  }));

  const fallbackPaths = [
    ["vendor_registration", profile.vendor_registration_page_url],
    ["subcontractor_registration", profile.subcontractor_registration_page_url],
    ["trade_partner", profile.trade_partner_portal_url],
    ["bid_portal", profile.bid_opportunities_page_url],
    ["plan_room", profile.plan_room_url],
    ["public_procurement", profile.procurement_portal_url],
    ["estimating_contact", profile.estimating_department_url],
    ["general_contact", profile.contact_page_url],
  ];

  for (const [pathType, pathUrl] of fallbackPaths) {
    if (!pathUrl || rows.some((row) => row.path_type === pathType && row.path_url === pathUrl)) continue;
    rows.push({
      id: `${profile.id}-procurement-${rows.length + 1}-${pathType}`,
      company_profile_id: profile.id,
      path_type: pathType,
      path_url: pathUrl,
      source_url: pathUrl,
      source_type: pathType === "general_contact" ? "contact_page" : pathType,
      confidence: ["vendor_registration", "subcontractor_registration", "trade_partner", "bid_portal", "plan_room", "public_procurement"].includes(pathType) ? 0.72 : 0.58,
      contractor_value: contractorValueForPath(pathType),
      last_verified: capturedAtValue,
      evidence_summary: `${profile.company_name} has a source-backed ${pathType.replace(/_/g, " ")} URL.`,
    });
  }
  return rows;
}

function registrationPortalFromPath(path) {
  return {
    id: `${path.id}-registration`,
    company_profile_id: path.company_profile_id,
    registration_type: path.path_type,
    registration_url: path.path_url,
    source_url: path.source_url,
    confidence: path.confidence,
    last_verified: path.last_verified,
  };
}

function bidOpportunityFromPath(path) {
  return {
    id: `${path.id}-bid`,
    company_profile_id: path.company_profile_id,
    opportunity_type: path.path_type,
    opportunity_url: path.path_url,
    source_url: path.source_url,
    confidence: path.confidence,
    last_verified: path.last_verified,
  };
}

function buildIntelligence(profile, sources, procurementPaths) {
  const profileSources = sources.filter((source) => source.company_profile_id === profile.id);
  const profilePaths = procurementPaths.filter((path) => path.company_profile_id === profile.id);
  const sourceIds = profileSources.map((source) => source.id);
  const rows = [{
    id: `${profile.id}-coverage-summary`,
    company_profile_id: profile.id,
    intelligence_type: "coverage_summary",
    summary: hasProcurementPath(profilePaths)
      ? "Procurement path intelligence exists for this company."
      : isActionableCompany(profile)
      ? "Company has general contact intelligence, but no dedicated procurement path has been verified."
      : "Company is source-backed by collector records, but actionable company web intelligence is incomplete.",
    confidence: hasProcurementPath(profilePaths) ? Math.max(profile.profile_confidence, 0.7) : profile.profile_confidence,
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
  if (profilePaths.some((path) => ["vendor_registration", "trade_partner", "bid_portal", "public_procurement", "plan_room"].includes(path.path_type))) {
    rows.push({
      id: `${profile.id}-vendor-access`,
      company_profile_id: profile.id,
      intelligence_type: "vendor_access",
      summary: "Company has a source-backed vendor, trade partner, bid, procurement, or plan-room route.",
      confidence: 0.85,
      evidence_source_ids: sourceIds,
    });
  }
  if (profilePaths.length) {
    rows.push({
      id: `${profile.id}-procurement-access`,
      company_profile_id: profile.id,
      intelligence_type: "procurement_access",
      summary: `Best procurement path: ${bestProcurementPath(profilePaths)?.path_type.replace(/_/g, " ")}.`,
      confidence: bestProcurementPath(profilePaths)?.confidence ?? profile.profile_confidence,
      evidence_source_ids: sourceIds,
    });
  }
  if (profilePaths.some((path) => ["subcontractor_registration", "trade_partner"].includes(path.path_type))) {
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

function renderReport(profiles, sources, procurementPaths) {
  const actionable = profiles.filter(isActionableCompany);
  const withWebsite = profiles.filter((profile) => profile.official_website);
  const withPhone = profiles.filter((profile) => profile.phone);
  const withContact = profiles.filter((profile) => profile.contact_page_url);
  const withVendor = procurementPaths.filter((path) => ["vendor_registration", "trade_partner", "bid_portal", "public_procurement", "plan_room"].includes(path.path_type));
  const withSub = procurementPaths.filter((path) => ["subcontractor_registration", "trade_partner"].includes(path.path_type));

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
      ["Plan Room", (row) => row.plan_room_url ?? "Unknown"],
      ["Procurement Portal", (row) => row.procurement_portal_url ?? "Unknown"],
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

function renderProcurementReport(profiles, paths, registrations, bids) {
  const pathByProfile = groupBy(paths, (path) => path.company_profile_id);
  const rows = profiles.map((profile) => {
    const profilePaths = pathByProfile.get(profile.id) ?? [];
    const registration = profilePaths.find((path) => ["vendor_registration", "subcontractor_registration", "trade_partner"].includes(path.path_type));
    const bid = profilePaths.find((path) => ["bid_portal", "public_procurement", "plan_room"].includes(path.path_type));
    const bestPath = bestProcurementPath(profilePaths);
    return { profile, profilePaths, registration, bid, bestPath };
  });

  return [
    "# Procurement Path Coverage",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Companies evaluated: ${profiles.length}`,
    `- Companies with any procurement path: ${rows.filter((row) => row.profilePaths.length).length}`,
    `- Registration/trade partner portals: ${registrations.length}`,
    `- Bid opportunity/plan room/public procurement portals: ${bids.length}`,
    `- High-value contractor paths: ${paths.filter((path) => path.contractor_value === "High").length}`,
    `- Medium-value contractor paths: ${paths.filter((path) => path.contractor_value === "Medium").length}`,
    `- Low-value contractor paths: ${paths.filter((path) => path.contractor_value === "Low").length}`,
    "",
    "## Company Procurement Paths",
    "",
    table(rows, [
      ["Company Name", (row) => row.profile.company_name],
      ["Company Type", (row) => row.profile.company_type],
      ["Website", (row) => row.profile.official_website ?? "Unknown"],
      ["Procurement Path Found", (row) => row.profilePaths.length ? "Yes" : "No"],
      ["Best Path Type", (row) => row.bestPath?.path_type ?? "Unknown"],
      ["Registration URL", (row) => row.registration?.path_url ?? "Unknown"],
      ["Bid Portal URL", (row) => row.bid?.path_url ?? "Unknown"],
      ["Confidence", (row) => pct(row.bestPath?.confidence ?? row.profile.profile_confidence)],
      ["Contractor Value", (row) => row.bestPath?.contractor_value ?? "Low"],
    ]),
    "",
    "## Contractor Value Test",
    "",
    table(rows, [
      ["Company", (row) => row.profile.company_name],
      ["Would this help a fencing company get work?", (row) => contractorValueAnswer(row.bestPath)],
      ["Why", (row) => row.bestPath?.evidence_summary ?? "No source-backed procurement, registration, bid, plan-room, or relevant contact path found."],
    ]),
  ].join("\n");
}

function renderCompanyProfiles(profiles, paths) {
  const pathByProfile = groupBy(paths, (path) => path.company_profile_id);
  return [
    "# Company Profiles",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(profiles, [
      ["Company Name", (row) => row.company_name],
      ["Company Type", (row) => row.company_type],
      ["Website", (row) => row.official_website ?? "Unknown"],
      ["Phone", (row) => row.phone ?? "Unknown"],
      ["Contact Page", (row) => row.contact_page_url ?? "Unknown"],
      ["Vendor Registration Page", (row) => row.vendor_registration_page_url ?? "Unknown"],
      ["Subcontractor Registration Page", (row) => row.subcontractor_registration_page_url ?? "Unknown"],
      ["Trade Partner Page", (row) => row.trade_partner_portal_url ?? "Unknown"],
      ["Bid Opportunities Page", (row) => row.bid_opportunities_page_url ?? "Unknown"],
      ["Plan Room", (row) => row.plan_room_url ?? "Unknown"],
      ["Procurement Portal", (row) => row.procurement_portal_url ?? "Unknown"],
      ["Estimating Department", (row) => row.estimating_department ?? row.estimating_department_url ?? "Unknown"],
      ["Procurement Path Found", (row) => (pathByProfile.get(row.id) ?? []).length ? "Yes" : "No"],
      ["Confidence", (row) => pct(row.profile_confidence)],
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

function resolveCompanyType(roles, sourceBackedType) {
  if (["Developer", "General Contractor", "Architect", "Engineer", "Property Owner", "Unknown"].includes(sourceBackedType)) return sourceBackedType;
  for (const role of ["Developer", "General Contractor", "Architect", "Engineer", "Property Owner"]) {
    if (roles.includes(role)) return role;
  }
  return "Unknown";
}

function profileConfidence(fields) {
  let score = fields.sourceCount ? 0.35 : 0;
  if (fields.officialWebsite) score += 0.2;
  if (fields.phone) score += 0.18;
  if (fields.email) score += 0.1;
  if (fields.linkedinCompanyPage) score += 0.08;
  if (fields.contactPageUrl) score += 0.08;
  if (fields.bidOpportunitiesPageUrl || fields.vendorRegistrationPageUrl) score += 0.08;
  if (fields.subcontractorRegistrationPageUrl || fields.tradePartnerPortalUrl) score += 0.08;
  if (fields.planRoomUrl || fields.procurementPortalUrl) score += 0.1;
  if (fields.estimatingDepartment || fields.estimatingDepartmentUrl) score += 0.08;
  if (fields.procurementPaths?.some((path) => path.contractor_value === "High")) score += 0.12;
  else if (fields.procurementPaths?.some((path) => path.contractor_value === "Medium")) score += 0.08;
  else if (fields.procurementPaths?.length) score += 0.04;
  return Math.min(1, Number(score.toFixed(2)));
}

function missingFields(fields) {
  const entries = [
    ["Official Website", fields.officialWebsite],
    ["Phone", fields.phone],
    ["Email", fields.email],
    ["LinkedIn Company Page", fields.linkedinCompanyPage],
    ["Contact Page", fields.contactPageUrl],
    ["Bid Opportunities Page", fields.bidOpportunitiesPageUrl],
    ["Vendor Registration Page", fields.vendorRegistrationPageUrl],
    ["Subcontractor Registration Page", fields.subcontractorRegistrationPageUrl],
    ["Trade Partner Portal", fields.tradePartnerPortalUrl],
    ["Plan Room", fields.planRoomUrl],
    ["Procurement Portal", fields.procurementPortalUrl],
    ["Estimating Department", fields.estimatingDepartment || fields.estimatingDepartmentUrl],
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
    profile.trade_partner_portal_url ||
    profile.plan_room_url ||
    profile.procurement_portal_url ||
    profile.estimating_department ||
    profile.estimating_department_url
  );
}

function hasProcurementPath(paths) {
  return paths.some((path) => path.contractor_value === "High" || path.contractor_value === "Medium");
}

function validProcurementPaths(paths) {
  const allowedTypes = new Set(["vendor_registration", "subcontractor_registration", "trade_partner", "estimating_contact", "bid_portal", "public_procurement", "plan_room", "general_contact"]);
  const allowedValues = new Set(["High", "Medium", "Low"]);
  return (Array.isArray(paths) ? paths : [])
    .filter((path) => allowedTypes.has(path.path_type) && allowedValues.has(path.contractor_value) && safeUrl(path.path_url) && safeUrl(path.source_url))
    .map((path) => ({
      path_type: path.path_type,
      path_url: safeUrl(path.path_url),
      source_url: safeUrl(path.source_url),
      source_type: safeText(path.source_type) ?? path.path_type,
      confidence: Math.max(0, Math.min(1, Number(path.confidence) || 0.5)),
      contractor_value: path.contractor_value,
      evidence_summary: safeText(path.evidence_summary) ?? "Source-backed procurement path.",
    }));
}

function contractorValueForPath(pathType) {
  if (["vendor_registration", "subcontractor_registration", "trade_partner", "bid_portal", "public_procurement", "plan_room"].includes(pathType)) return "High";
  if (pathType === "estimating_contact") return "Medium";
  return "Low";
}

function bestProcurementPath(paths) {
  const valueRank = { High: 3, Medium: 2, Low: 1 };
  return [...paths].sort((a, b) => valueRank[b.contractor_value] - valueRank[a.contractor_value] || b.confidence - a.confidence)[0] ?? null;
}

function contractorValueAnswer(path) {
  if (!path) return "No";
  if (path.contractor_value === "High") return "Yes";
  if (path.contractor_value === "Medium") return "Maybe";
  return "No";
}

function groupBy(items, fn) {
  const groups = new Map();
  for (const item of items) {
    const key = fn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
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

function safeEmail(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  if (/(example\.com|sentry\.|wixpress|cloudflare|schema\.org)/i.test(trimmed)) return null;
  return trimmed;
}

function safeText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && isSourceBackedText(trimmed) ? trimmed : null;
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
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|incorporated|company|co|limited|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (normalized.includes("lennar")) return "lennar homes of california";
  if (normalized.includes("kevin l cook architect")) return "kevin l cook architect";
  if (normalized.includes("lund construction")) return "lund construction";
  if (normalized.includes("taylor morrison")) return "taylor morrison of california";
  if (normalized.includes("integral communities")) return "integral communities";
  return normalized;
}

function canonicalCompanyName(value) {
  const normalized = normalizeName(value);
  if (normalized === "lennar homes of california") return "Lennar Homes of California";
  if (normalized === "kevin l cook architect") return "Kevin L Cook Architect Inc.";
  if (normalized === "lund construction") return "Lund Construction Co";
  if (normalized === "taylor morrison of california") return "Taylor Morrison of California";
  if (normalized === "integral communities") return "Integral Communities";
  return String(value ?? "").trim();
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
