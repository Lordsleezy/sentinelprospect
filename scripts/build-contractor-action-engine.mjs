import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const contractorOpportunities = await readJson("data/contractor_opportunities.json") ?? [];
const opportunityContacts = await readJson("data/opportunity_contacts.json") ?? [];
const companyHumanContacts = await readJson("data/company_human_contacts.json") ?? [];
const accessPathIntelligence = await readJson("data/access_path_intelligence.json") ?? [];
const capturedAt = new Date().toISOString();

const contactsByOpportunity = new Map(opportunityContacts.map((row) => [row.opportunity_id, row]));
const contactsByProjectName = new Map(opportunityContacts.map((row) => [normalizeKey(row.project_name), row]));
const companyContactsByName = new Map(companyHumanContacts.map((row) => [normalizeKey(row.company), row]));
const accessPathByOpportunity = new Map(accessPathIntelligence.map((row) => [row.opportunity_id, row]));

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
  const accessIntel = accessPathByOpportunity.get(opportunity.id);
  const companyContacts = [
    companyContactsByName.get(normalizeKey(opportunity.general_contractor)),
    companyContactsByName.get(normalizeKey(opportunity.developer)),
    companyContactsByName.get(normalizeKey(opportunity.architect)),
  ].filter(Boolean);
  const contacts = dedupeContacts([
    ...(contactRoute?.contacts ?? []),
    ...companyContacts.flatMap((row) => row.contacts ?? []),
  ]).sort(compareContacts);
  const bestContact = bestContactFromAccessIntel(accessIntel) ?? contacts[0] ?? contactRoute?.best_contact ?? null;
  const accessPath = accessPathFromIntel(accessIntel, opportunity, bestContact);
  const likelyScope = likelyScopeFor(opportunity);
  const score = actionabilityScoreFor(opportunity, bestContact, accessPath, accessIntel);
  const recommendedAction = accessIntel?.recommended_first_call
    ?? recommendedActionFor(opportunity, bestContact, accessPath, likelyScope);

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
    access_path_type: accessIntel?.access_path_type ?? accessPath.type,
    procurement_stage: accessIntel?.procurement_stage ?? opportunity.project_stage ?? "Unknown",
    subcontractor_award_probability: accessIntel?.subcontractor_award_probability ?? "Unknown",
    subcontractor_award_probability_score: accessIntel?.subcontractor_award_probability_score ?? null,
    subcontractor_award_reasoning: accessIntel?.subcontractor_award_reasoning ?? null,
    decision_maker: accessIntel?.decision_maker ?? bestContact?.name ?? bestContact?.company ?? null,
    decision_maker_role: accessIntel?.decision_maker_role ?? bestContact?.title ?? null,
    decision_maker_company: accessIntel?.decision_maker_company ?? bestContact?.company ?? null,
    decision_maker_phone: accessIntel?.decision_maker_phone ?? bestContact?.phone ?? null,
    decision_maker_email: accessIntel?.decision_maker_email ?? bestContact?.email ?? null,
    second_contact: accessIntel?.second_contact ?? null,
    second_contact_role: accessIntel?.second_contact_role ?? null,
    second_contact_company: accessIntel?.second_contact_company ?? null,
    second_contact_phone: accessIntel?.second_contact_phone ?? null,
    second_contact_email: accessIntel?.second_contact_email ?? null,
    escalation_path: accessIntel?.escalation_path ?? [],
    who_controls_subcontractor_selection: accessIntel?.who_controls_subcontractor_selection ?? null,
    who_awards_fence_packages: accessIntel?.who_awards_fence_packages ?? null,
    recommended_first_call: accessIntel?.recommended_first_call ?? recommendedAction,
    call_readiness_score: accessIntel?.call_readiness_score ?? score,
    likely_scope: likelyScope,
    recommended_action: recommendedAction,
    outreach_script: accessIntel?.call_script ?? outreachScriptFor(opportunity, bestContact, likelyScope),
    populated_fields: populatedFields(opportunity, bestContact, accessPath, accessIntel),
    missing_intelligence: missingIntelligence(opportunity, bestContact, accessPath),
    source_url: opportunity.source_url,
    permit_source_available: Boolean(opportunity.source_url && opportunity.source_url !== "Unknown"),
    last_verified: capturedAt,
  };
}

