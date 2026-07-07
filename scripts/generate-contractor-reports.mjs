import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const caches = await Promise.all([
  readJson("data/sacramento-county-permits.json"),
  readJson("data/placer-county-records.json"),
  readJson("data/samgov-opportunities.json"),
]);
const records = caches.flatMap((cache) => cache.records ?? []);
const opportunities = records.flatMap(toOpportunities).sort((a, b) => b.score - a.score);
const trades = ["Fencing", "Concrete", "Roofing", "Electrical", "HVAC"];

await mkdir(resolve("reports"), { recursive: true });

for (const trade of trades) {
  await writeFile(resolve(`reports/top-25-${slug(trade)}-opportunities.md`), renderTradeReport(trade, opportunities.filter((item) => item.trade === trade).slice(0, 25)));
}

await writeFile(resolve("reports/top-50-fence-opportunities.md"), renderTradeReport("Fencing", opportunities.filter((item) => item.trade === "Fencing").slice(0, 50)));
await writeFile(resolve("reports/contractor-validation-report.md"), renderValidationReport(opportunities));
await writeFile(resolve("reports/false-positive-review.md"), renderFalsePositiveReview(opportunities));
await writeFile(resolve("reports/test-urls-and-searches.md"), renderTestGuide(opportunities));

console.log("Wrote contractor reports to reports/");

function toOpportunities(record) {
  const trades = record.normalized.inferredTrades?.length ? record.normalized.inferredTrades : ["General"];
  return trades.map((trade) => {
    const project = record.normalized.project;
    const evidence = record.normalized.evidence;
    const horizon = classifyHorizon(project, record.normalized.signal);
    const revenue = estimateRevenue(record, trade);
    const contact = contactFor(record);
    const tradeEvidence = tradeReasons(record, trade);
    const score = scoreOpportunity(record, horizon, trade, tradeEvidence);
    return {
      title: `${trade} opportunity: ${project.name}`,
      projectId: project.id,
      source: record.sourceName,
      score,
      horizon,
      trade,
      contact,
      estimatedValue: revenue.label,
      estimatedLow: revenue.low,
      estimatedHigh: revenue.high,
      valueReasoning: revenue.reasoning,
      nextAction: nextAction(record, horizon),
      evidenceSummary: evidence.summary,
      evidenceIds: [evidence.id, record.normalized.permit.id, record.normalized.signal.id],
      tradeEvidence,
      confidence: confidence(record, tradeEvidence),
      falsePositiveRisk: falsePositiveRisk(record, tradeEvidence),
    };
  });
}

function renderTradeReport(trade, rows) {
  return [
    `# Top ${rows.length} ${trade} Opportunities`,
    "",
    ...rows.flatMap((row, index) => [
      `## ${index + 1}. ${row.title}`,
      "",
      `- Opportunity score: ${row.score}`,
      `- Horizon: ${row.horizon}`,
      `- Contact: ${row.contact.company || "Not listed"}`,
      `- Phone: ${row.contact.phone || "Not listed"}`,
      `- Email: ${row.contact.email || "Not listed"}`,
      `- Estimated value: ${row.estimatedValue}`,
      `- Next action: ${row.nextAction}`,
      `- Evidence summary: ${row.evidenceSummary}`,
      `- Trade evidence: ${row.tradeEvidence.map((item) => item.reason).join("; ") || "Weak trade evidence"}`,
      `- Source: ${row.source}`,
      `- Project URL: http://localhost:3000/projects/${row.projectId}`,
      "",
    ]),
  ].join("\n");
}

