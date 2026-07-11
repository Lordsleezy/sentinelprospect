import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  classifyPlanningStage,
  inferLikelyTradesFromPlanningText,
} from "../src/lib/research/planning-signals.ts";

/**
 * Live planning collectors:
 * - Sacramento County PLANNING_PROJECTS MapServer (Planning Projects Viewer / ACT GIS)
 * - Placer County All_Active_Planning_Projects + Major Pre-Development ArcGIS layers
 */

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? "true"];
}));

const sacLimit = Number(args.get("sac-limit") ?? 150);
const placerLimit = Number(args.get("placer-limit") ?? 150);
const capturedAt = new Date().toISOString();

const SAC_URL = "https://mapservices.gis.saccounty.gov/arcgis/rest/services/PLANNING_PROJECTS/MapServer/0/query";
const PLACER_ACTIVE_URL = "https://services6.arcgis.com/PArfeTGcwA9RGNzN/arcgis/rest/services/All_Active_Planning_Projects/FeatureServer/5/query";
const PLACER_MAJOR_URL = "https://services6.arcgis.com/PArfeTGcwA9RGNzN/arcgis/rest/services/MajorPreDeveopmentProjects_ExportFeatures/FeatureServer/0/query";

const [sacFeatures, placerActive, placerMajor] = await Promise.all([
  queryArcGis(SAC_URL, {
    where: "ProjectStatus <> 'Closed' AND ProjectStatus <> 'Withdrawn'",
    outFields: [
      "CAPNumber", "ProjectName", "ProjectDescription", "ProjectStatus",
      "ProjectApplicant", "PropertyOwner", "Address", "APN", "Entitlement",
      "PlannerName", "PlannerEmail", "ApplicationFilingDate",
    ].join(","),
    orderByFields: "ApplicationFilingDate DESC",
    resultRecordCount: String(sacLimit),
    outSR: "4326",
    returnGeometry: "true",
    f: "json",
  }),
  queryArcGis(PLACER_ACTIVE_URL, {
    where: "General_Status = 'Open'",
    outFields: "*",
    orderByFields: "Open_Date DESC",
    resultRecordCount: String(placerLimit),
    outSR: "4326",
    returnGeometry: "true",
    f: "json",
  }),
  queryArcGis(PLACER_MAJOR_URL, {
    where: "1=1",
    outFields: "*",
    orderByFields: "Open_Date DESC",
    resultRecordCount: String(Math.min(placerLimit, 100)),
    outSR: "4326",
    returnGeometry: "true",
    f: "json",
  }),
]);

const signals = [
  ...sacFeatures.map((feature, index) => normalizeSacramento(feature, index)),
  ...placerActive.map((feature, index) => normalizePlacerActive(feature, index)),
  ...placerMajor.map((feature, index) => normalizePlacerMajor(feature, index)),
].filter(Boolean);

const deduped = dedupeSignals(signals);
const housingFirst = [...deduped].sort((a, b) => packageRank(b) - packageRank(a) || b.trades_likely.length - a.trades_likely.length);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });

const artifact = {
  generated_at: capturedAt,
  live: true,
  sources: [
    { name: "Sacramento County PLANNING_PROJECTS", url: SAC_URL, count: sacFeatures.length },
    { name: "Placer All_Active_Planning_Projects", url: PLACER_ACTIVE_URL, count: placerActive.length },
    { name: "Placer Major Pre-Development Projects", url: PLACER_MAJOR_URL, count: placerMajor.length },
  ],
  signal_count: housingFirst.length,
  development_count: housingFirst.filter((row) => row.package_hint === "development").length,
  commercial_count: housingFirst.filter((row) => row.package_hint === "commercial").length,
  signals: housingFirst,
};

await writeJson("data/planning_signals.json", artifact);
await writeFile(resolve("reports/planning-signals.md"), renderReport(artifact));

console.log(`Live planning signals: ${housingFirst.length}`);
console.log(`  Sacramento open projects: ${sacFeatures.length}`);
console.log(`  Placer active open: ${placerActive.length}`);
console.log(`  Placer major/pre-dev: ${placerMajor.length}`);
console.log(`  Development-scale: ${artifact.development_count}`);

