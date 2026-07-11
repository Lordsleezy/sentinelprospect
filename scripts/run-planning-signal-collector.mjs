import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectorConfigs } from "../collectors/sources.ts";
import {
  classifyPlanningStage,
  inferLikelyTradesFromPlanningText,
} from "../src/lib/research/planning-signals.ts";

/**
 * Planning signal collector scaffold.
 *
 * Real adapters should replace seedRecords() with ACT / Accela / city agenda parsers.
 * Until then this writes the schema + seed breadcrumbs so the research engine can evolve.
 */

const capturedAt = new Date().toISOString();
const planningSources = collectorConfigs.filter((config) => /planning|permit and planning|community development|development services/i.test(`${config.sourceType} ${config.notes}`));

const signals = [
  ...seedRecords(),
  ...planningSources.map((source) => stubSignalForSource(source)),
];

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await writeJson("data/planning_signals.json", {
  generated_at: capturedAt,
  source_count: planningSources.length,
  enabled_live_collectors: planningSources.filter((source) => source.enabled).length,
  signal_count: signals.length,
  signals,
  next_adapters: planningSources.map((source) => ({
    source: source.sourceName,
    url: source.baseUrl,
    enabled: source.enabled,
    notes: source.notes,
  })),
});
await writeFile(resolve("reports/planning-signals.md"), renderReport(signals, planningSources));

console.log(`Planning signals: ${signals.length}`);
console.log(`Planning portals catalogued: ${planningSources.length} (${planningSources.filter((s) => s.enabled).length} enabled)`);

function seedRecords() {
  const seeds = [
    {
      title: "Villages at Elder Creek — master plan / production housing package",
      jurisdiction: "Sacramento County",
      source_name: "Sacramento County Public Records",
      source_url: "https://actonline.saccounty.gov",
      location_text: "Elder Creek, Sacramento",
      city: "Sacramento",
      county: "Sacramento County",
      summary: "Housing development package with subdivision cues. Early pursuit window before trade contractors lock in.",
      developers: ["Lennar"],
      project_type: "residential",
      package_hint: "development",
      raw_excerpt: "Villages at Elder Creek Unit production housing subdivision master plan",
    },
    {
      title: "Gerber Creek / Lelani Village subdivisions — site development",
      jurisdiction: "Sacramento County",
      source_name: "Sacramento County Public Records",
      source_url: "https://actonline.saccounty.gov",
      location_text: "Sacramento County",
      city: null,
      county: "Sacramento County",
      summary: "Linked subdivision package. Strong candidate for fencing, concrete, site work, and landscaping before vertical trades saturate.",
      developers: [],
      project_type: "residential",
      package_hint: "development",
      raw_excerpt: "Gerber Creek and Lelani Village Subdivisions grading drainage fencing perimeter",
    },
    {
      title: "Northlake 36 Homes — planned residential community",
      jurisdiction: "Sacramento",
      source_name: "Sacramento County Public Records",
      source_url: "https://actonline.saccounty.gov",
      location_text: "North Natomas, Sacramento",
      city: "North Natomas",
      county: "Sacramento",
      summary: "Named housing community still producing lot/permit breadcrumbs. Chase developer for package awards.",
      developers: [],
      project_type: "residential",
      package_hint: "development",
      raw_excerpt: "Northlake 36 Homes subdivision residential community",
    },
  ];

  return seeds.map((seed, index) => {
    const blob = `${seed.title} ${seed.summary} ${seed.raw_excerpt}`;
    return {
      id: `planning-seed-${index + 1}`,
      title: seed.title,
      jurisdiction: seed.jurisdiction,
      source_name: seed.source_name,
      source_url: seed.source_url,
      stage: classifyPlanningStage(blob),
      project_type: seed.project_type,
      developers: seed.developers,
      location_text: seed.location_text,
      city: seed.city,
      county: seed.county,
      summary: seed.summary,
      trades_likely: inferLikelyTradesFromPlanningText(blob),
      package_hint: seed.package_hint,
      captured_at: capturedAt,
      raw_excerpt: seed.raw_excerpt,
    };
  });
}

function stubSignalForSource(source) {
  return {
    id: `planning-stub-${slug(source.sourceName)}`,
    title: `${source.jurisdiction} planning portal — adapter pending`,
    jurisdiction: source.jurisdiction,
    source_name: source.sourceName,
    source_url: source.baseUrl,
    stage: "unknown",
    project_type: "unknown",
    developers: [],
    location_text: source.jurisdiction,
    city: null,
    county: source.jurisdiction.includes("County") ? source.jurisdiction : null,
    summary: `Collector stub for ${source.sourceName}. ${source.notes}`,
    trades_likely: [],
    package_hint: "unknown",
    captured_at: capturedAt,
    raw_excerpt: null,
  };
}

function renderReport(signals, sources) {
  return [
    "# Planning Signals",
    "",
    `Generated: ${capturedAt}`,
    "",
    "## Status",
    "",
    `- Catalogued planning portals: ${sources.length}`,
    `- Enabled live collectors: ${sources.filter((source) => source.enabled).length}`,
    `- Seed + stub signals: ${signals.length}`,
    "",
    "## Why this exists",
    "",
    "Permit-only inventory misses housing/commercial jobs while they are still in entitlement, tentative map, CEQA, or plan-check — the window when contractors are not locked yet.",
    "",
    "## Next adapters",
    "",
    ...sources.map((source) => `- **${source.sourceName}** (${source.enabled ? "enabled" : "disabled"}): ${source.baseUrl}`),
    "",
    "## Current signals",
    "",
    ...signals.map((signal) => [
      `### ${signal.title}`,
      "",
      `- Stage: ${signal.stage}`,
      `- Package: ${signal.package_hint}`,
      `- Trades likely: ${signal.trades_likely.join(", ") || "n/a"}`,
      `- ${signal.summary}`,
      "",
    ].join("\n")),
  ].join("\n");
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function writeJson(file, value) {
  await writeFile(resolve(file), `${JSON.stringify(value, null, 2)}\n`);
}
