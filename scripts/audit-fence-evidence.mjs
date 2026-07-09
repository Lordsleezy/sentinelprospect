import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const terms = [
  "fence",
  "fencing",
  "gate",
  "gates",
  "perimeter",
  "security",
  "access control",
  "enclosure",
  "screen wall",
  "chain link",
  "ornamental iron",
  "wrought iron",
  "detention basin",
  "park fencing",
  "trail fencing",
  "school fencing",
  "sports field fencing",
];

const files = [
  "data/evidence_documents.json",
  "data/contractor_opportunities.json",
  "data/sacramento-county-permits.json",
  "data/placer-county-records.json",
  "data/samgov-opportunities.json",
  "data/scope_intelligence.json",
  "data/document_extraction_results.json",
  "data/evidence_expansion.json",
];

function countTerm(text, term) {
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return (String(text).match(re) || []).length;
}

function escapeRegex(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function harvestRecordText(record) {
  const n = record.normalized || record.payload || record;
  return [
    n.description,
    n.workDescription,
    n.WorkDescription,
    n.projectName,
    n.ProjectName,
    n.project_name,
    n.permitType,
    n.PermitType,
    n.scope,
    n.title,
    n.summary,
    n.notes,
    n.address,
    n.Address,
    record.sourceName,
    JSON.stringify(n),
  ]
    .filter(Boolean)
    .join(" | ");
}

const fileReports = [];
for (const file of files) {
  const raw = await readFile(resolve(file), "utf8");
  const counts = Object.fromEntries(terms.map((term) => [term, countTerm(raw, term)]));
  fileReports.push({
    file,
    total_hits: Object.values(counts).reduce((a, b) => a + b, 0),
    counts,
  });
}

const permitsRaw = JSON.parse(await readFile(resolve("data/sacramento-county-permits.json"), "utf8"));
const placerRaw = JSON.parse(await readFile(resolve("data/placer-county-records.json"), "utf8"));
const permits = Array.isArray(permitsRaw) ? permitsRaw : (permitsRaw.records ?? []);
const placer = Array.isArray(placerRaw) ? placerRaw : (placerRaw.records ?? []);
const evidenceDocs = JSON.parse(await readFile(resolve("data/evidence_documents.json"), "utf8"));
const opportunities = JSON.parse(await readFile(resolve("data/contractor_opportunities.json"), "utf8"));

const sacTexts = permits.map(harvestRecordText);
const placerTexts = placer.map(harvestRecordText);
const evidenceTexts = evidenceDocs.map((doc) =>
  [doc.title, doc.summary, doc.project_name, doc.award_information, ...(doc.trades || []), ...(doc.relationships || []).map((r) => r.evidence_summary)]
    .filter(Boolean)
    .join(" | "),
);
const oppSourceTexts = opportunities.map((o) =>
  [o.project_name, o.project_location, o.trade, o.qualification_reason, o.source_url].filter(Boolean).join(" | "),
);

function termHits(texts) {
  return Object.fromEntries(
    terms.map((term) => {
      const re = new RegExp(escapeRegex(term), "i");
      const matches = texts.filter((text) => re.test(text));
      return [
        term,
        {
          count: matches.length,
          sample: matches[0]?.slice(0, 220) ?? null,
        },
      ];
    }),
  );
}

const corpusHits = {
  evidence_documents: termHits(evidenceTexts),
  sacramento_permits: termHits(sacTexts),
  placer_records: termHits(placerTexts),
  contractor_opportunity_source_fields: termHits(oppSourceTexts),
};

const samplePermit = {
  keys_normalized: Object.keys(permits[0]?.normalized || {}),
  description: permits[0]?.normalized?.description ?? null,
  workDescription: permits[0]?.normalized?.workDescription ?? null,
  projectName: permits[0]?.normalized?.projectName ?? null,
  permitType: permits[0]?.normalized?.permitType ?? null,
  sample: permits.slice(0, 5).map((p) => ({
    id: p.normalized?.permitNumber || p.sourceId,
    type: p.normalized?.permitType,
    desc: (p.normalized?.description || "").slice(0, 180),
    name: p.normalized?.projectName,
  })),
};

const samplePlacer = placer.slice(0, 5).map((p) => ({
  id: p.normalized?.permitNumber || p.sourceId || p.id,
  type: p.normalized?.permitType || p.normalized?.type,
  desc: (p.normalized?.description || p.normalized?.workDescription || "").slice(0, 180),
  name: p.normalized?.projectName || p.normalized?.title,
}));

console.log(JSON.stringify({ fileReports, corpusHits, samplePermit, samplePlacer }, null, 2));

await mkdir(resolve("reports"), { recursive: true });
await writeFile(resolve("reports/fence-evidence-audit-raw.json"), `${JSON.stringify({ fileReports, corpusHits, samplePermit, samplePlacer }, null, 2)}\n`);
