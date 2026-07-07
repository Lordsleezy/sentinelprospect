import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const cacheFiles = [
  "data/sacramento-county-permits.json",
  "data/placer-county-records.json",
  "data/samgov-opportunities.json",
];

const rolePatterns = [
  { role: "Developer", pattern: /developer|builder/i },
  { role: "Property Owner", pattern: /owner|property.?owner/i },
  { role: "Applicant", pattern: /applicant/i },
  { role: "General Contractor", pattern: /contractor|general.?contractor/i },
  { role: "Architect", pattern: /architect/i },
  { role: "Engineer", pattern: /engineer/i },
];

const targetContactRoles = [
  "Owner",
  "President",
  "CEO",
  "Development Director",
  "Construction Director",
  "Project Executive",
  "Project Manager",
  "Procurement Contact",
  "Estimator",
];

const caches = (await Promise.all(cacheFiles.map(readJson))).filter(Boolean);
const webSources = await readJson("data/contact_web_sources.json") ?? [];
const webSourceByCompany = new Map(webSources.map((item) => [normalizeKey(item.company_name), item]));
const records = caches.flatMap((cache) => cache.records ?? []);
const harvestedAt = new Date().toISOString();
const harvested = records.flatMap((record) => harvestRecord(record, harvestedAt));
const contact_resolution_results = harvested.map((item) => item.result);
const contact_confidence_score = harvested.map((item) => item.confidence);
const contact_source_evidence = harvested.flatMap((item) => item.evidence);
const roleCoverage = summarizeRoleCoverage(records, harvested);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/contact_resolution_results.json", contact_resolution_results),
  writeJson("data/contact_confidence_score.json", contact_confidence_score),
  writeJson("data/contact_source_evidence.json", contact_source_evidence),
  writeFile(resolve("reports/contact-intelligence-harvest.md"), renderReport(contact_resolution_results, contact_source_evidence, roleCoverage)),
]);

console.log(`Harvested ${contact_resolution_results.length} source-backed company resolution row(s).`);
console.log(`Source-backed human contacts: ${contact_resolution_results.filter((item) => item.contact_name).length}.`);

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

function harvestRecord(record, lastVerified) {
  const project = record.normalized?.project ?? {};
  const companies = extractCompanies(record);
  return companies.map((company, index) => {
    const resolutionId = stableId([
      project.external_id ?? project.id ?? record.sourceId,
      company.role,
      company.name,
      index,
    ]);
    const webSource = webSourceByCompany.get(normalizeKey(company.name)) ?? null;
    const resolved = resolveCompanyFields(company, webSource);
    const person = extractSourceBackedPerson(record, company.role) ?? extractWebBackedPerson(webSource);
    const confidence = scoreResolution(company, resolved, person);
    const evidence = buildEvidence(resolutionId, record, company, resolved, person, webSource, lastVerified);

    return {
      result: {
        id: resolutionId,
        project_external_id: project.external_id ?? project.id ?? null,
        project_name: project.name ?? "Unknown project",
        company_name: company.name,
        project_role: company.role,
        resolved_website: resolved.website,
        linkedin_url: resolved.linkedin,
        phone: resolved.phone,
        contact_page_url: resolved.contactPage,
        staff_directory_url: resolved.staffDirectory,
        contact_name: person?.name ?? null,
        contact_title: person?.title ?? null,
        contact_role: person?.contactRole ?? null,
        source_url: company.sourceUrl,
        confidence: confidence.score,
        last_verified: lastVerified,
        status: person ? "source_backed_contact" : "source_backed_company",
        metadata: {
          source_name: record.sourceName ?? "Unknown source",
          source_id: record.sourceId ?? null,
          source_field: company.sourceField,
          enrichment_source: webSource ? "data/contact_web_sources.json" : null,
          target_contact_roles: targetContactRoles,
          unresolved_reason: person ? null : "No source-backed person-level contact found in current records.",
        },
      },
      confidence: {
        id: `${resolutionId}-confidence`,
        contact_resolution_result_id: resolutionId,
        score: confidence.score,
        factors: confidence.factors,
      },
      evidence,
    };
  });
}

