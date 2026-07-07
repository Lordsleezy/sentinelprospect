import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const cacheFiles = [
  "data/sacramento-county-permits.json",
  "data/placer-county-records.json",
  "data/samgov-opportunities.json",
];

const caches = (await Promise.all(cacheFiles.map(readJson))).filter(Boolean);
const records = caches.flatMap((cache) => cache.records ?? []);
const audits = records.map(auditRecord);
const visible = audits.filter((audit) => audit.trust.visible);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(resolve(file), "utf8"));
  } catch {
    return null;
  }
}

function auditRecord(record) {
  const normalized = record.normalized ?? {};
  const project = normalized.project ?? {};
  const permit = normalized.permit ?? {};
  const signal = normalized.signal ?? {};
  const evidence = normalized.evidence ? [normalized.evidence, permit, signal].filter(Boolean) : [];
  const contact = normalizeContact(normalized.contactCompany);
  const trades = Array.isArray(normalized.inferredTrades) && normalized.inferredTrades.length ? normalized.inferredTrades : ["General"];
  const authority = inferAwardingAuthority(record, contact);
  const packages = trades.map((trade) => inferPackage(record, trade, evidence.length));
  const locationPresent = Boolean(project.address && project.city && project.county && project.latitude && project.longitude);
  const evidenceCount = evidence.length;
  const hasPackageEstimate = packages.some((item) => item.enoughEvidence);
  const trustMissing = [];

  if (!project.name || !project.id) trustMissing.push("Missing project identity");
  if (!locationPresent) trustMissing.push("Missing usable location");
  if (!evidenceCount) trustMissing.push("Missing source evidence");
  if (!contact.actionable) trustMissing.push("No actionable contact route");
  if (authority.status === "Unknown") trustMissing.push("Unknown awarding authority");
  if (!hasPackageEstimate) trustMissing.push("Insufficient package availability evidence");

  return {
    sourceName: record.sourceName ?? record.source_name ?? "Unknown source",
    sourceUrl: record.sourceUrl ?? normalized.evidence?.source_url ?? project.source_url ?? null,
    project,
    permit,
    signal,
    evidenceCount,
    contact,
    authority,
    packages,
    trust: {
      visible: trustMissing.length === 0,
      missing: trustMissing,
    },
  };
}

function normalizeContact(company) {
  if (!company || !isSourceBackedName(company.name)) {
    return {
      company: null,
      role: null,
      phone: null,
      email: null,
      website: null,
      confidence: 0,
      actionable: false,
      reason: "No source-backed company/contact.",
    };
  }

  const hasRoute = Boolean(company.phone || company.email || company.website);
  let confidence = 0.45;
  if (company.notes) confidence += 0.1;
  if (hasRoute) confidence += 0.25;
  if (company.role) confidence += 0.05;
  confidence = Math.min(0.9, confidence);

  return {
    company: company.name,
    role: company.role ?? company.company_type ?? "Contact",
    phone: company.phone ?? null,
    email: company.email ?? null,
    website: company.website ?? null,
    confidence,
    actionable: confidence >= 0.65 && hasRoute,
    reason: hasRoute ? "Source-backed contact with outreach route." : "Source-backed company but no phone, email, or website.",
  };
}

function inferAwardingAuthority(record, contact) {
  const metadata = record.normalized?.evidence?.metadata ?? {};
  const sourceName = String(record.sourceName ?? record.normalized?.evidence?.source_name ?? "");
  const agency = text(metadata.agency) || (sourceName.toLowerCase().includes("sam.gov") ? sourceName : null);
  const projectType = text(record.normalized?.project?.project_type);

  if (isSourceBackedName(agency)) {
    return {
      status: "Public Agency",
      candidate: agency,
      confidence: 0.72,
      evidence: "Agency or public-buyer metadata is present.",
    };
  }

  if (contact.company && ["contractor", "general contractor"].includes(String(contact.role).toLowerCase())) {
    return {
      status: "General Contractor Candidate",
      candidate: contact.company,
      confidence: 0.55,
      evidence: "A contractor is listed on the source record, but subcontractor-award control is not verified.",
    };
  }

  if (projectType === "Government") {
    return {
      status: "Public Agency Candidate",
      candidate: sourceName || "Unknown public agency",
      confidence: 0.45,
      evidence: "Government project type implies public control, but buyer is not extracted.",
    };
  }

  return {
    status: "Unknown",
    candidate: null,
    confidence: 0,
    evidence: "No developer, owner, procurement contact, GC, CM, or public buyer candidate was extracted.",
  };
}