async function queryArcGis(url, params) {
  const search = new URLSearchParams(params);
  const response = await fetch(`${url}?${search.toString()}`);
  if (!response.ok) throw new Error(`ArcGIS request failed (${response.status}) for ${url}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
  return payload.features ?? [];
}

function normalizeSacramento(feature, index) {
  const a = feature.attributes ?? {};
  const title = text(a.ProjectName) || text(a.CAPNumber) || `Sacramento planning project ${index + 1}`;
  const description = text(a.ProjectDescription);
  const entitlement = text(a.Entitlement);
  const status = text(a.ProjectStatus);
  const address = text(a.Address);
  const applicant = text(a.ProjectApplicant);
  const owner = text(a.PropertyOwner);
  const blob = `${title} ${description} ${entitlement} ${status} ${address}`;
  if (isNoise(blob)) return null;

  const packageHint = classifyPackageHint(blob, entitlement);
  const stage = classifyPlanningStage(`${status} ${entitlement} ${description} ${title}`);
  const trades = inferLikelyTradesFromPlanningText(blob);
  const developers = unique([applicant, owner].filter((value) => looksLikeOrg(value)));

  return {
    id: `sac-plan-${slug(text(a.CAPNumber) || title)}`,
    title,
    jurisdiction: "Sacramento County",
    source_name: "Sacramento County Planning Projects Viewer",
    source_url: `https://planningdocuments.saccounty.net/?control=${encodeURIComponent(text(a.CAPNumber))}`,
    stage,
    project_type: inferProjectType(blob),
    developers,
    location_text: address || "Sacramento County",
    city: cityFromAddress(address),
    county: "Sacramento County",
    summary: buildSummary(title, description, entitlement, status, "Sacramento County"),
    trades_likely: trades,
    package_hint: packageHint,
    captured_at: capturedAt,
    raw_excerpt: truncate(`${entitlement} · ${description || title}`),
    contact_name: text(a.PlannerName) || null,
    contact_email: text(a.PlannerEmail) || null,
    contact_phone: null,
    parcel: text(a.APN) || null,
    external_id: text(a.CAPNumber) || null,
    status,
    applicant,
    latitude: feature.geometry?.y ?? null,
    longitude: feature.geometry?.x ?? null,
  };
}

function normalizePlacerActive(feature, index) {
  const a = feature.attributes ?? {};
  const title = text(a.Project_name) || text(a.Permit_Number) || `Placer planning project ${index + 1}`;
  const description = text(a.Project_Description);
  const entitlement = text(a.Entitlements);
  const status = text(a.Application_Status) || text(a.General_Status);
  const address = text(a.Project_Address);
  const blob = `${title} ${description} ${entitlement} ${status} ${address} ${text(a.Project_Type)}`;
  if (isNoise(blob) && !/subdivision|tentative|rezone|specific plan|conditional use|major/i.test(blob)) return null;

  return {
    id: `placer-plan-${slug(text(a.Permit_Number) || title)}`,
    title,
    jurisdiction: "Placer County",
    source_name: "Placer County Active Planning Projects",
    source_url: "https://aca-prod.accela.com/PLACER",
    stage: classifyPlanningStage(`${status} ${entitlement} ${description} ${title}`),
    project_type: inferProjectType(blob),
    developers: unique([text(a.Applicant)].filter((value) => looksLikeOrg(value) || Boolean(value))),
    location_text: address || "Placer County",
    city: cityFromAddress(address),
    county: "Placer County",
    summary: buildSummary(title, description, entitlement, status, "Placer County"),
    trades_likely: inferLikelyTradesFromPlanningText(blob),
    package_hint: classifyPackageHint(blob, entitlement, text(a.Project_Type)),
    captured_at: capturedAt,
    raw_excerpt: truncate(`${entitlement} · ${description || title}`),
    contact_name: text(a.Project_Assigned_to) || null,
    contact_email: text(a.Project_Assigned_to_Email) || null,
    contact_phone: text(a.Project_Assigned_to_Phone) || null,
    parcel: text(a.APN) || null,
    external_id: text(a.Permit_Number) || null,
    status,
    applicant: text(a.Applicant),
    latitude: feature.geometry?.y ?? null,
    longitude: feature.geometry?.x ?? null,
  };
}

function normalizePlacerMajor(feature, index) {
  const a = feature.attributes ?? {};
  const title = text(a.Project_name) || text(a.Permit_Number) || `Placer major project ${index + 1}`;
  const description = text(a.Project_Description);
  const entitlement = text(a.Entitlements);
  const status = text(a.Application_Status);
  const blob = `${title} ${description} ${entitlement} ${status} ${text(a.Major_Project)}`;

  return {
    id: `placer-major-${slug(text(a.Permit_Number) || title)}`,
    title,
    jurisdiction: "Placer County",
    source_name: "Placer County Major Pre-Development Projects",
    source_url: "https://aca-prod.accela.com/PLACER",
    stage: classifyPlanningStage(`${status} ${entitlement} ${description} ${title}`),
    project_type: inferProjectType(blob),
    developers: unique([text(a.Applicant)].filter(Boolean)),
    location_text: "Placer County",
    city: null,
    county: "Placer County",
    summary: buildSummary(title, description, entitlement, status, "Placer County"),
    trades_likely: inferLikelyTradesFromPlanningText(blob),
    package_hint: /major|subdivision|commerce|industrial park|specific plan/i.test(blob) ? "development" : classifyPackageHint(blob, entitlement),
    captured_at: capturedAt,
    raw_excerpt: truncate(`${entitlement} · ${description || title}`),
    contact_name: text(a.Project_Assigned_to) || null,
    contact_email: null,
    contact_phone: null,
    parcel: text(a.APN) || null,
    external_id: text(a.Permit_Number) || null,
    status,
    applicant: text(a.Applicant),
    latitude: null,
    longitude: null,
  };
}