function renderValidationReport(rows) {
  return [
    "# Contractor Validation Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Total opportunities: ${rows.length}`,
    `Fast Money: ${rows.filter((item) => item.horizon === "Fast Money").length}`,
    `Pipeline: ${rows.filter((item) => item.horizon === "Pipeline").length}`,
    `Early Signals: ${rows.filter((item) => item.horizon === "Early Signals").length}`,
    "",
    "## Twin Rivers Fence Question",
    "",
    "Would a fencing contractor know who to call, why to call, when to call, and roughly how much the opportunity might be worth?",
    "",
    `- Fence opportunities with source-supported contact: ${rows.filter((item) => item.trade === "Fencing" && item.contact.company).length}`,
    `- Fence opportunities with estimated value: ${rows.filter((item) => item.trade === "Fencing" && item.estimatedValue !== "Not estimated").length}`,
    `- Fence opportunities with trade evidence: ${rows.filter((item) => item.trade === "Fencing" && item.tradeEvidence.length).length}`,
    `- Fence opportunities marked Fast Money: ${rows.filter((item) => item.trade === "Fencing" && item.horizon === "Fast Money").length}`,
    "",
    "## Top 10 Actionable Opportunities",
    ...rows.slice(0, 10).map((row, index) => `${index + 1}. ${row.title} | ${row.horizon} | ${row.estimatedValue} | ${row.nextAction}`),
    "",
  ].join("\n");
}

function renderFalsePositiveReview(rows) {
  const risky = rows.filter((row) => row.falsePositiveRisk !== "Low").slice(0, 50);
  return [
    "# False-Positive Review",
    "",
    "Conservative review flags opportunities with weak trade evidence, completed source status, or generic trade inference.",
    "",
    ...risky.flatMap((row, index) => [
      `## ${index + 1}. ${row.title}`,
      "",
      `- Risk: ${row.falsePositiveRisk}`,
      `- Score: ${row.score}`,
      `- Horizon: ${row.horizon}`,
      `- Source: ${row.source}`,
      `- Evidence: ${row.evidenceSummary}`,
      `- Recommendation: ${row.falsePositiveRisk === "High" ? "Review source before outreach." : "Use only if trade evidence matches contractor specialization."}`,
      "",
    ]),
  ].join("\n");
}

