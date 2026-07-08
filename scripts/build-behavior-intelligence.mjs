import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const cacheFiles = [
  "data/sacramento-county-permits.json",
  "data/placer-county-records.json",
  "data/samgov-opportunities.json",
];

const tradeNames = ["Fencing", "Concrete", "HVAC", "Roofing", "Electrical", "Landscaping", "Site work", "Security fencing", "Earthwork", "Utilities", "Residential", "General"];
const caches = (await Promise.all(cacheFiles.map(readJson))).filter(Boolean);
const records = caches.flatMap((cache) => cache.records ?? []);
const companyProfiles = await readJson("data/company_profiles.json") ?? [];
const procurementPaths = await readJson("data/company_procurement_paths.json") ?? [];
const documentExtractions = await readJson("data/document_extraction_results.json") ?? [];
const capturedAt = new Date().toISOString();

const projectFacts = [
  ...records.map(projectFact).filter(Boolean),
  ...documentExtractions.map(documentProjectFact).filter(Boolean),
];
const behaviorRows = buildCompanyBehavior(projectFacts, companyProfiles, procurementPaths, capturedAt);
const developer_profiles = behaviorRows.filter((row) => row.company_type === "Developer").map(developerProfile);
const gc_profiles = behaviorRows.filter((row) => row.company_type === "General Contractor").map(gcProfile);
const historical_relationships = buildRelationships(projectFacts, companyProfiles, capturedAt);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/developer_profiles.json", developer_profiles),
  writeJson("data/gc_profiles.json", gc_profiles),
  writeJson("data/company_behavior.json", behaviorRows),
  writeJson("data/historical_relationships.json", historical_relationships),
  writeFile(resolve("reports/developer-profiles.md"), renderDeveloperProfiles(developer_profiles, behaviorRows)),
  writeFile(resolve("reports/gc-profiles.md"), renderGcProfiles(gc_profiles, behaviorRows)),
  writeFile(resolve("reports/company-behavior.md"), renderCompanyBehavior(behaviorRows, historical_relationships)),
]);

console.log(`Built ${developer_profiles.length} developer profile(s).`);
console.log(`Built ${gc_profiles.length} GC profile(s).`);
console.log(`Behavior rows: ${behaviorRows.length}.`);
console.log(`Historical relationships: ${historical_relationships.length}.`);

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

function projectFact(record) {
  const project = record.normalized?.project;
  if (!project) return null;
  const companies = [];
  const contactCompany = record.normalized?.contactCompany;
  if (contactCompany?.name && isSourceBackedText(contactCompany.name)) {
    const profile = profileForCompany(contactCompany.name);
    if (profile) {
      companies.push({
        profile_id: profile.id,
        company_name: profile.company_name,
        company_type: profile.company_type,
        role: profile.company_type,
      });
    }
  }
  const trades = normalizedTrades(record.normalized?.inferredTrades);
  return {
    project_id: project.id,
    project_name: project.name,
    project_type: project.project_type,
    city: project.city,
    county: project.county,
    status: project.status,
    trades,
    companies,
    source_url: record.sourceUrl ?? project.source_url,
  };
}

function documentProjectFact(document) {
  const companies = [];
  for (const company of document.companies ?? []) {
    if (!company.name || !isSourceBackedText(company.name)) continue;
    const profile = profileForCompany(company.name);
    if (!profile) continue;
    companies.push({
      profile_id: profile.id,
      company_name: profile.company_name,
      company_type: profile.company_type,
      role: profile.company_type,
    });
  }
  return {
    project_id: document.evidence_document_id,
    project_name: document.project_name,
    project_type: projectTypeFromDocument(document),
    city: cityFromLocation(document.location),
    county: countyFromLocation(document.location),
    status: "Evidence Document",
    trades: normalizedTrades(document.trades),
    companies,
    source_url: document.source_url,
  };
}