function classifyPackageHint(blob, entitlement = "", projectType = "") {
  const textBlob = `${blob} ${entitlement} ${projectType}`.toLowerCase();
  if (/\b(short[-\s]?term rental|strp|sign permit|banner|fence height|adu)\b/.test(textBlob) && !/\bsubdivision|tentative|master plan|specific plan\b/.test(textBlob)) {
    return "small";
  }
  if (/\b(subdivision|tentative(?:\s+subdivision)?\s+map|large lot|master plan|specific plan|planned development|villages?\s+at|commerce center|industrial park|multifamily|apartment|production home)\b/.test(textBlob)) {
    return "development";
  }
  if (/\b(rezone|general plan amendment|community plan|conditional use|design review|commercial|industrial|warehouse)\b/.test(textBlob)) {
    return "commercial";
  }
  return "unknown";
}

function inferProjectType(blob) {
  const textBlob = blob.toLowerCase();
  if (/\b(industrial|warehouse|commerce center)\b/.test(textBlob)) return "industrial";
  if (/\b(commercial|retail|office|tenant)\b/.test(textBlob)) return "commercial";
  if (/\b(subdivision|residential|home|housing|apartment|multifamily|single[-\s]?family)\b/.test(textBlob)) return "residential";
  if (/\b(utility|road|bridge|infrastructure)\b/.test(textBlob)) return "infrastructure";
  return "unknown";
}

function isNoise(blob) {
  return /\b(short[-\s]?term rental|str permit|strp|install two non-illuminated|building signs? only)\b/i.test(blob);
}

function buildSummary(title, description, entitlement, status, jurisdiction) {
  const bits = [
    `${title} is an early-stage planning record in ${jurisdiction}`,
    status ? `(${status})` : null,
    entitlement ? `covering ${entitlement.replace(/;\s*$/, "")}` : null,
    description ? `— ${truncate(description, 160)}` : "— details still thin, which often means contractors are not locked yet.",
  ].filter(Boolean);
  return bits.join(" ");
}

function looksLikeOrg(value) {
  return /\b(llc|inc|corp|company|homes|developers?|builders?|partners|group|holdings)\b/i.test(value || "");
}

function cityFromAddress(address) {
  if (!address) return null;
  const match = address.match(/,\s*([A-Za-z .'-]+),\s*CA\b/i);
  return match?.[1]?.trim() || null;
}

function packageRank(signal) {
  return signal.package_hint === "development" ? 3 : signal.package_hint === "commercial" ? 2 : signal.package_hint === "unknown" ? 1 : 0;
}

function dedupeSignals(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.jurisdiction}|${(row.external_id || row.title).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function unique(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function truncate(value, max = 180) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function renderReport(artifact) {
  const top = artifact.signals.filter((row) => row.package_hint === "development").slice(0, 25);
  return [
    "# Planning Signals (Live)",
    "",
    `Generated: ${artifact.generated_at}`,
    "",
    "## Summary",
    "",
    `- Total signals: ${artifact.signal_count}`,
    `- Development-scale: ${artifact.development_count}`,
    `- Commercial-scale: ${artifact.commercial_count}`,
    "",
    "## Sources",
    "",
    ...artifact.sources.map((source) => `- ${source.name}: ${source.count} raw features`),
    "",
    "## Top development / housing packages",
    "",
    ...top.flatMap((signal) => [
      `### ${signal.title}`,
      "",
      `- ${signal.jurisdiction} · ${signal.stage} · ${signal.package_hint}`,
      `- Trades: ${signal.trades_likely.join(", ") || "n/a"}`,
      `- Contact: ${[signal.contact_name, signal.contact_phone, signal.contact_email].filter(Boolean).join(" · ") || "research only"}`,
      `- ${signal.summary}`,
      "",
    ]),
  ].join("\n");
}

async function writeJson(file, value) {
  await writeFile(resolve(file), `${JSON.stringify(value, null, 2)}\n`);
}
