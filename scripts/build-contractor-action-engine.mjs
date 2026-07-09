import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const contractorOpportunities = await readJson("data/contractor_opportunities.json") ?? [];
const opportunityContacts = await readJson("data/opportunity_contacts.json") ?? [];
const companyHumanContacts = await readJson("data/company_human_contacts.json") ?? [];
const capturedAt = new Date().toISOString();

const contactsByOpportunity = new Map(opportunityContacts.map((row) => [row.opportunity_id, row]));
const contactsByProjectName = new Map(opportunityContacts.map((row) => [normalizeKey(row.project_name), row]));
const companyContactsByName = new Map(companyHumanContacts.map((row) => [normalizeKey(row.company), row]));

const contractor_action_opportunities = contractorOpportunities
  .map(buildActionOpportunity)
  .sort((a, b) => b.actionability_score - a.actionability_score || b.contractor_opportunity_score - a.contractor_opportunity_score);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/contractor_action_opportunities.json", contractor_action_opportunities),
  writeFile(resolve("reports/contractor-action-engine.md"), renderActionEngine(contractor_action_opportunities)),
  writeFile(resolve("reports/actionable-contractor-opportunities.md"), renderActionable(contractor_action_opportunities)),
]);

console.log(`Contractor action opportunities: ${contractor_action_opportunities.length}.`);
console.log(`Actionability 70+: ${contractor_action_opportunities.filter((row) => row.actionability_score >= 70).length}.`);
console.log(`Phone-backed opportunities: ${contractor_action_opportunities.filter((row) => row.best_contact?.phone).length}.`);

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

function buildActionOpportunity(opportunity) {
  const contactRoute = contactsByOpportunity.get(opportunity.id) ?? contactsByProjectName.get(normalizeKey(opportunity.project_name));
  const companyContacts = [
    companyContactsByName.get(normalizeKey(opportunity.general_contractor)),
    companyContactsByName.get(normalizeKey(opportunity.developer)),
    companyContactsByName.get(normalizeKey(opportunity.architect)),
  ].filter(Boolean);
  const contacts = dedupeContacts([
    ...(contactRoute?.contacts ?? []),
    ...companyContacts.flatMap((row) => row.contacts ?? []),
  ]).sort(compareContacts);
  const bestContact = contacts[0] ?? contactRoute?.best_contact ?? null;
  const accessPath = accessPathFor(opportunity, bestContact);
  const likelyScope = likelyScopeFor(opportunity);
  const score = actionabilityScoreFor(opportunity, bestContact, accessPath);
  const recommendedAction = recommendedActionFor(opportunity, bestContact, accessPath, likelyScope);

  return {
    opportunity_id: opportunity.id,
    project_name: opportunity.project_name,
    primary_contractor_trade: opportunity.primary_contractor_trade,
    contractor_opportunity_score: opportunity.contractor_opportunity_score,
    actionability_score: score,
    developer: known(opportunity.developer),
    general_contractor: known(opportunity.general_contractor),
    architect: known(opportunity.architect),
    best_contact: bestContact,
    contact_candidates: contacts,
    access_path: accessPath,
    likely_scope: likelyScope,
    recommended_action: recommendedAction,
    outreach_script: outreachScriptFor(opportunity, bestContact, likelyScope),
    populated_fields: populatedFields(opportunity, bestContact, accessPath),
    missing_intelligence: missingIntelligence(opportunity, bestContact, accessPath),
    source_url: opportunity.source_url,
    permit_source_available: Boolean(opportunity.source_url && opportunity.source_url !== "Unknown"),
    last_verified: capturedAt,
  };
}

function actionabilityScoreFor(opportunity, contact, accessPath) {
  let score = 0;
  if (known(opportunity.developer)) score += 14;
  if (known(opportunity.general_contractor)) score += 16;
  if (known(opportunity.architect)) score += 6;
  if (contact) score += 18;
  if (contact?.phone) score += 22;
  if (contact?.email) score += 14;
  if (accessPath.type === "Bid portal" || accessPath.type === "Public works" || accessPath.type === "Plan room") score += 16;
  if (accessPath.type !== "Unknown") score += 10;
  if (opportunity.procurement_route && opportunity.procurement_route !== "Unknown") score += 8;
  if (opportunity.source_url && opportunity.source_url !== "Unknown") score += 8;
  return Math.min(100, score);
}

function accessPathFor(opportunity, contact) {
  const route = firstKnown(opportunity.procurement_route, opportunity.access_route, contact?.source);
  if (contact?.company && normalizeKey(contact.company) === normalizeKey(opportunity.general_contractor)) return { type: "Direct GC", value: route };
  if (contact?.company && normalizeKey(contact.company) === normalizeKey(opportunity.developer)) return { type: "Developer", value: route };
  if (/bid_portal|bid portal/i.test(route)) return { type: "Bid portal", value: route };
  if (/public|procurement/i.test(route)) return { type: "Public works", value: route };
  if (/plan.?room/i.test(route)) return { type: "Plan room", value: route };
  if (/trade_partner|trade partner|subcontractor/i.test(route)) return { type: "Subcontractor network", value: route };
  if (route !== "Unknown") return { type: "Developer", value: route };
  return { type: "Unknown", value: "Unknown" };
}