function buildCompanyBehavior(facts, profiles, paths, lastVerified) {
  return profiles.map((profile) => {
    const companyFacts = facts.filter((fact) => fact.companies.some((company) => company.profile_id === profile.id));
    const projectTypes = countValues(companyFacts.map((fact) => fact.project_type));
    const cities = countValues(companyFacts.map((fact) => fact.city));
    const counties = countValues(companyFacts.map((fact) => fact.county));
    const trades = countValues(companyFacts.flatMap((fact) => fact.trades));
    const companyPaths = paths.filter((path) => path.company_profile_id === profile.id);
    const outsourcing = outsourcingByTrade(profile, companyFacts);
    const opportunityLikelihood = opportunityScore(companyFacts, companyPaths, outsourcing, profile);

    return {
      id: `${profile.id}-behavior`,
      company_profile_id: profile.id,
      company_name: profile.company_name,
      company_type: profile.company_type,
      project_count: companyFacts.length,
      project_types: projectTypes,
      cities,
      counties,
      known_trades: trades,
      procurement_paths: companyPaths.map((path) => ({
        path_type: path.path_type,
        path_url: path.path_url,
        contractor_value: path.contractor_value,
        confidence: path.confidence,
      })),
      outsourcing_by_trade: outsourcing,
      opportunity_likelihood: opportunityLikelihood,
      evidence_count: companyFacts.length + companyPaths.length,
      last_verified: lastVerified,
      metadata: {
        projects: companyFacts.map((fact) => ({
          project_id: fact.project_id,
          project_name: fact.project_name,
          project_type: fact.project_type,
          city: fact.city,
          county: fact.county,
          trades: fact.trades,
          source_url: fact.source_url,
        })),
      },
    };
  }).sort((a, b) => b.opportunity_likelihood - a.opportunity_likelihood || b.project_count - a.project_count || a.company_name.localeCompare(b.company_name));
}

function developerProfile(row) {
  return {
    id: `${row.company_profile_id}-developer-profile`,
    company_profile_id: row.company_profile_id,
    company_name: row.company_name,
    project_count: row.project_count,
    project_types: row.project_types,
    cities: row.cities,
    counties: row.counties,
    known_trades: row.known_trades,
    procurement_path_count: row.procurement_paths.length,
    opportunity_likelihood: row.opportunity_likelihood,
    last_verified: row.last_verified,
  };
}

function gcProfile(row) {
  return {
    id: `${row.company_profile_id}-gc-profile`,
    company_profile_id: row.company_profile_id,
    company_name: row.company_name,
    project_count: row.project_count,
    project_types: row.project_types,
    cities: row.cities,
    counties: row.counties,
    known_trades: row.known_trades,
    procurement_path_count: row.procurement_paths.length,
    opportunity_likelihood: row.opportunity_likelihood,
    outsourcing_by_trade: row.outsourcing_by_trade,
    last_verified: row.last_verified,
  };
}

function buildRelationships(facts, profiles, lastVerified) {
  const relationships = new Map();

  for (const fact of facts) {
    if (fact.companies.length < 2) continue;
    for (const from of fact.companies) {
      for (const to of fact.companies) {
        if (from.profile_id === to.profile_id) continue;
        const relationshipType = relationshipTypeFor(from.company_type, to.company_type);
        if (!relationshipType) continue;
        const key = `${from.profile_id}|${to.profile_id}|${relationshipType}`;
        const existing = relationships.get(key) ?? {
          id: `relationship-${normalizeName(from.company_name)}-${normalizeName(to.company_name)}-${relationshipType}`.replace(/\s+/g, "-"),
          from_company_profile_id: from.profile_id,
          to_company_profile_id: to.profile_id,
          relationship_type: relationshipType,
          project_count: 0,
          projects: [],
          trades: new Set(),
          confidence: 0,
          last_verified: lastVerified,
        };
        existing.project_count += 1;
        existing.projects.push({
          project_id: fact.project_id,
          project_name: fact.project_name,
          source_url: fact.source_url,
        });
        for (const trade of fact.trades) existing.trades.add(trade);
        relationships.set(key, existing);
      }
    }
  }

  return [...relationships.values()].map((relationship) => ({
    ...relationship,
    trades: [...relationship.trades].sort(),
    confidence: Math.min(0.9, Number((0.35 + relationship.project_count * 0.15).toFixed(2))),
  })).sort((a, b) => b.project_count - a.project_count || a.relationship_type.localeCompare(b.relationship_type));
}

