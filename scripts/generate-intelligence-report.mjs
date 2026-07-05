import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const caches = await Promise.all([
  readJson("data/sacramento-county-permits.json"),
  readJson("data/placer-county-records.json"),
  readJson("data/samgov-opportunities.json"),
]);

const records = caches.flatMap((cache) => cache.records ?? []);
const projects = records.map((record) => record.normalized.project);
const signals = records.map((record) => record.normalized.signal);
const evidence = records.flatMap((record) => [
  record.normalized.evidence,
  { record_type: "permit", id: `permit-${record.normalized.permit.id}` },
  { record_type: "signal", id: `signal-${record.normalized.signal.id}` },
]);
const opportunities = records.flatMap((record) => {
  const trades = record.normalized.inferredTrades?.length ? record.normalized.inferredTrades : ["General"];
  return trades.map((trade) => {
    const horizon = classifyHorizon(record.normalized.project, record.normalized.signal);
    const revenue = record.normalized.revenueWindows?.[trade] ?? { low: null, high: null };
    const opportunityScore = scoreOpportunityRecord(record, horizon, trade);
    return {
      title: `${trade} opportunity: ${record.normalized.project.name}`,
      source: record.sourceName,
      projectId: record.normalized.project.id,
      trade,
      horizon,
      score: opportunityScore,
      revenue,
      nextAction: nextAction(record.normalized.project, horizon),
      evidence: [
        record.normalized.evidence.id,
        record.normalized.permit.id,
        record.normalized.signal.id,
      ],
      scoreExplanations: [
        `+30 normalized public source record from ${record.sourceName}`,
        horizon === "Fast Money" ? "+20 near-term or active bid/permit horizon" : "+12 planning/pipeline evidence",
        `+10 trade inferred as ${trade} from source text`,
      ],
    };
  });
}).sort((a, b) => b.score - a.score);

const report = [
  "# Sentinel Projects Intelligence Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `TOTAL PROJECTS: ${projects.length}`,
  `TOTAL SIGNALS: ${signals.length}`,
  `TOTAL EVIDENCE RECORDS: ${evidence.length}`,
  `TOTAL OPPORTUNITIES: ${opportunities.length}`,
  "",
  `FAST MONEY COUNT: ${opportunities.filter((item) => item.horizon === "Fast Money").length}`,
  `PIPELINE COUNT: ${opportunities.filter((item) => item.horizon === "Pipeline").length}`,
  `EARLY SIGNAL COUNT: ${opportunities.filter((item) => item.horizon === "Early Signals").length}`,
  "",
  "## Source Notes",
  ...caches.flatMap((cache) => [
    `- ${cache.sourceName}: ${(cache.records ?? []).length} records`,
    ...(cache.sourceNotes ?? []).map((note) => `  - ${note}`),
  ]),
  "",
  "## Top 25 Opportunities",
  ...opportunities.slice(0, 25).flatMap((opportunity, index) => [
    "",
    `${index + 1}. ${opportunity.title}`,
    `   Score: ${opportunity.score}`,
    `   Horizon: ${opportunity.horizon}`,
    `   Trade: ${opportunity.trade}`,
    `   Source: ${opportunity.source}`,
    `   Project: ${opportunity.projectId}`,
    `   Revenue: ${formatRevenue(opportunity.revenue)}`,
    `   Next Action: ${opportunity.nextAction}`,
    `   Evidence: ${opportunity.evidence.join(", ")}`,
    `   Explanation: ${opportunity.scoreExplanations.join("; ")}`,
  ]),
  "",
  "## Testing Guide",
  "",
  "- Home feed: http://localhost:3000/",
  "- Search Sacramento: http://localhost:3000/search?q=PHCR2026-00572",
  "- Search Placer: http://localhost:3000/search?q=Placer%20site%20work",
  "- Search SAM.gov: http://localhost:3000/search?q=SAM.gov%20fencing",
  "- Sacramento evidence page: http://localhost:3000/projects/sac-phcr2026-00572",
  "- Placer evidence pages use project ids beginning with placer- from the report above.",
  "- If SAM_GOV_API_KEY is not configured, SAM.gov search will correctly show no collected SAM.gov records.",
  "",
].join("\n");

const outputPath = resolve("reports/intelligence-summary.md");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, report);
console.log(`Wrote ${outputPath}`);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

function classifyHorizon(project, signal) {
  if (project.source_name === "SAM.gov Contract Opportunities") return "Fast Money";
  if (project.status === "Permitted" || signal.signal_type === "Permit") return "Fast Money";
  if (["Planning", "Approved", "Proposed"].includes(project.status)) return "Pipeline";
  return "Early Signals";
}

function scoreOpportunityRecord(record, horizon, trade) {
  let value = 40;
  if (horizon === "Fast Money") value += 25;
  if (horizon === "Pipeline") value += 15;
  if (record.normalized.evidence) value += 10;
  if (trade !== "General") value += 10;
  if (record.normalized.contactCompany) value += 8;
  if (record.normalized.signal.importance_score) value += Math.round(record.normalized.signal.importance_score / 10);
  return Math.min(100, value);
}

function nextAction(project, horizon) {
  if (horizon === "Fast Money") return "Verify bid or permit status and contact the listed applicant, buyer, or contractor immediately.";
  if (horizon === "Pipeline") return "Monitor permit issuance and identify applicant/developer before contractor selection closes.";
  return "Track source activity until planning or permit evidence matures.";
}

function formatRevenue(revenue) {
  if (!revenue?.low && !revenue?.high) return "Not estimated";
  return `$${Number(revenue.low ?? 0).toLocaleString()} - $${Number(revenue.high ?? revenue.low ?? 0).toLocaleString()}`;
}