function likelyScopeFor(opportunity) {
  const text = `${opportunity.project_name} ${opportunity.trade} ${opportunity.qualification_reason}`.toLowerCase();
  const fenceRelevant = opportunity.primary_contractor_trade === "Fencing" || /fenc|gate|perimeter|security/.test(text);
  if (!fenceRelevant) return `${opportunity.primary_contractor_trade} scope`;
  if (/park/.test(text)) return "Park fencing";
  if (/school/.test(text)) return "School perimeter fencing";
  if (/utility|drainage|trunk|corridor/.test(text)) return "Utility corridor fencing";
  if (/industrial|security|warehouse/.test(text)) return "Security fencing";
  if (/subdivision|village|master plan|lot|unit|homes|residential/.test(text)) return "Residential perimeter fencing";
  if (/gate/.test(text)) return "Gates";
  if (/retaining|wall/.test(text)) return "Retaining wall interface";
  if (opportunity.primary_contractor_trade === "Fencing") return "Construction fencing";
  return "Unknown";
}

function recommendedActionFor(opportunity, contact, accessPath, likelyScope) {
  const scope = likelyScope !== "Unknown" ? `${likelyScope.toLowerCase()} ` : "";
  if (contact?.phone) {
    return `Call ${contact.name ?? contact.company} and ask for the site development, estimating, or purchasing department regarding ${scope}opportunities for ${cleanProjectName(opportunity.project_name)}.`;
  }
  if (contact?.email) {
    return `Email ${contact.name ?? contact.company} and ask who handles subcontractor pricing for ${scope}work on ${cleanProjectName(opportunity.project_name)}.`;
  }
  if (accessPath.type !== "Unknown") {
    return `Use the ${accessPath.type.toLowerCase()} access path for ${cleanProjectName(opportunity.project_name)} and ask how subcontractors should be considered for ${scope || "trade "}work.`;
  }
  return `Research the developer or general contractor for ${cleanProjectName(opportunity.project_name)} before outreach.`;
}

function outreachScriptFor(opportunity, contact, likelyScope) {
  const company = contact?.company ?? firstKnown(opportunity.general_contractor, opportunity.developer, "your project team");
  const scope = likelyScope !== "Unknown" ? likelyScope.toLowerCase() : `${opportunity.primary_contractor_trade.toLowerCase()} scope`;
  return `Hi, this is [Name] with [Company]. I'm calling about ${cleanProjectName(opportunity.project_name)}. I saw source evidence for the project and wanted to ask who handles ${scope} or subcontractor pricing for ${company}.`;
}

function populatedFields(opportunity, contact, accessPath) {
  return {
    developer: known(opportunity.developer) ? opportunity.developer : undefined,
    general_contractor: known(opportunity.general_contractor) ? opportunity.general_contractor : undefined,
    architect: known(opportunity.architect) ? opportunity.architect : undefined,
    phone: contact?.phone,
    email: contact?.email,
    access_path: accessPath.type !== "Unknown" ? accessPath.type : undefined,
    source: opportunity.source_url,
  };
}

function missingIntelligence(opportunity, contact, accessPath) {
  return [
    known(opportunity.developer) ? null : "developer",
    known(opportunity.general_contractor) ? null : "general contractor",
    contact ? null : "human contact",
    contact?.phone ? null : "phone",
    accessPath.type !== "Unknown" ? null : "access path",
  ].filter(Boolean);
}

function firstKnown(...values) {
  return values.find((value) => value && value !== "Unknown") ?? "Unknown";
}

function known(value) {
  return Boolean(value && value !== "Unknown") ? value : null;
}

function compareContacts(a, b) {
  return rankContact(b) - rankContact(a) || (b.confidence ?? 0) - (a.confidence ?? 0);
}

function rankContact(contact) {
  if (contact.name && contact.phone) return 100;
  if (contact.name && contact.email) return 92;
  if (contact.phone) return 82;
  if (contact.email) return 74;
  if (contact.company) return 50;
  if (contact.source && contact.source !== "Unknown") return 45;
  return 0;
}

function dedupeContacts(contacts) {
  const seen = new Set();
  return contacts.filter((contact) => {
    const key = normalizeKey(`${contact.company}|${contact.name ?? ""}|${contact.phone ?? ""}|${contact.email ?? ""}|${contact.source ?? ""}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderActionEngine(rows) {
  return [
    "# Contractor Action Engine",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Opportunities evaluated: ${rows.length}`,
    `- Actionability 70+: ${rows.filter((row) => row.actionability_score >= 70).length}`,
    `- Phone-backed opportunities: ${rows.filter((row) => row.best_contact?.phone).length}`,
    `- Average actionability score: ${average(rows.map((row) => row.actionability_score))}`,
    "",
    table(rows, actionColumns()),
  ].join("\n");
}

function renderActionable(rows) {
  return [
    "# Actionable Contractor Opportunities",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows.filter((row) => row.actionability_score >= 50), actionColumns()),
  ].join("\n");
}

function actionColumns() {
  return [
    ["Project", (row) => row.project_name],
    ["Trade", (row) => row.primary_contractor_trade],
    ["Actionability", (row) => row.actionability_score],
    ["Opportunity", (row) => row.contractor_opportunity_score],
    ["Best Contact", (row) => formatContact(row.best_contact)],
    ["Access Path", (row) => row.access_path.type],
    ["Likely Scope", (row) => row.likely_scope],
    ["Recommended Action", (row) => row.recommended_action],
  ];
}

function formatContact(contact) {
  if (!contact) return "Unknown";
  return [contact.name ?? contact.title ?? contact.company, contact.company, contact.phone, contact.email].filter(Boolean).join(" | ");
}

function table(rows, columns) {
  if (!rows.length) return "_None._";
  return [
    `| ${columns.map(([name]) => name).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, getter]) => escapeCell(getter(row))).join(" | ")} |`),
  ].join("\n");
}

function cleanProjectName(value) {
  return String(value ?? "the project").replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeCell(value) {
  return String(value ?? "Unknown").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function average(values) {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1));
}