function bestContactFromAccessIntel(accessIntel) {
  if (!accessIntel?.decision_maker_company && !accessIntel?.decision_maker) return null;
  const company = accessIntel.decision_maker_company ?? accessIntel.decision_maker;
  const rawName = accessIntel.decision_maker?.includes("(")
    ? accessIntel.decision_maker.replace(/\s*\(.*\)\s*$/, "").trim()
    : null;
  const name = rawName && normalizeKey(rawName) !== normalizeKey(company) ? rawName : undefined;
  return {
    name,
    title: accessIntel.decision_maker_role ?? undefined,
    company,
    phone: accessIntel.decision_maker_phone ?? undefined,
    email: accessIntel.decision_maker_email ?? undefined,
    contactType: /owner|site business/i.test(accessIntel.decision_maker_role ?? "") ? "corporate" : "construction",
    confidence: accessIntel.decision_maker_confidence ?? 0.7,
    source: accessIntel.decision_maker_source ?? "access_path_intelligence",
    evidence: [
      accessIntel.recommended_first_call,
      accessIntel.who_controls_subcontractor_selection
        ? `Controls subcontractor selection: ${accessIntel.who_controls_subcontractor_selection}.`
        : null,
    ].filter(Boolean),
  };
}

function accessPathFromIntel(accessIntel, opportunity, bestContact) {
  if (accessIntel?.access_path_type) {
    return {
      type: accessIntel.access_path_type,
      value: firstKnown(opportunity.procurement_route, opportunity.access_route, bestContact?.source),
    };
  }
  return accessPathFor(opportunity, bestContact);
}

function actionabilityScoreFor(opportunity, contact, accessPath, accessIntel) {
  let score = 0;
  if (known(opportunity.developer)) score += 14;
  if (known(opportunity.general_contractor)) score += 16;
  if (known(opportunity.architect)) score += 6;
  if (contact) score += 18;
  if (contact?.phone) score += 22;
  if (contact?.email) score += 14;
  if (["Bid portal", "Public works", "Plan room", "Municipality-driven"].includes(accessPath.type)) score += 16;
  if (accessPath.type !== "Unknown") score += 10;
  if (opportunity.procurement_route && opportunity.procurement_route !== "Unknown") score += 8;
  if (opportunity.source_url && opportunity.source_url !== "Unknown") score += 8;
  if (accessIntel?.call_readiness_score) score = Math.max(score, Math.min(100, Math.round(score * 0.7 + accessIntel.call_readiness_score * 0.3)));
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
  const trade = opportunity.primary_contractor_trade || "Trade";
  const text = `${opportunity.project_name} ${opportunity.trade} ${opportunity.qualification_reason} ${opportunity.project_summary ?? ""}`.toLowerCase();
  const fenceRelevant = trade === "Fencing" && /\b(fence|fencing|perimeter|security\s+fence|chain[-\s]?link)\b|\b(new\s*\(?gates?\)?|sliding\s+gate|steel\s+gate|security\s+gate|vehicle\s+gate|pedestrian\s+gate)\b/.test(text);
  if (!fenceRelevant) return `${trade} scope`;
  if (/\bpark\b/.test(text)) return "Park fencing";
  if (/\bschool\b/.test(text)) return "School perimeter fencing";
  if (/\butility|drainage|trunk|corridor\b/.test(text)) return "Utility corridor fencing";
  if (/\bindustrial|security|warehouse\b/.test(text)) return "Security fencing";
  if (/\bsubdivision|village|master plan|lot|unit|homes|residential\b/.test(text)) return "Residential perimeter fencing";
  if (/\b(new\s*\(?gates?\)?|sliding\s+gate|steel\s+gate|security\s+gate)\b/.test(text)) return "Gates";
  if (/\bretaining|wall\b/.test(text)) return "Retaining wall interface";
  return "Construction fencing";
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

function populatedFields(opportunity, contact, accessPath, accessIntel) {
  return {
    developer: known(opportunity.developer) ? opportunity.developer : undefined,
    general_contractor: known(opportunity.general_contractor) ? opportunity.general_contractor : undefined,
    architect: known(opportunity.architect) ? opportunity.architect : undefined,
    phone: accessIntel?.decision_maker_phone ?? contact?.phone,
    email: accessIntel?.decision_maker_email ?? contact?.email,
    decision_maker: accessIntel?.decision_maker,
    decision_maker_role: accessIntel?.decision_maker_role,
    access_path: accessPath.type !== "Unknown" ? accessPath.type : undefined,
    procurement_stage: accessIntel?.procurement_stage,
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
