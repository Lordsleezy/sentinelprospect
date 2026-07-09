import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Extract named businesses from permit work descriptions when Contractor is TBD,
 * then attach them as supplemental contact companies for enrichment.
 *
 * Example: "Provide New Fence and Gate ... (Golden Memories Childcare)"
 */

const sac = (await readJson("data/sacramento-county-permits.json")) ?? { records: [] };
const placer = (await readJson("data/placer-county-records.json")) ?? { records: [] };
const webSources = (await readJson("data/company_web_sources.json")) ?? [];
const capturedAt = new Date().toISOString();

const records = [...(sac.records ?? []), ...(placer.records ?? [])];
const extracted = [];

for (const record of records) {
  const project = record.normalized?.project ?? {};
  const payload = record.payload ?? record.attributes ?? {};
  const contractor = String(payload.Contractor ?? record.normalized?.contactCompany?.name ?? "");
  const description = [project.name, project.description, payload.ProjectName, payload.WorkDescription]
    .filter(Boolean)
    .join(" ");
  if (!description) continue;

  const hasUsableContractor = contractor
    && !/to be determined|tbd|select edit below|enter name/i.test(contractor)
    && contractor.trim().length > 2;

  const names = extractBusinessNames(description);
  for (const name of names) {
    if (hasUsableContractor && normalize(name) === normalize(contractor)) continue;
    extracted.push({
      opportunity_external_id: project.external_id ?? project.id ?? record.sourceId ?? null,
      project_name: project.name ?? payload.ProjectName ?? "Unknown",
      business_name: name,
      source_field: "work_description",
      source_url: record.sourceUrl ?? project.source_url ?? null,
      evidence: `Work description names business "${name}".`,
      last_verified: capturedAt,
    });
  }
}

const uniqueNames = [...new Map(extracted.map((row) => [normalize(row.business_name), row])).values()];

// Seed web sources for description-named businesses so CSLB enrichment can pick them up next run.
const byName = new Map(webSources.map((row) => [normalize(row.company_name), row]));
for (const row of uniqueNames) {
  const key = normalize(row.business_name);
  if (byName.has(key)) continue;
  byName.set(key, {
    company_name: row.business_name,
    sources: [{
      source_type: "permit_description",
      source_name: "Permit work description",
      source_url: row.source_url ?? "permit_record",
      field_name: "company_name",
      field_value: row.business_name,
      excerpt: row.evidence,
    }],
  });
}

await mkdir(resolve("data"), { recursive: true });
await writeJson("data/description_named_businesses.json", extracted);
await writeJson("data/company_web_sources.json", [...byName.values()].sort((a, b) => a.company_name.localeCompare(b.company_name)));

console.log(`Description-named businesses: ${extracted.length} mentions / ${uniqueNames.length} unique.`);
console.log(uniqueNames.map((row) => row.business_name).slice(0, 20).join(" | "));

function extractBusinessNames(text) {
  const names = [];
  const patterns = [
    /\(([A-Z][A-Za-z0-9&.'\-\s]{2,60}(?:Childcare|Child Care|Daycare|Academy|School|Church|Center|Clinic|Hospital|LLC|Inc|Corp|Company|Homes?))\)/g,
    /\bfor\s+([A-Z][A-Za-z0-9&.'\-\s]{2,50}(?:Childcare|Child Care|Daycare|Academy|School))\b/g,
    /\b([A-Z][A-Za-z0-9&.'\-]+(?:\s+[A-Z][A-Za-z0-9&.'\-]+){1,5}\s+(?:Childcare|Child Care|Daycare))\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = cleanName(match[1]);
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

function cleanName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 4 || name.length > 80) return null;
  if (/^(the|and|for|with|new|existing)$/i.test(name)) return null;
  return name;
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