function relationshipTypeFor(fromType, toType) {
  if (fromType === "Developer" && toType === "General Contractor") return "developer_gc";
  if (fromType === "Developer" && toType === "Architect") return "developer_architect";
  if (fromType === "Developer" && toType === "Engineer") return "developer_engineer";
  if (fromType === "Developer" && toType !== "Developer") return "developer_trade_contractor";
  if (fromType === "General Contractor" && toType !== "Developer") return "gc_trade_contractor";
  return null;
}

function outsourcingByTrade(profile, companyFacts) {
  const result = {};
  for (const trade of tradeNames) {
    const tradeProjectCount = companyFacts.filter((fact) => fact.trades.includes(trade)).length;
    result[trade] = {
      status: outsourcingStatus(profile, tradeProjectCount),
      evidence_count: tradeProjectCount,
      confidence: tradeProjectCount ? Math.min(0.85, Number((0.45 + tradeProjectCount * 0.08).toFixed(2))) : 0.15,
    };
  }
  return result;
}

function outsourcingStatus(profile, tradeProjectCount) {
  if (!tradeProjectCount) return "Unknown";
  if (profile.company_type === "Developer") return tradeProjectCount >= 3 ? "Frequently Outsources" : "Sometimes Outsources";
  if (profile.company_type === "General Contractor") {
    if (tradeProjectCount >= 8) return "Self Performs";
    if (tradeProjectCount >= 3) return "Rarely Outsources";
    return "Unknown";
  }
  return "Unknown";
}

function opportunityScore(companyFacts, companyPaths, outsourcing, profile) {
  let score = 0;
  score += Math.min(0.35, companyFacts.length * 0.035);
  score += Math.min(0.2, companyPaths.length * 0.08);
  if (companyPaths.some((path) => path.contractor_value === "High")) score += 0.18;
  else if (companyPaths.some((path) => path.contractor_value === "Medium")) score += 0.1;
  const fencing = outsourcing.Fencing?.status;
  if (["Frequently Outsources", "Sometimes Outsources"].includes(fencing)) score += 0.22;
  if (profile.company_type === "Developer") score += 0.08;
  if (profile.company_type === "General Contractor" && fencing === "Self Performs") score -= 0.12;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function renderDeveloperProfiles(rows) {
  return [
    "# Developer Profiles",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    rows.length ? table(rows, [
      ["Developer", (row) => row.company_name],
      ["Projects", (row) => row.project_count],
      ["Project Types", (row) => topLabels(row.project_types)],
      ["Cities", (row) => topLabels(row.cities)],
      ["Counties", (row) => topLabels(row.counties)],
      ["Known Trades", (row) => topLabels(row.known_trades)],
      ["Procurement Paths", (row) => row.procurement_path_count],
      ["Opportunity Likelihood", (row) => pct(row.opportunity_likelihood)],
      ["Fencing Signal", (row) => fencingSignal(row)],
    ]) : "_No developer profiles are available from current source-backed company data._",
  ].join("\n");
}

function renderGcProfiles(rows) {
  return [
    "# GC Profiles",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows, [
      ["GC", (row) => row.company_name],
      ["Projects", (row) => row.project_count],
      ["Project Types", (row) => topLabels(row.project_types)],
      ["Cities", (row) => topLabels(row.cities)],
      ["Known Trades", (row) => topLabels(row.known_trades)],
      ["Fencing Outsourcing", (row) => row.outsourcing_by_trade.Fencing?.status ?? "Unknown"],
      ["Fencing Evidence", (row) => row.outsourcing_by_trade.Fencing?.evidence_count ?? 0],
      ["Procurement Paths", (row) => row.procurement_path_count],
      ["Opportunity Likelihood", (row) => pct(row.opportunity_likelihood)],
    ]),
  ].join("\n");
}

