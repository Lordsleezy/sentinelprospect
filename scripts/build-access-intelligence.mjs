import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const opportunities = await readJson("data/opportunity_qualification_results.json") ?? [];
const dossiers = await readJson("data/qualified_opportunity_dossiers.json") ?? [];
const companyProfiles = await readJson("data/company_profiles.json") ?? [];
const procurementPaths = await readJson("data/company_procurement_paths.json") ?? [];
const topCompanies = await readJson("data/top_20_companies.json") ?? [];
const capturedAt = new Date().toISOString();

const pathsByCompany = groupBy(procurementPaths, (path) => path.company_profile_id);
const dossiersByProject = new Map(dossiers.map((dossier) => [dossier.id, dossier]));

const company_access_profiles = companyProfiles.map(buildCompanyAccessProfile);
const accessProfileByCompany = new Map(company_access_profiles.map((profile) => [profile.company_profile_id, profile]));
const access_opportunity_results = opportunities.map(buildAccessOpportunity).sort((a, b) =>
  b.access_score - a.access_score ||
  b.qualification_score - a.qualification_score ||
  b.opportunity_score - a.opportunity_score ||
  a.project_name.localeCompare(b.project_name)
);
const expandedTopCompanies = expandTopCompanies(topCompanies, company_access_profiles, access_opportunity_results);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/company_access_profiles.json", company_access_profiles),
  writeJson("data/access_opportunity_results.json", access_opportunity_results),
  writeJson("data/top_20_companies.json", expandedTopCompanies),
  writeFile(resolve("reports/access-intelligence.md"), renderAccessIntelligence(access_opportunity_results)),
  writeFile(resolve("reports/company-access-profiles.md"), renderCompanyAccessProfiles(company_access_profiles)),
  writeFile(resolve("reports/contractor-visible-opportunities.md"), renderContractorVisibleAccess(access_opportunity_results)),
  writeFile(resolve("reports/top-20-companies.md"), renderTopCompanies(expandedTopCompanies)),
]);

console.log(`Company access profiles: ${company_access_profiles.length}.`);
console.log(`Access opportunities: ${access_opportunity_results.length}.`);
console.log(`Actionable opportunities: ${access_opportunity_results.filter((row) => row.opportunity_state === "Actionable Opportunity").length}.`);
console.log(`Research required: ${access_opportunity_results.filter((row) => row.opportunity_state === "Research Required").length}.`);

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

function buildCompanyAccessProfile(profile) {
  const paths = pathsByCompany.get(profile.id) ?? [];
  const best = bestPath(paths);
  const registrationPath = paths.find((path) => ["vendor_registration", "subcontractor_registration"].includes(path.path_type));
  const tradePartnerPath = paths.find((path) => path.path_type === "trade_partner");
  const bidPath = paths.find((path) => ["bid_portal", "public_procurement", "plan_room"].includes(path.path_type));
  const accessRoutes = knownAccessRoutes(profile, paths);
  return {
    company_profile_id: profile.id,
    company: profile.company_name,
    company_type: profile.company_type,
    entry_method: entryMethod(profile, best),
    vendor_registration: registrationPath?.path_url ?? "Unknown",
    trade_partner_registration: tradePartnerPath?.path_url ?? "Unknown",
    bid_portal: bidPath?.path_url ?? "Unknown",
    procurement_path: best?.path_url ?? profile.contact_page_url ?? profile.official_website ?? "Unknown",
    approval_required: approvalRequired(profile, best),
    known_access_routes: accessRoutes,
    typical_opportunity: typicalOpportunity(profile),
    confidence: accessConfidence(profile, paths, accessRoutes),
    last_verified: capturedAt,
  };
}