function inferPackage(record, trade, evidenceCount) {
  const project = record.normalized?.project ?? {};
  const contact = normalizeContact(record.normalized?.contactCompany);
  const status = text(project.status);
  const permitStatus = text(record.normalized?.permit?.permit_status);
  const valueWindow = record.normalized?.revenueWindows?.[trade];
  const hasTradeSignal = trade !== "General";
  const enoughEvidence = evidenceCount >= 2 && hasTradeSignal;
  let availability = "Unknown";
  let confidence = 0.2;
  const reasons = [];

  if (!hasTradeSignal) reasons.push("No specific trade package was inferred.");
  if (evidenceCount) reasons.push(`${evidenceCount} evidence item(s) available.`);
  if (valueWindow?.low || valueWindow?.high) reasons.push("Permit valuation supports a package value estimate.");

  if (["Completed", "Finaled"].includes(status) || /final|complete/i.test(permitStatus)) {
    availability = "Likely Awarded";
    confidence = 0.68;
    reasons.push("Project or permit is completed/finaled.");
  } else if (contact.company && /issued|permitted|under construction/i.test(`${status} ${permitStatus}`)) {
    availability = "Likely Awarded";
    confidence = 0.6;
    reasons.push("A contractor is already listed on an issued or active permit.");
  } else if (/submitted|review|received|planning|proposed|approved/i.test(`${status} ${permitStatus}`)) {
    availability = enoughEvidence ? "Likely Available" : "Unknown";
    confidence = enoughEvidence ? 0.55 : 0.3;
    reasons.push("Planning/review stage suggests possible availability, but no award evidence was found.");
  }

  return {
    trade,
    availability,
    enoughEvidence,
    confidence,
    reasons,
  };
}

function renderContactCoverage(rows) {
  const withSourceBacked = rows.filter((row) => row.contact.company);
  const actionable = rows.filter((row) => row.contact.actionable);
  const noRoute = rows.filter((row) => row.contact.company && !row.contact.actionable);
  const hidden = rows.filter((row) => !row.trust.visible);

  return [
    "# Contact Coverage",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Source-backed project records audited: ${rows.length}`,
    `- Records with source-backed company/contact candidate: ${withSourceBacked.length}`,
    `- Records with actionable contact route: ${actionable.length}`,
    `- Records with company but no phone/email/website route: ${noRoute.length}`,
    `- Records hidden by trust requirements: ${hidden.length}`,
    "",
    "## Actionable Contacts",
    "",
    actionable.length ? table(actionable, contactColumns) : "_No records currently have an actionable contact route._",
    "",
    "## Company Listed But Not Actionable",
    "",
    table(noRoute.slice(0, 75), contactColumns),
    "",
    "## No Contact Candidate",
    "",
    table(rows.filter((row) => !row.contact.company).slice(0, 75), basicColumns),
  ].join("\n");
}

function renderAwardingAuthorityCoverage(rows) {
  const known = rows.filter((row) => row.authority.status !== "Unknown");
  const unknown = rows.filter((row) => row.authority.status === "Unknown");
  return [
    "# Awarding Authority Coverage",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Records audited: ${rows.length}`,
    `- Records with awarding authority candidates: ${known.length}`,
    `- Records with unknown awarding authority: ${unknown.length}`,
    "",
    "## Candidate Coverage",
    "",
    table(known, authorityColumns),
    "",
    "## Unknown Awarding Authority",
    "",
    table(unknown.slice(0, 100), authorityColumns),
  ].join("\n");
}