function extractCompanies(record) {
  const companies = [];
  const normalizedCompany = record.normalized?.contactCompany;
  if (normalizedCompany?.name && isSourceBackedName(normalizedCompany.name)) {
    companies.push({
      name: normalizedCompany.name,
      role: roleFromNormalized(normalizedCompany.role, normalizedCompany.company_type),
      sourceField: "normalized.contactCompany.name",
      sourceName: record.sourceName ?? "Unknown source",
      sourceUrl: record.sourceUrl ?? record.normalized?.evidence?.source_url ?? normalizedCompany.website,
      phone: normalizedCompany.phone ?? null,
      website: normalizedCompany.website ?? null,
      linkedin: null,
      contactPage: null,
      staffDirectory: null,
    });
  }

  for (const [key, value] of Object.entries(record.payload ?? {})) {
    if (typeof value !== "string" || !value.trim()) continue;
    const role = rolePatterns.find((item) => item.pattern.test(key))?.role;
    if (!role || !isSourceBackedName(value)) continue;
    companies.push({
      name: value.trim(),
      role,
      sourceField: `payload.${key}`,
      sourceName: record.sourceName ?? "Unknown source",
      sourceUrl: record.sourceUrl ?? record.normalized?.evidence?.source_url ?? "",
      phone: null,
      website: null,
      linkedin: null,
      contactPage: null,
      staffDirectory: null,
    });
  }

  return dedupeCompanies(companies).filter((company) => company.sourceUrl);
}

function roleFromNormalized(role, companyType) {
  const value = `${role ?? ""} ${companyType ?? ""}`.toLowerCase();
  if (value.includes("developer") || value.includes("builder")) return "Developer";
  if (value.includes("owner")) return "Property Owner";
  if (value.includes("applicant")) return "Applicant";
  if (value.includes("architect")) return "Architect";
  if (value.includes("engineer")) return "Engineer";
  return "General Contractor";
}

function resolveCompanyFields(company, webSource) {
  return {
    website: safeUrl(company.website) ?? safeUrl(webSource?.website),
    linkedin: safeUrl(company.linkedin) ?? safeUrl(webSource?.linkedin),
    phone: safePhone(company.phone) ?? safePhone(webSource?.phone),
    contactPage: safeUrl(company.contactPage) ?? safeUrl(webSource?.contact_page_url),
    staffDirectory: safeUrl(company.staffDirectory) ?? safeUrl(webSource?.staff_directory_url),
  };
}

function extractSourceBackedPerson(record) {
  const payload = record.payload ?? {};
  const candidates = [];

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const contactRole = targetContactRoles.find((role) => key.toLowerCase().includes(role.toLowerCase().replace(/\s+/g, "")));
    if (!contactRole) continue;
    const parsed = parsePerson(value, contactRole);
    if (parsed) candidates.push(parsed);
  }

  return candidates[0] ?? null;
}

function parsePerson(value, contactRole) {
  const trimmed = value.trim();
  if (!isLikelyHumanName(trimmed)) return null;
  return {
    name: trimmed,
    title: contactRole,
    contactRole,
  };
}

function extractWebBackedPerson(webSource) {
  if (!webSource?.contact_name || !webSource?.contact_role) return null;
  if (!targetContactRoles.includes(webSource.contact_role)) return null;
  if (!isLikelyHumanName(webSource.contact_name)) return null;
  return {
    name: webSource.contact_name,
    title: webSource.contact_title ?? webSource.contact_role,
    contactRole: webSource.contact_role,
  };
}

