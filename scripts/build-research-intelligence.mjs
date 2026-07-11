import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildResearchIntelligenceSnapshot } from "../src/lib/research/breadcrumb-assembler.ts";

const opportunities = (await readJson("data/contractor_opportunities.json")) ?? [];
const snapshot = buildResearchIntelligenceSnapshot(opportunities);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });

await Promise.all([
  writeJson("data/research_intelligence.json", snapshot),
  writeFile(resolve("reports/research-intelligence.md"), renderReport(snapshot)),
]);

console.log(`Research atoms: ${snapshot.atom_count}`);
console.log(`Opportunity hypotheses: ${snapshot.hypothesis_count}`);
console.log(`Semantic index docs: ${snapshot.index_document_count}`);

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

function renderReport(snapshot) {
  const top = snapshot.hypotheses.slice(0, 20);
  return [
    "# Research Intelligence",
    "",
    `Generated: ${snapshot.generated_at}`,
    "",
    "## Summary",
    "",
    `- Atoms (breadcrumbs): ${snapshot.atom_count}`,
    `- Assembled hypotheses: ${snapshot.hypothesis_count}`,
    `- Semantic index documents: ${snapshot.index_document_count}`,
    "",
    "## Open-source patterns in use",
    "",
    ...snapshot.open_source_patterns.map((item) => `- **${item.name}** — ${item.role} (${item.url})`),
    "",
    "## Top opportunity hypotheses",
    "",
    ...top.flatMap((hyp) => [
      `### ${hyp.title}`,
      "",
      `- Confidence: ${hyp.confidence}`,
      `- Package: ${hyp.package_size}`,
      `- Trades: ${hyp.inferred_trades.join(", ") || "n/a"}`,
      `- Breadcrumbs: ${hyp.breadcrumb_ids.length}`,
      `- Why: ${hyp.why.join(" ")}`,
      "",
    ]),
  ].join("\n");
}