function renderPackageCoverage(rows) {
  const packages = rows.flatMap((row) => row.packages.map((pkg) => ({ ...pkg, row })));
  const enough = packages.filter((pkg) => pkg.enoughEvidence);
  const byStatus = countBy(packages, (pkg) => pkg.availability);
  return [
    "# Package Intelligence Coverage",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Records audited: ${rows.length}`,
    `- Trade package rows inferred: ${packages.length}`,
    `- Package rows with enough evidence to estimate availability: ${enough.length}`,
    `- Package rows without enough evidence: ${packages.length - enough.length}`,
    "",
    "## Availability Status Counts",
    "",
    countLines(byStatus).join("\n"),
    "",
    "## Package Evidence",
    "",
    table(packages, packageColumns),
  ].join("\n");
}

function renderVisibleOpportunities(visibleRows, allRows) {
  const opportunities = visibleRows.flatMap((row) =>
    row.packages.map((pkg) => ({
      row,
      pkg,
    })),
  );

  return [
    "# Contractor Visible Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Project records audited: ${allRows.length}`,
    `- Records passing trust requirements: ${visibleRows.length}`,
    `- Visible opportunity rows: ${opportunities.length}`,
    "",
    visibleRows.length
      ? table(opportunities, visibleColumns)
      : "_No current records pass all trust requirements. The main blockers are missing actionable contact routes and unknown awarding authority._",
    "",
    "## Hidden Records By Trust Failure",
    "",
    table(allRows.filter((row) => !row.trust.visible), trustColumns),
  ].join("\n");
}

const basicColumns = [
  ["Project", (row) => row.project.name],
  ["Location", location],
  ["Source", (row) => row.sourceName],
  ["Evidence", (row) => row.evidenceCount],
];

const contactColumns = [
  ["Project", (row) => row.project.name],
  ["Location", location],
  ["Contact", (row) => row.contact.company ?? "Unknown"],
  ["Role", (row) => row.contact.role ?? "Unknown"],
  ["Confidence", (row) => pct(row.contact.confidence)],
  ["Actionable", (row) => yesNo(row.contact.actionable)],
  ["Reason", (row) => row.contact.reason],
];

const authorityColumns = [
  ["Project", (row) => row.project.name],
  ["Location", location],
  ["Awarding Authority", (row) => row.authority.status],
  ["Candidate", (row) => row.authority.candidate ?? "Unknown"],
  ["Confidence", (row) => pct(row.authority.confidence)],
  ["Evidence", (row) => row.authority.evidence],
];

const packageColumns = [
  ["Project", (item) => item.row.project.name],
  ["Location", (item) => location(item.row)],
  ["Trade", (item) => item.trade],
  ["Availability Status", (item) => item.availability],
  ["Enough Evidence", (item) => yesNo(item.enoughEvidence)],
  ["Confidence", (item) => pct(item.confidence)],
  ["Evidence Count", (item) => item.row.evidenceCount],
  ["Reason", (item) => item.reasons.join("; ")],
];

const visibleColumns = [
  ["Project Name", (item) => item.row.project.name],
  ["Location", (item) => location(item.row)],
  ["Trade", (item) => item.pkg.trade],
  ["Contact Confidence", (item) => pct(item.row.contact.confidence)],
  ["Awarding Authority", (item) => `${item.row.authority.status}: ${item.row.authority.candidate}`],
  ["Availability Status", (item) => item.pkg.availability],
  ["Evidence Count", (item) => item.row.evidenceCount],
];

const trustColumns = [
  ["Project", (row) => row.project.name],
  ["Location", location],
  ["Contact Confidence", (row) => pct(row.contact.confidence)],
  ["Awarding Authority", (row) => row.authority.status],
  ["Evidence Count", (row) => row.evidenceCount],
  ["Hidden Because", (row) => row.trust.missing.join("; ")],
];

function table(rows, columns) {
  if (!rows.length) return "_None._";
  const header = `| ${columns.map(([name]) => name).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map(([, getter]) => escapeCell(getter(row))).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function location(row) {
  return [row.project.city, row.project.county, row.project.state].filter(Boolean).join(", ") || row.project.address || "Unknown";
}

function escapeCell(value) {
  return String(value ?? "Unknown").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function countBy(items, fn) {
  const counts = new Map();
  for (const item of items) {
    const key = fn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function countLines(counts) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `- ${name}: ${count}`);
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

await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeFile(resolve("reports/contact-coverage.md"), renderContactCoverage(audits)),
  writeFile(resolve("reports/awarding-authority-coverage.md"), renderAwardingAuthorityCoverage(audits)),
  writeFile(resolve("reports/package-intelligence-coverage.md"), renderPackageCoverage(audits)),
  writeFile(resolve("reports/contractor-visible-opportunities.md"), renderVisibleOpportunities(visible, audits)),
]);

console.log(`Audited ${audits.length} source-backed project records.`);
console.log(`Contractor-visible opportunities: ${visible.length}.`);
