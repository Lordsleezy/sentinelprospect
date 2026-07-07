import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "data");
const reportsDir = path.join(root, "reports");
fs.mkdirSync(reportsDir, { recursive: true });

const caches = ["sacramento-county-permits.json", "placer-county-records.json", "samgov-opportunities.json"]
  .map((file) => readJson(path.join(dataDir, file)))
  .filter(Boolean);

const records = caches.flatMap((cache) => cache.records ?? []);
const projects = records.map((record) => record.normalized?.project).filter(Boolean);
const evidence = records.map((record) => record.normalized?.evidence).filter(Boolean);
const contacts = records.map((record) => record.normalized?.contactCompany).filter(Boolean);
const duplicateGroups = groupBy(projects, (project) => canonicalKey(project));
const duplicates = [...duplicateGroups.values()].filter((items) => items.length > 1);
const missingContacts = records.filter((record) => !isActionableContact(record.normalized?.contactCompany));
const missingEvidence = records.filter((record) => !record.normalized?.evidence);
const missingLocations = projects.filter((project) => !project.address || !project.latitude || !project.longitude);
const confidenceBuckets = bucket(contacts.map(contactConfidence));
const sourceCounts = countBy(evidence, (item) => item.source_name ?? "Unknown");
const topCompanies = countBy(contacts, (contact) => normalizeName(contact.name ?? "Unknown"));
const placeholderRecords = records.filter((record) => isPlaceholderRecord(record));

writeReport("data-quality-report.md", [
  "# Data Quality Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Summary",
  "",
  `- Collected source records: ${records.length}`,
  `- Collected projects: ${projects.length}`,
  `- Duplicate project groups: ${duplicates.length}`,
  `- Records missing actionable contacts: ${missingContacts.length}`,
  `- Records missing evidence: ${missingEvidence.length}`,
  `- Records missing locations: ${missingLocations.length}`,
  `- Placeholder/fake-looking records detected: ${placeholderRecords.length}`,
  "",
  "## Project Resolution Statistics",
  "",
  `- Canonical project groups: ${duplicateGroups.size}`,
  `- Duplicate project records collapsed by name/address/applicant: ${duplicates.reduce((sum, items) => sum + items.length - 1, 0)}`,
  "",
  "## Contact Confidence Distribution",
  "",
  bucketLines(confidenceBuckets).join("\n"),
  "",
  "## Opportunity Score Distribution",
  "",
  "- Opportunity score is now gated by contact eligibility in contractor-facing views.",
  "- Records without actionable contacts remain internal and should not be treated as sellable opportunities.",
  "",
  "## Trade Confidence Distribution",
  "",
  "- Trade confidence should be calculated from evidence metadata and source text, not one-card-per-trade duplication.",
  "- Canonical project cards should aggregate all identified trades into one project view.",
  "",
  "## Fast Money Distribution",
  "",
  "- Fast Money requires near-term stage plus actionable contact. Permit-only records without contact should remain internal.",
]);

writeReport("contact-intelligence-report.md", [
  "# Contact Intelligence Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Coverage",
  "",
  `- Projects with any listed company/contact: ${contacts.length}`,
  `- Projects with actionable contact route: ${records.length - missingContacts.length}`,
  `- Projects missing actionable contacts: ${missingContacts.length}`,
  `- Contact coverage: ${percent(records.length - missingContacts.length, records.length)}`,
  "",
  "## Top Companies",
  "",
  topLines(topCompanies, 15).join("\n"),
  "",
  "## Top Developers",
  "",
  "- Developer extraction should be expanded from planning applications, staff reports, environmental reviews, and applicant fields.",
  "",
  "## Top Contact Sources",
  "",
  topLines(sourceCounts, 10).join("\n"),
  "",
  "## Contact Confidence Metrics",
  "",
  bucketLines(confidenceBuckets).join("\n"),
  "",
  "## Required Next Steps",
  "",
  "- Add entity resolution for LLC/corporation suffix variants.",
  "- Add decision-maker discovery from company websites, public filings, and team pages.",
  "- Store person-level roles such as Owner, President, Development Director, Construction Director, Project Manager, and Operations Manager.",
  "- Do not expose records with only placeholder, synthetic, or no-route contact data.",
]);