function buildAccessOpportunity(opportunity) {
  const dossier = dossiersByProject.get(opportunity.id);
  const companyAccess = opportunity.companies.map((company) => accessProfileByCompany.get(company.company_profile_id)).filter(Boolean);
  const bestCompanyAccess = bestCompanyAccessProfile(companyAccess);
  const knownRoutes = unique(companyAccess.flatMap((profile) => profile.known_access_routes));
  const accessScore = accessScoreFor(opportunity, companyAccess, dossier);
  const accessState = accessStateFor(opportunity, accessScore, knownRoutes, dossier);
  const procurementRoute = bestCompanyAccess && bestCompanyAccess.procurement_path !== "Unknown" ? bestCompanyAccess.procurement_path : bestProcurementPath(opportunity.procurement_paths)?.path_url ?? "Unknown";
  const nextStep = nextStepFor(opportunity, bestCompanyAccess, dossier);
  return {
    id: opportunity.id,
    project_name: opportunity.project_name,
    project_location: opportunity.location,
    city: locationParts(opportunity.location).city,
    county: locationParts(opportunity.location).county,
    opportunity_state: accessState,
    opportunity_score: opportunity.qualification_score,
    qualification_score: opportunity.qualification_score,
    fence_probability: fenceProbability(opportunity),
    access_score: accessScore,
    developer: opportunity.known_developer,
    general_contractor: opportunity.known_gc,
    architect: companyByType(opportunity, "Architect")?.company_name ?? "Unknown",
    procurement_route: procurementRoute,
    entry_method: bestCompanyAccess?.entry_method ?? "Unknown",
    access_route: knownRoutes[0] ?? procurementRoute,
    recommended_next_step: nextStep,
    known_access_routes: knownRoutes,
    approval_required: bestCompanyAccess?.approval_required ?? false,
    evidence_quality: opportunity.evidence_quality,
    evidence_count: opportunity.evidence_count,
    fencing_signal_presence: opportunity.fencing_signal_presence,
    fast_money_potential: opportunity.fast_money_potential,
    trade: opportunity.trade,
    source_url: opportunity.source_url,
    companies: opportunity.companies,
    procurement_paths: opportunity.procurement_paths,
    contact_route: dossier?.contact_route ?? null,
    last_verified: capturedAt,
  };
}

function accessScoreFor(opportunity, accessProfiles, dossier) {
  let score = 0;
  const paths = opportunity.procurement_paths ?? [];
  if (paths.some((path) => ["vendor_registration", "subcontractor_registration"].includes(path.path_type))) score += 28;
  if (paths.some((path) => path.path_type === "trade_partner")) score += 28;
  if (paths.some((path) => ["bid_portal", "public_procurement", "plan_room"].includes(path.path_type))) score += 28;
  if (paths.some((path) => path.path_type === "general_contact")) score += 14;
  if (accessProfiles.some((profile) => profile.known_access_routes.length)) score += 18;
  if (opportunity.procurement_path_availability === "Available") score += 12;
  if (dossier?.contact_route?.known_phone && dossier.contact_route.known_phone !== "Unknown") score += 10;
  if (dossier?.contact_route?.known_procurement_path && dossier.contact_route.known_procurement_path !== "Unknown") score += 10;
  return Math.min(100, score);
}

function accessStateFor(opportunity, accessScore, knownRoutes, dossier) {
  const hasKnownRoute = knownRoutes.length > 0 || Boolean(dossier?.contact_route?.known_procurement_path && dossier.contact_route.known_procurement_path !== "Unknown");
  if (accessScore >= 70 && hasKnownRoute) return "Actionable Opportunity";
  if (accessScore >= 30 || opportunity.procurement_path_availability === "Available") return "Research Required";
  return "Opportunity";
}

function nextStepFor(opportunity, accessProfile, dossier) {
  if (dossier?.exact_next_step) return dossier.exact_next_step;
  if (accessProfile && accessProfile.trade_partner_registration !== "Unknown") {
    return `Register through ${accessProfile.company}'s trade partner route: ${accessProfile.trade_partner_registration}.`;
  }
  if (accessProfile && accessProfile.vendor_registration !== "Unknown") {
    return `Register as a vendor with ${accessProfile.company}: ${accessProfile.vendor_registration}.`;
  }
  if (accessProfile && accessProfile.bid_portal !== "Unknown") {
    return `Monitor ${accessProfile.company}'s bid portal for ${opportunity.project_name}: ${accessProfile.bid_portal}.`;
  }
  if (accessProfile && accessProfile.procurement_path !== "Unknown") {
    return `Use ${accessProfile.company}'s source-backed access route and ask how contractors enter ${opportunity.project_name}: ${accessProfile.procurement_path}.`;
  }
  if (opportunity.known_gc !== "Unknown") return `Research ${opportunity.known_gc}'s subcontractor intake path before outreach.`;
  if (opportunity.known_developer !== "Unknown") return `Research ${opportunity.known_developer}'s procurement or trade partner workflow before outreach.`;
  return "Keep as an opportunity; find the awarding company or procurement workflow before outreach.";
}