function renderTestGuide(rows) {
  const firstFence = rows.find((row) => row.trade === "Fencing");
  const firstPlacer = rows.find((row) => row.source.includes("Placer"));
  return [
    "# Test URLs And Recommended Searches",
    "",
    "## URLs",
    "",
    "- Home feed: http://localhost:3000/",
    "- Fence opportunities Sacramento: http://localhost:3000/search?q=Fence%20opportunities%20Sacramento",
    "- Fence opportunities within 6 months: http://localhost:3000/search?q=Fence%20opportunities%20within%206%20months",
    "- Commercial fence jobs: http://localhost:3000/search?q=Commercial%20fence%20jobs",
    "- Industrial fencing: http://localhost:3000/search?q=Industrial%20fencing",
    "- Warehouse fencing: http://localhost:3000/search?q=Warehouse%20fencing",
    "- Opportunities starting within 90 days: http://localhost:3000/search?q=Opportunities%20starting%20within%2090%20days",
    "- Fast money opportunities: http://localhost:3000/search?q=Fast%20money%20opportunities",
    "- Roseville fence work: http://localhost:3000/search?q=Roseville%20fence%20work",
    "- Rocklin fence work: http://localhost:3000/search?q=Rocklin%20fence%20work",
    "- Subdivision fencing: http://localhost:3000/search?q=Subdivision%20fencing",
    firstFence ? `- First fence evidence page: http://localhost:3000/projects/${firstFence.projectId}` : "",
    firstPlacer ? `- First Placer evidence page: http://localhost:3000/projects/${firstPlacer.projectId}` : "",
    "",
    "## Recommended Searches",
    "",
    "- Fence opportunities Sacramento",
    "- Fence opportunities within 6 months",
    "- Commercial fence jobs",
    "- Industrial fencing",
    "- Warehouse fencing",
    "- Opportunities starting within 90 days",
    "- Fast money opportunities",
    "- Roseville fence work",
    "- Rocklin fence work",
    "- Subdivision fencing",
    "",
  ].filter(Boolean).join("\n");
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

function classifyHorizon(project, signal) {
  if (project.source_name === "SAM.gov Contract Opportunities") return "Fast Money";
  if (project.status === "Permitted" || signal.signal_type === "Permit") return "Fast Money";
  if (["Planning", "Approved", "Proposed"].includes(project.status)) return "Pipeline";
  return "Early Signals";
}

function scoreOpportunity(record, horizon, trade, tradeEvidence) {
  let value = 35;
  if (horizon === "Fast Money") value += 25;
  if (horizon === "Pipeline") value += 15;
  if (record.normalized.evidence) value += 10;
  if (trade !== "General") value += 10;
  if (tradeEvidence.length) value += 12;
  if (record.normalized.contactCompany) value += 8;
  value += Math.round((record.normalized.signal.importance_score ?? 50) / 10);
  if (record.normalized.project.status === "Completed") value -= 30;
  return Math.max(0, Math.min(100, value));
}

function estimateRevenue(record, trade) {
  const window = record.normalized.revenueWindows?.[trade];
  if (window?.low || window?.high) {
    return { ...window, label: valueLabel(window.high ?? window.low), reasoning: ["Permit valuation", `${trade} source match`, record.normalized.project.project_type] };
  }
  return { low: null, high: null, label: "Not estimated", reasoning: ["No source valuation available"] };
}

function valueLabel(value) {
  if (!value) return "Not estimated";
  if (value < 25_000) return "Under $25k";
  if (value < 75_000) return "$25k-$75k";
  if (value < 250_000) return "$75k-$250k";
  if (value < 1_000_000) return "$250k-$1M";
  return "$1M+";
}

function contactFor(record) {
  const company = record.normalized.contactCompany;
  if (company && isSourceBackedCompanyName(company.name)) return { company: company.name, phone: company.phone, email: company.email };
  const contractor = record.normalized.evidence?.metadata?.contractor;
  if (typeof contractor === "string" && isSourceBackedCompanyName(contractor)) return { company: contractor.trim(), phone: null, email: null };
  const agency = record.normalized.evidence?.metadata?.agency;
  if (typeof agency === "string" && isSourceBackedCompanyName(agency)) return { company: agency.trim(), phone: null, email: null };
  return { company: null, phone: null, email: null };
}

function isSourceBackedCompanyName(name) {
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

function nextAction(record, horizon) {
  if (horizon === "Fast Money") return contactFor(record).company ? "Call the listed source-supported contact and verify whether the scope is open." : "Open source record and identify applicant or owner before outreach.";
  if (horizon === "Pipeline") return "Monitor permit issuance and contact applicant/developer before contractor selection closes.";
  return "Track source activity until planning or permit evidence matures.";
}

function tradeReasons(record, trade) {
  const text = `${record.normalized.project.name} ${record.normalized.project.description} ${record.normalized.evidence.summary}`.toLowerCase();
  const reasons = [];
  const add = (reason) => reasons.push({ reason });
  if (trade === "Fencing" && /subdivision|production home|master plan/.test(text)) add("Subdivision or production housing can require perimeter, phase, or yard fencing.");
  if (trade === "Fencing" && /industrial|warehouse|logistics|outdoor|storage/.test(text)) add("Industrial or warehouse use can require security perimeter fencing.");
  if (trade === "Fencing" && /demo|demolition/.test(text)) add("Demolition activity may require temporary safety fencing.");
  if (trade === "Concrete" && /foundation|footing|slab|pool|spa|site/.test(text)) add("Source text references concrete-adjacent scope such as foundations, slabs, pools, or site work.");
  if (trade === "Roofing" && /roof|tpo/.test(text)) add("Source text directly references roof work or roofing material.");
  if (trade === "Electrical" && /electric|solar|pv|battery|service/.test(text)) add("Source text directly references electrical, solar, battery, or service work.");
  if (trade === "HVAC" && /hvac|mechanical|heat pump/.test(text)) add("Source text directly references HVAC, mechanical, or heat pump work.");
  return reasons;
}

function confidence(record, tradeEvidence) {
  let value = 0.45;
  if (record.normalized.evidence) value += 0.2;
  if (record.normalized.signal.importance_score >= 80) value += 0.15;
  if (tradeEvidence.length) value += 0.15;
  if (record.normalized.contactCompany) value += 0.05;
  return Math.min(0.95, value);
}

function falsePositiveRisk(record, tradeEvidence) {
  if (record.normalized.project.status === "Completed") return "High";
  if (!tradeEvidence.length) return "Medium";
  if (confidence(record, tradeEvidence) < 0.65) return "Medium";
  return "Low";
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