function buildEvidence(resolutionId, record, company, resolved, person, webSource, capturedAt) {
  const evidence = [{
    id: `${resolutionId}-company-evidence`,
    contact_resolution_result_id: resolutionId,
    evidence_type: "source_record_company",
    source_name: company.sourceName,
    source_url: company.sourceUrl,
    excerpt: `${company.sourceField}: ${company.name}`,
    captured_at: capturedAt,
    confidence: 0.72,
  }];

  if (company.phone && resolved.phone) evidence.push(sourceEvidence(resolutionId, "source_record_phone", record, company, resolved.phone, capturedAt));
  if (company.website && resolved.website) evidence.push(sourceEvidence(resolutionId, "source_record_website", record, company, resolved.website, capturedAt));
  if (company.contactPage && resolved.contactPage) evidence.push(sourceEvidence(resolutionId, "source_record_contact_page", record, company, resolved.contactPage, capturedAt));
  if (company.staffDirectory && resolved.staffDirectory) evidence.push(sourceEvidence(resolutionId, "source_record_staff_directory", record, company, resolved.staffDirectory, capturedAt));
  if (person && !webSource?.contact_name) evidence.push(sourceEvidence(resolutionId, "source_record_person", record, company, `${person.name}, ${person.title}`, capturedAt));
  for (const source of webSource?.sources ?? []) {
    if (!source.source_url || !source.excerpt || !source.evidence_type) continue;
    evidence.push({
      id: `${resolutionId}-${stableId([source.evidence_type, source.source_url])}`,
      contact_resolution_result_id: resolutionId,
      evidence_type: source.evidence_type,
      source_name: source.source_name ?? "Public profile",
      source_url: source.source_url,
      excerpt: source.excerpt,
      captured_at: capturedAt,
      confidence: 0.82,
    });
  }

  return evidence;
}

function sourceEvidence(resolutionId, evidenceType, record, company, excerpt, capturedAt) {
  return {
    id: `${resolutionId}-${evidenceType}`,
    contact_resolution_result_id: resolutionId,
    evidence_type: evidenceType,
    source_name: record.sourceName ?? company.sourceName,
    source_url: company.sourceUrl,
    excerpt,
    captured_at: capturedAt,
    confidence: 0.8,
  };
}

function scoreResolution(company, resolved, person) {
  const factors = [];
  let score = 0;

  addFactor(factors, "source_backed_company", 0.45, "Company name appears in a public source record.");
  score += 0.45;

  if (company.role) {
    addFactor(factors, "project_role", 0.1, `${company.role} role is source-derived.`);
    score += 0.1;
  }
  if (resolved.website) {
    addFactor(factors, "website", 0.12, "Website is present in source-backed data.");
    score += 0.12;
  }
  if (resolved.linkedin) {
    addFactor(factors, "linkedin", 0.08, "LinkedIn URL is present in source-backed data.");
    score += 0.08;
  }
  if (resolved.phone) {
    addFactor(factors, "phone", 0.15, "Phone is present in source-backed data.");
    score += 0.15;
  }
  if (resolved.contactPage) {
    addFactor(factors, "contact_page", 0.1, "Contact page is present in source-backed data.");
    score += 0.1;
  }
  if (resolved.staffDirectory) {
    addFactor(factors, "staff_directory", 0.1, "Staff directory is present in source-backed data.");
    score += 0.1;
  }
  if (person) {
    addFactor(factors, "person_contact", 0.25, "Person-level contact is source-backed.");
    score += 0.25;
  } else {
    addFactor(factors, "person_contact_missing", 0, "No source-backed person-level contact found.");
  }

  return { score: Math.min(1, Number(score.toFixed(2))), factors };
}

function addFactor(factors, factor, points, reason) {
  factors.push({ factor, points, reason });
}

function summarizeRoleCoverage(records, harvested) {
  const rowsByProject = new Map();
  for (const record of records) {
    const project = record.normalized?.project ?? {};
    rowsByProject.set(project.id ?? record.sourceId, {
      project_name: project.name ?? "Unknown project",
      location: [project.city, project.county, project.state].filter(Boolean).join(", "),
      roles: Object.fromEntries(rolePatterns.map(({ role }) => [role, "Unknown"])),
    });
  }
  for (const item of harvested) {
    const projectId = item.result.project_external_id;
    const row = rowsByProject.get(projectId) ?? [...rowsByProject.values()].find((candidate) => candidate.project_name === item.result.project_name);
    if (row) row.roles[item.result.project_role] = item.result.company_name;
  }
  return [...rowsByProject.values()];
}