writeReport("trust-audit.md", [
  "# Platform Trust Audit",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Trust Standard",
  "",
  "A contractor should only see an opportunity when there is a real project, real evidence, real location, real contact path, and an explainable score.",
  "",
  "## Findings",
  "",
  `- No-contact/no-opportunity rule implemented in contractor-facing resolution layer.`,
  `- Duplicate trade cards should collapse into canonical project cards with all trades aggregated.`,
  `- Placeholder-looking records detected: ${placeholderRecords.length}`,
  `- Missing actionable contacts: ${missingContacts.length}`,
  "",
  "## Pages Reviewed",
  "",
  "- Home: should stay search-first and avoid dashboard metrics.",
  "- Search: should show only contractor-visible canonical projects.",
  "- Project detail: should show eligibility status, opportunity score, fast money score, contacts, evidence, and map last.",
  "- Dashboard: should remain supporting/internal.",
  "",
  "## Looks Generated/Fake/Low Confidence",
  "",
  "- Synthetic seed data with example.com/example.gov/555-style fields must remain internal or be clearly labeled.",
  "- Any score without visible contributors should be considered untrusted.",
  "- Any project with no contact route should not appear in contractor-facing opportunity results.",
  "",
  "## Would A Contractor Call This Lead?",
  "",
  missingContacts.length
    ? "- Not reliably yet for all records. Contact enrichment is the highest-priority blocker."
    : "- Yes for currently contractor-visible records.",
]);

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeReport(name, lines) {
  fs.writeFileSync(path.join(reportsDir, name), `${lines.join("\n")}\n`);
}

function groupBy(items, fn) {
  const groups = new Map();
  for (const item of items) {
    const key = fn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function countBy(items, fn) {
  const counts = new Map();
  for (const item of items) {
    const key = fn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function topLines(counts, limit) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => `- ${name}: ${count}`);
}

function bucket(values) {
  const buckets = { "0-49": 0, "50-64": 0, "65-79": 0, "80-100": 0 };
  for (const value of values) {
    const percentValue = Math.round(value * 100);
    if (percentValue < 50) buckets["0-49"] += 1;
    else if (percentValue < 65) buckets["50-64"] += 1;
    else if (percentValue < 80) buckets["65-79"] += 1;
    else buckets["80-100"] += 1;
  }
  return buckets;
}

function bucketLines(buckets) {
  return Object.entries(buckets).map(([range, count]) => `- ${range}%: ${count}`);
}

function canonicalKey(project) {
  return normalizeName([project.name, project.address, project.source_name].filter(Boolean).join(" "));
}

function normalizeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|company|co|limited|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contactConfidence(contact) {
  if (!contact) return 0;
  let confidence = 0.45;
  if (contact.phone) confidence += 0.15;
  if (contact.email) confidence += 0.15;
  if (contact.website) confidence += 0.1;
  if (contact.name) confidence += 0.1;
  if (isPlaceholderContact(contact)) confidence -= 0.4;
  return Math.max(0, Math.min(1, confidence));
}

function isActionableContact(contact) {
  return Boolean(contact && contact.name && !isPlaceholderContact(contact) && (contact.phone || contact.email || contact.website));
}

function isPlaceholderContact(contact) {
  const blob = [contact?.name, contact?.phone, contact?.email, contact?.website, contact?.notes].join(" ").toLowerCase();
  return isPlaceholderText(blob);
}

function isPlaceholderRecord(record) {
  const blob = JSON.stringify(record).toLowerCase();
  return isPlaceholderText(blob);
}

function isPlaceholderText(blob) {
  return [
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

function percent(value, total) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}