function entryMethod(profile, best) {
  if (best?.path_type === "trade_partner") return "Trade Partner Registration";
  if (["vendor_registration", "subcontractor_registration"].includes(best?.path_type)) return "Vendor Registration";
  if (["bid_portal", "public_procurement", "plan_room"].includes(best?.path_type)) return "Bid Portal";
  if (best?.path_type === "estimating_contact") return "Estimating Department";
  if (best?.path_type === "general_contact" || profile.contact_page_url || profile.official_website) return "General Contact Route";
  if (profile.company_type === "Developer") return "Developer Procurement Research";
  if (profile.company_type === "General Contractor") return "Subcontractor Intake Research";
  return "Unknown";
}

function approvalRequired(profile, best) {
  if (["Developer", "General Contractor"].includes(profile.company_type) && ["trade_partner", "subcontractor_registration", "vendor_registration"].includes(best?.path_type)) return true;
  if (["public_procurement", "bid_portal"].includes(best?.path_type)) return "Often";
  return false;
}

function knownAccessRoutes(profile, paths) {
  const routes = [];
  for (const path of paths) {
    routes.push(`${path.path_type}: ${path.path_url}`);
  }
  if (!routes.length && profile.contact_page_url) routes.push(`contact_page: ${profile.contact_page_url}`);
  if (!routes.length && profile.official_website) routes.push(`official_website: ${profile.official_website}`);
  return routes;
}

function typicalOpportunity(profile) {
  if (profile.company_type === "Developer") return "Subdivision Trades";
  if (profile.company_type === "General Contractor") return "Subcontracted Trade Packages";
  if (profile.company_type === "Architect") return "Design-Led Project Intelligence";
  if (profile.company_type === "Engineer") return "Infrastructure and Site Work";
  if (profile.company_type === "Property Owner") return "Owner-Directed Procurement";
  return "Unknown";
}

function accessConfidence(profile, paths, routes) {
  let score = profile.profile_confidence ?? 0.35;
  if (paths.some((path) => ["High", "Medium"].includes(path.contractor_value))) score += 0.2;
  if (routes.length) score += 0.15;
  if (paths.some((path) => ["trade_partner", "vendor_registration", "subcontractor_registration", "bid_portal", "public_procurement", "plan_room"].includes(path.path_type))) score += 0.2;
  return Math.min(1, Number(score.toFixed(2)));
}

function expandTopCompanies(rows, accessProfiles, accessRows) {
  return rows.map((company) => {
    const access = accessProfiles.find((profile) => profile.company_profile_id === company.company_profile_id);
    const companyAccessRows = accessRows.filter((row) => row.companies.some((item) => item.company_profile_id === company.company_profile_id));
    return {
      ...company,
      entry_method: access?.entry_method ?? "Unknown",
      access_score: access?.confidence ? Math.round(access.confidence * 100) : 0,
      access_routes: access?.known_access_routes?.length ?? 0,
      actionable_opportunities: companyAccessRows.filter((row) => row.opportunity_state === "Actionable Opportunity").length,
      research_required_opportunities: companyAccessRows.filter((row) => row.opportunity_state === "Research Required").length,
    };
  });
}