function renderReport(results, evidence, roleCoverage) {
  const withWebsite = results.filter((item) => item.resolved_website);
  const withLinkedIn = results.filter((item) => item.linkedin_url);
  const withPhone = results.filter((item) => item.phone);
  const withHumans = results.filter((item) => item.contact_name);
  const uniqueCompanies = new Set(results.map((item) => normalizeKey(item.company_name)));

  return [
    "# Contact Intelligence Harvest",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Project records scanned: ${records.length}`,
    `- Unique source-backed companies found: ${uniqueCompanies.size}`,
    `- Contact resolution rows: ${results.length}`,
    `- Companies with source-backed website: ${withWebsite.length}`,
    `- Companies with source-backed LinkedIn: ${withLinkedIn.length}`,
    `- Companies with source-backed phone: ${withPhone.length}`,
    `- Source-backed human contacts extracted: ${withHumans.length}`,
    `- Contact source evidence rows: ${evidence.length}`,
    `- Public enrichment sources applied: ${webSources.length}`,
    "",
    "## Rule",
    "",
    "Unknown is acceptable. Fake is not. This harvester stores only company/contact facts that appear in source-backed records.",
    "",
    "## Contact Resolution Results",
    "",
    table(results, [
      ["Project", (row) => row.project_name],
      ["Role", (row) => row.project_role],
      ["Company", (row) => row.company_name],
      ["Website", (row) => row.resolved_website ?? "Unknown"],
      ["LinkedIn", (row) => row.linkedin_url ?? "Unknown"],
      ["Phone", (row) => row.phone ?? "Unknown"],
      ["Human Contact", (row) => row.contact_name ? `${row.contact_name} (${row.contact_title})` : "Unknown"],
      ["Confidence", (row) => pct(row.confidence)],
      ["Source", (row) => row.source_url],
    ]),
    "",
    "## Project Role Coverage",
    "",
    table(roleCoverage, [
      ["Project", (row) => row.project_name],
      ["Location", (row) => row.location || "Unknown"],
      ["Developer", (row) => row.roles.Developer],
      ["Property Owner", (row) => row.roles["Property Owner"]],
      ["Applicant", (row) => row.roles.Applicant],
      ["General Contractor", (row) => row.roles["General Contractor"]],
      ["Architect", (row) => row.roles.Architect],
      ["Engineer", (row) => row.roles.Engineer],
    ]),
  ].join("\n");
}

function table(rows, columns) {
  if (!rows.length) return "_None._";
  return [
    `| ${columns.map(([name]) => name).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, getter]) => escapeCell(getter(row))).join(" | ")} |`),
  ].join("\n");
}

function dedupeCompanies(companies) {
  const seen = new Set();
  return companies.filter((company) => {
    const key = `${normalizeKey(company.name)}|${company.role}|${company.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableId(parts) {
  return normalizeKey(parts.filter(Boolean).join("-")).replace(/\s+/g, "-").slice(0, 180);
}

function normalizeKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|company|co|limited|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (!isSourceBackedName(trimmed)) return null;
  return trimmed;
}

function safePhone(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /\d{3}[-.\s)]*\d{3}[-.\s]*\d{4}/.test(trimmed) && !/\b555[-\s]?\d{4}\b/.test(trimmed) ? trimmed : null;
}

function isLikelyHumanName(value) {
  if (!isSourceBackedName(value)) return false;
  if (/\d|@|https?:\/\//i.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-Z][A-Za-z'.-]+$/.test(word));
}

function isSourceBackedName(name) {
  if (!name) return false;
  const blob = String(name).toLowerCase();
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

function escapeCell(value) {
  return String(value ?? "Unknown").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}