function renderCompanyBehavior(rows, relationships) {
  const fencingCreators = rows.filter((row) => (row.known_trades.find((item) => item.name === "Fencing")?.count ?? 0) > 0);
  return [
    "# Company Behavior",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Companies profiled: ${rows.length}`,
    `- Developer profiles: ${rows.filter((row) => row.company_type === "Developer").length}`,
    `- GC profiles: ${rows.filter((row) => row.company_type === "General Contractor").length}`,
    `- Companies with fencing signals: ${fencingCreators.length}`,
    `- Repeated historical relationships: ${relationships.filter((item) => item.project_count > 1).length}`,
    "",
    "## Companies Most Likely To Generate Work",
    "",
    table(rows.slice(0, 15), [
      ["Company", (row) => row.company_name],
      ["Type", (row) => row.company_type],
      ["Projects", (row) => row.project_count],
      ["Known Trades", (row) => topLabels(row.known_trades)],
      ["Procurement Paths", (row) => row.procurement_paths.length],
      ["Fencing Outsourcing", (row) => row.outsourcing_by_trade.Fencing?.status ?? "Unknown"],
      ["Opportunity Likelihood", (row) => pct(row.opportunity_likelihood)],
    ]),
    "",
    "## Fencing Opportunity Signals",
    "",
    table(fencingCreators, [
      ["Company", (row) => row.company_name],
      ["Type", (row) => row.company_type],
      ["Fencing Projects", (row) => row.known_trades.find((item) => item.name === "Fencing")?.count ?? 0],
      ["Outsourcing", (row) => row.outsourcing_by_trade.Fencing?.status ?? "Unknown"],
      ["Confidence", (row) => row.outsourcing_by_trade.Fencing?.status === "Unknown" ? "Unknown" : pct(row.outsourcing_by_trade.Fencing?.confidence ?? 0)],
    ]),
    "",
    "## Historical Relationships",
    "",
    relationships.length ? table(relationships, [
      ["From", (row) => companyName(row.from_company_profile_id)],
      ["To", (row) => companyName(row.to_company_profile_id)],
      ["Type", (row) => row.relationship_type],
      ["Projects", (row) => row.project_count],
      ["Trades", (row) => row.trades.join(", ") || "Unknown"],
      ["Confidence", (row) => pct(row.confidence)],
    ]) : "_No multi-company relationships can be verified from current source-backed records._",
  ].join("\n");
}

function profileForCompany(name) {
  const key = normalizeName(name);
  return companyProfiles.find((profile) => profile.normalized_name === key) ?? null;
}

function companyName(profileId) {
  return companyProfiles.find((profile) => profile.id === profileId)?.company_name ?? profileId;
}

function normalizedTrades(trades) {
  return [...new Set((Array.isArray(trades) ? trades : ["General"]).filter((trade) => tradeNames.includes(trade)))].sort();
}

function projectTypeFromDocument(document) {
  const blob = `${document.project_name ?? ""} ${(document.trades ?? []).join(" ")} ${document.summary ?? ""}`.toLowerCase();
  if (blob.includes("residential") || blob.includes("homes") || blob.includes("subdivision")) return "Residential";
  if (blob.includes("drainage") || blob.includes("utilities")) return "Infrastructure";
  return "Unknown";
}

function cityFromLocation(location) {
  const value = String(location ?? "");
  if (/sacramento/i.test(value)) return "Sacramento";
  if (/natomas/i.test(value)) return "Sacramento";
  return value.split(",")[0]?.trim() || "Unknown";
}

function countyFromLocation(location) {
  const value = String(location ?? "");
  if (/sacramento/i.test(value)) return "Sacramento";
  return "Unknown";
}

function countValues(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function topLabels(items) {
  return items.slice(0, 5).map((item) => `${item.name} (${item.count})`).join(", ") || "Unknown";
}

function fencingSignal(row) {
  const fencing = row.known_trades.find((item) => item.name === "Fencing");
  return fencing ? `${fencing.count} fencing-related project(s)` : "No current fencing signal";
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