function renderAccessIntelligence(rows) {
  return [
    "# Access Intelligence",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Opportunities evaluated: ${rows.length}`,
    `- Actionable opportunities: ${rows.filter((row) => row.opportunity_state === "Actionable Opportunity").length}`,
    `- Research required: ${rows.filter((row) => row.opportunity_state === "Research Required").length}`,
    `- Opportunities with evidence but no known access route: ${rows.filter((row) => row.opportunity_state === "Opportunity").length}`,
    "",
    table(rows.slice(0, 50), [
      ["Project", (row) => row.project_name],
      ["State", (row) => row.opportunity_state],
      ["Qualification", (row) => row.qualification_score],
      ["Access Score", (row) => row.access_score],
      ["Fence Probability", (row) => `${row.fence_probability}%`],
      ["Developer", (row) => row.developer],
      ["GC", (row) => row.general_contractor],
      ["Entry Method", (row) => row.entry_method],
      ["Access Route", (row) => row.access_route],
      ["Next Step", (row) => row.recommended_next_step],
    ]),
  ].join("\n");
}

function renderCompanyAccessProfiles(rows) {
  return [
    "# Company Access Profiles",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows, [
      ["Company", (row) => row.company],
      ["Type", (row) => row.company_type],
      ["Entry Method", (row) => row.entry_method],
      ["Vendor Registration", (row) => row.vendor_registration],
      ["Trade Partner Registration", (row) => row.trade_partner_registration],
      ["Bid Portal", (row) => row.bid_portal],
      ["Procurement Path", (row) => row.procurement_path],
      ["Approval Required", (row) => row.approval_required],
      ["Known Routes", (row) => row.known_access_routes.length],
      ["Confidence", (row) => pct(row.confidence)],
    ]),
  ].join("\n");
}

function renderContractorVisibleAccess(rows) {
  const visible = rows.filter((row) => row.evidence_count > 0);
  return [
    "# Contractor Visible Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Evidence-backed opportunities: ${visible.length}`,
    `- Actionable opportunities: ${visible.filter((row) => row.opportunity_state === "Actionable Opportunity").length}`,
    `- Research required: ${visible.filter((row) => row.opportunity_state === "Research Required").length}`,
    `- Opportunities with no known access route yet: ${visible.filter((row) => row.opportunity_state === "Opportunity").length}`,
    "",
    "Phone or email is no longer required for contractor visibility. Opportunities are shown when evidence exists, then labeled by access readiness.",
    "",
    table(visible.slice(0, 75), [
      ["Project", (row) => row.project_name],
      ["Location", (row) => row.project_location],
      ["State", (row) => row.opportunity_state],
      ["Qualification", (row) => row.qualification_score],
      ["Access Score", (row) => row.access_score],
      ["Fence Probability", (row) => `${row.fence_probability}%`],
      ["Developer", (row) => row.developer],
      ["GC", (row) => row.general_contractor],
      ["Entry Method", (row) => row.entry_method],
      ["Access Route", (row) => row.access_route],
      ["Next Step", (row) => row.recommended_next_step],
    ]),
  ].join("\n");
}

function renderTopCompanies(rows) {
  return [
    "# Top 20 Companies",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows, [
      ["Company", (row) => row.company_name],
      ["Type", (row) => row.company_type],
      ["Projects", (row) => row.project_count],
      ["Evidence Count", (row) => row.evidence_count],
      ["Procurement Paths", (row) => row.procurement_paths],
      ["Relationship Count", (row) => row.relationship_count],
      ["Access Routes", (row) => row.access_routes],
      ["Entry Method", (row) => row.entry_method],
      ["Access Score", (row) => row.access_score],
      ["Fencing Signals", (row) => row.fencing_signals],
      ["Qualified Opportunities", (row) => row.qualified_opportunities],
      ["Actionable Opportunities", (row) => row.actionable_opportunities],
      ["Research Required", (row) => row.research_required_opportunities],
      ["Confidence", (row) => pct(row.confidence)],
    ]),
  ].join("\n");
}

function bestCompanyAccessProfile(profiles) {
  return [...profiles].sort((a, b) => accessRouteRank(b) - accessRouteRank(a) || b.confidence - a.confidence)[0] ?? null;
}

function accessRouteRank(profile) {
  if (!profile) return 0;
  if (profile.trade_partner_registration !== "Unknown") return 5;
  if (profile.vendor_registration !== "Unknown") return 4;
  if (profile.bid_portal !== "Unknown") return 4;
  if (profile.procurement_path !== "Unknown") return 2;
  return 0;
}

function bestPath(paths) {
  const rank = { High: 3, Medium: 2, Low: 1 };
  return [...paths].sort((a, b) => rank[b.contractor_value] - rank[a.contractor_value] || b.confidence - a.confidence)[0] ?? null;
}

function bestProcurementPath(paths) {
  return bestPath(paths ?? []);
}

function fenceProbability(opportunity) {
  let probability = opportunity.fencing_signal_presence ? 72 : 12;
  if (/fenc|gate|perimeter|security/i.test(opportunity.project_name)) probability += 18;
  if (/subdivision|residential|site work|utility|utilities|electrical/i.test(`${opportunity.trade} ${opportunity.project_name}`)) probability += 10;
  return Math.min(100, probability);
}

function companyByType(opportunity, type) {
  return opportunity.companies.find((company) => company.company_type === type);
}

function locationParts(location) {
  const parts = String(location ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return {
    city: parts[0] ?? "Unknown",
    county: parts.find((part) => /county/i.test(part)) ?? (parts.length > 1 ? parts[1] : "Unknown"),
  };
}

function groupBy(items, fn) {
  const groups = new Map();
  for (const item of items) {
    const key = fn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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
