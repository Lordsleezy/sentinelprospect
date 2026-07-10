import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Access Path Intelligence
 *
 * Answers: "Who should Twin Rivers call tomorrow morning?"
 * Not just which company exists — who controls fence package award.
 */

const contractorOpportunities = (await readJson("data/contractor_opportunities.json")) ?? [];
const accessOpportunities = (await readJson("data/access_opportunity_results.json")) ?? [];
const opportunityContacts = (await readJson("data/opportunity_contacts.json")) ?? [];
const companyHumanContacts = (await readJson("data/company_human_contacts.json")) ?? [];
const descriptionBusinesses = (await readJson("data/description_named_businesses.json")) ?? [];
const companyEnrichment = (await readJson("data/company_contact_enrichment.json")) ?? [];
const scopeIntelligence = (await readJson("data/scope_intelligence.json")) ?? [];
const capturedAt = new Date().toISOString();

const accessById = new Map(accessOpportunities.map((row) => [row.id, row]));
const contactsById = new Map(opportunityContacts.map((row) => [row.opportunity_id, row]));
const companyContactsByName = new Map(companyHumanContacts.map((row) => [normalizeKey(row.company), row]));
const enrichmentByName = new Map(companyEnrichment.map((row) => [normalizeKey(row.company_name), row]));
const descriptionByProject = groupBy(descriptionBusinesses, (row) => normalizeKey(row.project_name));
const descriptionByExternal = groupBy(descriptionBusinesses, (row) => normalizeProjectId(row.opportunity_external_id));
const scopeById = new Map(scopeIntelligence.map((row) => [row.opportunity_id, row]));

const access_path_intelligence = contractorOpportunities
  .map(buildAccessPathIntelligence)
  .sort((a, b) => b.call_readiness_score - a.call_readiness_score || a.project_name.localeCompare(b.project_name));

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/access_path_intelligence.json", access_path_intelligence),
  writeFile(resolve("reports/access-path-intelligence.md"), renderReport(access_path_intelligence)),
  writeFile(resolve("reports/who-to-call-tomorrow.md"), renderCallList(access_path_intelligence)),
]);

console.log(`Access path intelligence rows: ${access_path_intelligence.length}.`);
console.log(`Call-ready (phone): ${access_path_intelligence.filter((row) => row.decision_maker_phone).length}.`);
console.log(`Owner-driven: ${access_path_intelligence.filter((row) => row.access_path_type === "Owner-driven").length}.`);
console.log(`GC-driven: ${access_path_intelligence.filter((row) => row.access_path_type === "GC-driven").length}.`);

function buildAccessPathIntelligence(opportunity) {
  const access = accessById.get(opportunity.id);
  const contactRoute = contactsById.get(opportunity.id);
  const scope = scopeById.get(opportunity.id);
  const text = blob(opportunity, access, scope);
  const namedSiteBusinesses = namedBusinessesFor(opportunity);
  const contacts = rankedContacts(opportunity, contactRoute, namedSiteBusinesses);

  const accessPathType = classifyAccessPathType(opportunity, access, namedSiteBusinesses, text);
  const procurementStage = classifyProcurementStage(opportunity, access, text);
  const awardProbability = classifySubcontractorAwardProbability(opportunity, access, accessPathType, procurementStage, text);
  const decision = selectDecisionMaker(opportunity, contacts, namedSiteBusinesses, accessPathType);
  const second = selectSecondContact(contacts, decision, opportunity, namedSiteBusinesses, accessPathType);
  const escalation = buildEscalationPath(opportunity, decision, second, accessPathType, access);
  const recommendedFirstCall = buildRecommendedFirstCall(decision, opportunity, accessPathType, awardProbability);
  const whoControls = whoControlsSubcontractorSelection(accessPathType, opportunity, namedSiteBusinesses);
  const whoAwards = whoAwardsFencePackages(accessPathType, opportunity, namedSiteBusinesses, decision);
  const callReadiness = scoreCallReadiness(decision, second, accessPathType, awardProbability);

  return {
    opportunity_id: opportunity.id,
    project_name: opportunity.project_name,
    primary_contractor_trade: opportunity.primary_contractor_trade,
    fencing_bidable: scope?.fencing_bidable ?? null,
    access_path_type: accessPathType,
    procurement_stage: procurementStage,
    subcontractor_award_probability: awardProbability.label,
    subcontractor_award_probability_score: awardProbability.score,
    subcontractor_award_reasoning: awardProbability.reason,
    who_controls_subcontractor_selection: whoControls,
    who_awards_fence_packages: whoAwards,
    decision_maker: decision.display_name,
    decision_maker_role: decision.role,
    decision_maker_company: decision.company,
    decision_maker_phone: decision.phone ?? null,
    decision_maker_email: decision.email ?? null,
    decision_maker_source: decision.source ?? null,
    decision_maker_confidence: decision.confidence,
    second_contact: second ? second.display_name : null,
    second_contact_role: second?.role ?? null,
    second_contact_company: second?.company ?? null,
    second_contact_phone: second?.phone ?? null,
    second_contact_email: second?.email ?? null,
    escalation_path: escalation,
    recommended_first_call: recommendedFirstCall,
    call_script: buildCallScript(decision, opportunity, accessPathType, scope),
    call_readiness_score: callReadiness,
    contact_candidates: contacts.slice(0, 5).map(summarizeContact),
    named_site_businesses: namedSiteBusinesses.map((row) => row.business_name),
    developer: known(opportunity.developer),
    general_contractor: known(opportunity.general_contractor),
    source_url: opportunity.source_url,
    last_verified: capturedAt,
  };
}

function classifyAccessPathType(opportunity, access, namedSiteBusinesses, text) {
  const hasGc = Boolean(known(opportunity.general_contractor));
  const hasDeveloper = Boolean(known(opportunity.developer));
  const entry = String(access?.entry_method ?? opportunity.entry_method ?? "");
  const route = String(access?.procurement_route ?? opportunity.procurement_route ?? "");

  if (/bid_portal|public_procurement|plan_room|public works|municip|school district|city of|county of/i.test(`${entry} ${route} ${text}`)) {
    if (/school|park|trail|public works|city |county |district/i.test(text)) return "Municipality-driven";
  }
  if (namedSiteBusinesses.length && !hasGc && !hasDeveloper) return "Owner-driven";
  if (namedSiteBusinesses.length && /childcare|child care|daycare|church|clinic|owner|tenant/i.test(text) && !hasDeveloper) {
    return "Owner-driven";
  }
  if (hasDeveloper && /trade_partner|vendor_registration|subcontractor_registration|developer/i.test(`${entry} ${route}`)) {
    return "Developer-driven";
  }
  if (hasDeveloper && !hasGc) return "Developer-driven";
  if (hasGc) return "GC-driven";
  if (hasDeveloper) return "Developer-driven";
  if (/school|park|public|municip|city of|county of/i.test(text)) return "Municipality-driven";
  if (namedSiteBusinesses.length) return "Owner-driven";
  return "Unknown";
}

function classifyProcurementStage(opportunity, access, text) {
  const stage = String(opportunity.project_stage ?? access?.project_stage ?? "").toLowerCase();
  const status = String(opportunity.opportunity_state ?? access?.opportunity_state ?? "").toLowerCase();
  if (/finaled|completed|closed|certificate of occupancy/i.test(`${stage} ${status} ${text}`)) return "Awarded / late";
  if (/issued|permitted|under construction|active construction/i.test(`${stage} ${status} ${text}`)) return "Permit issued / construction";
  if (/plan check|review|submitted|planning/i.test(`${stage} ${status} ${text}`)) return "Plan check / design";
  if (/early|preconstruction|pre-bid|bidding|rfp|rfq/i.test(`${stage} ${status} ${text}`)) return "Pre-bid / early";
  if (/tenant improvement|ti\b|remodel|repair|gate|fence/i.test(text) && /issued|permit/i.test(`${stage} ${text}`)) {
    return "Permit issued / construction";
  }
  if (/^open$/.test(stage)) return "Open / active";
  if (stage) return capitalize(stage);
  return "Unknown";
}

function classifySubcontractorAwardProbability(opportunity, access, accessPathType, procurementStage, text) {
  let score = 45;
  const reasons = [];

  if (accessPathType === "Owner-driven") {
    score -= 15;
    reasons.push("Owner/site business appears to control the work directly.");
  }
  if (accessPathType === "GC-driven") {
    score += 10;
    reasons.push("Named GC typically awards trade packages.");
  }
  if (accessPathType === "Developer-driven") {
    score += 5;
    reasons.push("Developer-driven path; fence package may go through GC or trade partner network.");
  }
  if (accessPathType === "Municipality-driven") {
    score += 8;
    reasons.push("Public procurement often still open until bid award.");
  }

  if (/permit issued|construction/i.test(procurementStage)) {
    score += 20;
    reasons.push("Permit/construction stage increases chance fence subs are already selected.");
  }
  if (/pre-bid|early|plan check|design/i.test(procurementStage)) {
    score -= 15;
    reasons.push("Earlier stage means award is less likely complete.");
  }
  if (/awarded|late/i.test(procurementStage)) {
    score += 30;
    reasons.push("Late/awarded stage strongly suggests packages may already be placed.");
  }

  const saturation = opportunity.existing_contractor_saturation_penalty ?? 0;
  if (saturation >= 30) {
    score += 25;
    reasons.push("Listed contractor already appears to be the fencing/gate trade.");
  }

  if (/to be determined|tbd|select edit below/i.test(text)) {
    score -= 10;
    reasons.push("Contractor still TBD on permit.");
  }
  if (/new \(gates\)|new fence|raise fence|pool safety fencing|chain[-\s]?link/i.test(text)) {
    score += 5;
    reasons.push("Explicit fence/gate install language present.");
  }

  score = clamp(score);
  let label = "Unknown";
  if (score >= 75) label = "High";
  else if (score >= 50) label = "Medium";
  else if (score >= 25) label = "Low";
  else label = "Very Low";

  return {
    label,
    score,
    reason: reasons.join(" ") || "Insufficient signals to estimate award status.",
  };
}

function selectDecisionMaker(opportunity, contacts, namedSiteBusinesses, accessPathType) {
  const pm = contacts.find((contact) => isProjectManagerLike(contact) && (contact.phone || contact.email));
  if (pm) return toDecision(pm, "Project Manager");

  const estimator = contacts.find((contact) => isEstimatorLike(contact) && (contact.phone || contact.email));
  if (estimator) return toDecision(estimator, "Estimator / Purchasing");

  if (accessPathType === "Owner-driven" && namedSiteBusinesses[0]) {
    const named = contacts.find((contact) => normalizeKey(contact.company) === normalizeKey(namedSiteBusinesses[0].business_name))
      ?? contactFromNamedBusiness(namedSiteBusinesses[0]);
    return toDecision(named, "Owner / Site Business");
  }

  if (accessPathType === "Developer-driven") {
    const developerContact = contacts.find((contact) => normalizeKey(contact.company) === normalizeKey(opportunity.developer) && (contact.phone || contact.email));
    if (developerContact) return toDecision(developerContact, "Developer Procurement");
  }

  if (accessPathType === "GC-driven" || known(opportunity.general_contractor)) {
    const gcContact = contacts.find((contact) => normalizeKey(contact.company) === normalizeKey(opportunity.general_contractor) && (contact.phone || contact.email))
      ?? contacts.find((contact) => contact.phone);
    if (gcContact) {
      const role = isSelfPerformFenceTrade(opportunity, gcContact.company) ? "Gate / Fence Contractor (self-perform risk)" : "General Contractor Office";
      return toDecision(gcContact, role);
    }
  }

  if (contacts[0]) return toDecision(contacts[0], roleFromContact(contacts[0], accessPathType));

  if (namedSiteBusinesses[0]) return toDecision(contactFromNamedBusiness(namedSiteBusinesses[0]), "Owner / Site Business");

  return {
    display_name: known(opportunity.general_contractor) || known(opportunity.developer) || "Unknown decision maker",
    role: known(opportunity.general_contractor) ? "General Contractor (no phone yet)" : "Unknown",
    company: known(opportunity.general_contractor) || known(opportunity.developer) || null,
    phone: null,
    email: null,
    source: opportunity.source_url,
    confidence: 0.2,
    name: null,
  };
}

function selectSecondContact(contacts, decision, opportunity, namedSiteBusinesses, accessPathType) {
  const remaining = contacts.filter((contact) => {
    if (!decision) return true;
    const sameCompany = normalizeKey(contact.company) === normalizeKey(decision.company);
    const samePhone = contact.phone && decision.phone && contact.phone === decision.phone;
    const sameName = contact.name && decision.name && normalizeKey(contact.name) === normalizeKey(decision.name);
    return !(sameCompany && (samePhone || sameName || (!contact.name && !decision.name)));
  });

  const pm = remaining.find((contact) => isProjectManagerLike(contact));
  if (pm) return toDecision(pm, "Project Manager");

  if (accessPathType === "Owner-driven" && known(opportunity.general_contractor)) {
    const gc = remaining.find((contact) => normalizeKey(contact.company) === normalizeKey(opportunity.general_contractor));
    if (gc) return toDecision(gc, "General Contractor Office");
  }

  if (accessPathType !== "Owner-driven" && namedSiteBusinesses[0]) {
    const owner = remaining.find((contact) => normalizeKey(contact.company) === normalizeKey(namedSiteBusinesses[0].business_name))
      ?? contactFromNamedBusiness(namedSiteBusinesses[0]);
    if (owner && normalizeKey(owner.company) !== normalizeKey(decision.company)) {
      return toDecision(owner, "Owner / Site Business");
    }
  }

  if (known(opportunity.developer) && normalizeKey(opportunity.developer) !== normalizeKey(decision.company)) {
    const developer = remaining.find((contact) => normalizeKey(contact.company) === normalizeKey(opportunity.developer));
    if (developer) return toDecision(developer, "Developer Office");
  }

  if (remaining[0]) return toDecision(remaining[0], roleFromContact(remaining[0], accessPathType));
  return null;
}

function buildEscalationPath(opportunity, decision, second, accessPathType, access) {
  const steps = [];
  if (decision?.display_name) {
    steps.push(`1. Call ${decision.display_name}${decision.phone ? ` at ${decision.phone}` : ""} (${decision.role}).`);
  }
  if (second?.display_name) {
    steps.push(`2. If no answer / wrong desk, contact ${second.display_name}${second.phone ? ` at ${second.phone}` : ""} (${second.role}).`);
  }
  if (accessPathType === "GC-driven" && known(opportunity.developer)) {
    steps.push(`3. Escalate to developer ${opportunity.developer} for trade-partner or site-development routing.`);
  } else if (accessPathType === "Owner-driven" && known(opportunity.general_contractor)) {
    steps.push(`3. Escalate to GC ${opportunity.general_contractor} if owner redirects to construction team.`);
  } else if (accessPathType === "Developer-driven" && known(opportunity.general_contractor)) {
    steps.push(`3. Escalate to GC ${opportunity.general_contractor} estimating/purchasing.`);
  } else {
    steps.push("3. Escalate via permit source / procurement route and ask who awards the fence/gate package.");
  }
  const route = firstKnown(access?.procurement_route, opportunity.procurement_route, opportunity.access_route, opportunity.source_url);
  if (route && route !== "Unknown") steps.push(`Backup route: ${route}`);
  return steps;
}

function buildRecommendedFirstCall(decision, opportunity, accessPathType, awardProbability) {
  const target = decision.display_name || "the project decision maker";
  const phone = decision.phone ? ` at ${decision.phone}` : "";
  const project = cleanProjectName(opportunity.project_name);
  if (!decision.phone && !decision.email) {
    return `Research a direct phone for ${target} before calling about ${project}.`;
  }
  if (isSelfPerformFenceTrade(opportunity, decision.company)) {
    return `Call ${target}${phone} only to confirm self-perform vs overflow subcontract need on ${project}; this may already be their package.`;
  }
  if (awardProbability.label === "High") {
    return `Call ${target}${phone} tomorrow morning and ask whether the fence/gate package on ${project} is still open or already awarded.`;
  }
  if (accessPathType === "Owner-driven") {
    return `Call ${target}${phone} tomorrow morning and ask who is handling the fence/gate work for ${project} and whether they want a fencing bid.`;
  }
  return `Call ${target}${phone} tomorrow morning and ask for estimating/purchasing regarding the fence/gate package on ${project}.`;
}

function buildCallScript(decision, opportunity, accessPathType, scope) {
  const company = decision.company || "your project team";
  const project = cleanProjectName(opportunity.project_name);
  const scopeLabel = scope?.likely_fence_scope || scope?.potential_fencing_scope?.[0] || "fence/gate";
  if (accessPathType === "Owner-driven") {
    return `Hi, this is [Name] with Twin Rivers. I'm calling about ${project}. I saw the permit for fence/gate work at your site and wanted to ask who is handling that package and whether you're open to a fencing bid.`;
  }
  return `Hi, this is [Name] with Twin Rivers. I'm calling about ${project}. Who handles ${String(scopeLabel).toLowerCase()} subcontractor pricing for ${company}?`;
}

function whoControlsSubcontractorSelection(accessPathType, opportunity, namedSiteBusinesses) {
  if (accessPathType === "Owner-driven") return namedSiteBusinesses[0]?.business_name || "Site owner / named business";
  if (accessPathType === "Developer-driven") return known(opportunity.developer) || "Developer procurement";
  if (accessPathType === "Municipality-driven") return "Public agency / procurement officer";
  if (accessPathType === "GC-driven") return known(opportunity.general_contractor) || "General contractor";
  return "Unknown";
}

function whoAwardsFencePackages(accessPathType, opportunity, namedSiteBusinesses, decision) {
  if (isSelfPerformFenceTrade(opportunity, decision.company)) {
    return `${decision.company} (likely self-performs gates/fencing)`;
  }
  if (accessPathType === "Owner-driven") return namedSiteBusinesses[0]?.business_name || decision.company || "Owner";
  if (accessPathType === "Developer-driven") {
    return known(opportunity.general_contractor)
      ? `${opportunity.general_contractor} under ${opportunity.developer}`
      : known(opportunity.developer) || "Developer / GC team";
  }
  if (accessPathType === "Municipality-driven") return "Awarded through public bid / agency GC";
  if (accessPathType === "GC-driven") return known(opportunity.general_contractor) || decision.company || "General contractor";
  return decision.company || "Unknown";
}

function rankedContacts(opportunity, contactRoute, namedSiteBusinesses) {
  const companyRows = [
    companyContactsByName.get(normalizeKey(opportunity.general_contractor)),
    companyContactsByName.get(normalizeKey(opportunity.developer)),
  ].filter(Boolean);

  const contacts = [
    ...(contactRoute?.contacts ?? []),
    ...companyRows.flatMap((row) => row.contacts ?? []),
    ...namedSiteBusinesses.map(contactFromNamedBusiness),
  ]
    .filter(Boolean)
    .map(normalizeContact);

  return dedupeContacts(contacts).sort((a, b) => contactRank(b) - contactRank(a) || (b.confidence ?? 0) - (a.confidence ?? 0));
}

function namedBusinessesFor(opportunity) {
  return [
    ...(descriptionByProject.get(normalizeKey(opportunity.project_name)) ?? []),
    ...(descriptionByExternal.get(normalizeProjectId(opportunity.id)) ?? []),
  ].filter((row, index, all) => all.findIndex((item) => normalizeKey(item.business_name) === normalizeKey(row.business_name)) === index);
}

function contactFromNamedBusiness(row) {
  const enriched = enrichmentByName.get(normalizeKey(row.business_name));
  return normalizeContact({
    name: undefined,
    title: "Named site business",
    company: row.business_name,
    phone: enriched?.phone ?? undefined,
    email: enriched?.email ?? undefined,
    contactType: "corporate",
    confidence: enriched?.phone ? 0.7 : 0.35,
    source: enriched?.cslb_source_url ?? row.source_url ?? "permit_description",
    evidence: [row.evidence, enriched?.phone ? `Public enrichment lists phone ${enriched.phone}.` : null].filter(Boolean),
  });
}

function normalizeContact(contact) {
  return {
    name: contact.name ?? undefined,
    title: contact.title ?? undefined,
    company: contact.company,
    phone: contact.phone ?? undefined,
    email: contact.email ?? undefined,
    contactType: contact.contactType ?? "corporate",
    confidence: contact.confidence ?? 0.5,
    source: contact.source ?? "Unknown",
    evidence: contact.evidence ?? [],
  };
}

function toDecision(contact, role) {
  const display = contact.name
    ? `${contact.name}${contact.company ? ` (${contact.company})` : ""}`
    : contact.company || role;
  return {
    display_name: display,
    name: contact.name ?? null,
    role,
    company: contact.company ?? null,
    phone: contact.phone ?? null,
    email: contact.email ?? null,
    source: contact.source ?? null,
    confidence: contact.confidence ?? 0.5,
  };
}

function summarizeContact(contact) {
  return {
    name: contact.name ?? null,
    title: contact.title ?? null,
    company: contact.company,
    phone: contact.phone ?? null,
    email: contact.email ?? null,
    contactType: contact.contactType,
    confidence: contact.confidence,
  };
}

function contactRank(contact) {
  let score = 0;
  if (contact.name && contact.phone) score += 100;
  else if (contact.name && contact.email) score += 90;
  else if (contact.phone) score += 80;
  else if (contact.email) score += 70;
  else if (contact.company) score += 30;
  if (isProjectManagerLike(contact)) score += 25;
  if (isEstimatorLike(contact)) score += 18;
  if (contact.contactType === "construction") score += 8;
  if (contact.contactType === "direct") score += 12;
  return score;
}

function isProjectManagerLike(contact) {
  return /project manager|\bpm\b|superintendent|construction manager|project executive/i.test(`${contact.title ?? ""} ${contact.name ?? ""} ${contact.contactType ?? ""}`);
}

function isEstimatorLike(contact) {
  return /estimat|purchasing|procurement|bid coordin|subcontract/i.test(`${contact.title ?? ""} ${contact.name ?? ""}`);
}

function roleFromContact(contact, accessPathType) {
  if (isProjectManagerLike(contact)) return "Project Manager";
  if (isEstimatorLike(contact)) return "Estimator / Purchasing";
  if (contact.title === "Named site business") return "Owner / Site Business";
  if (contact.contactType === "construction") return "General Contractor Office";
  if (accessPathType === "Developer-driven") return "Developer Office";
  return contact.title || "Company Office";
}

function isSelfPerformFenceTrade(opportunity, company) {
  if (!company) return false;
  const saturation = opportunity.existing_contractor_saturation_penalty ?? 0;
  if (saturation >= 30 && normalizeKey(company) === normalizeKey(opportunity.general_contractor)) return true;
  return /gate|fenc|entry control|ornamental|barrier/i.test(company);
}

function scoreCallReadiness(decision, second, accessPathType, awardProbability) {
  let score = 0;
  if (decision.phone) score += 40;
  if (decision.email) score += 15;
  if (decision.name) score += 10;
  if (second?.phone) score += 10;
  if (accessPathType !== "Unknown") score += 10;
  if (awardProbability.label === "Low" || awardProbability.label === "Very Low") score += 10;
  if (awardProbability.label === "High") score -= 5;
  return clamp(score);
}

function blob(opportunity, access, scope) {
  return [
    opportunity.project_name,
    opportunity.project_summary,
    opportunity.qualification_reason,
    opportunity.trade,
    opportunity.project_stage,
    access?.project_description,
    access?.recommended_next_step,
    scope?.project_description,
    scope?.why_fencing_matters,
    scope?.primary_scope,
  ].filter(Boolean).join(" ");
}

function renderReport(rows) {
  const callReady = rows.filter((row) => row.decision_maker_phone);
  return [
    "# Access Path Intelligence",
    "",
    `Generated: ${capturedAt}`,
    "",
    `- Opportunities: ${rows.length}`,
    `- Call-ready with phone: ${callReady.length}`,
    `- Owner-driven: ${rows.filter((row) => row.access_path_type === "Owner-driven").length}`,
    `- GC-driven: ${rows.filter((row) => row.access_path_type === "GC-driven").length}`,
    `- Developer-driven: ${rows.filter((row) => row.access_path_type === "Developer-driven").length}`,
    `- Municipality-driven: ${rows.filter((row) => row.access_path_type === "Municipality-driven").length}`,
    "",
    "## Top call-ready opportunities",
    "",
    ...callReady.slice(0, 25).map((row) => [
      `### ${row.project_name}`,
      "",
      `- Access path: ${row.access_path_type}`,
      `- Procurement stage: ${row.procurement_stage}`,
      `- Sub award probability: ${row.subcontractor_award_probability} (${row.subcontractor_award_probability_score})`,
      `- Decision maker: ${row.decision_maker} · ${row.decision_maker_role}`,
      `- Phone: ${row.decision_maker_phone ?? "Unknown"}`,
      `- Email: ${row.decision_maker_email ?? "Unknown"}`,
      `- Second contact: ${row.second_contact ?? "None"}`,
      `- Recommended first call: ${row.recommended_first_call}`,
      "",
    ].join("\n")),
  ].join("\n");
}

function renderCallList(rows) {
  const ready = rows
    .filter((row) => row.decision_maker_phone)
    .filter((row) => row.fencing_bidable !== false)
    .slice(0, 40);
  return [
    "# Who Should Twin Rivers Call Tomorrow Morning?",
    "",
    `Generated: ${capturedAt}`,
    "",
    ready.length ? null : "- No phone-backed fencing call targets yet.",
    ...ready.map((row, index) => [
      `## ${index + 1}. ${row.project_name}`,
      "",
      `- **Call:** ${row.decision_maker}`,
      `- **Role:** ${row.decision_maker_role}`,
      `- **Phone:** ${row.decision_maker_phone}`,
      `- **Why:** ${row.access_path_type}; award probability ${row.subcontractor_award_probability}`,
      `- **Script:** ${row.recommended_first_call}`,
      `- **Escalation:** ${row.escalation_path[1] ?? row.escalation_path[0]}`,
      "",
    ].join("\n")),
  ].filter((line) => line !== null).join("\n");
}

function dedupeContacts(contacts) {
  const seen = new Set();
  return contacts.filter((contact) => {
    const key = normalizeKey(`${contact.company}|${contact.name ?? ""}|${contact.phone ?? ""}|${contact.email ?? ""}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupBy(items, fn) {
  const map = new Map();
  for (const item of items) {
    const key = fn(item);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function firstKnown(...values) {
  return values.find((value) => value && value !== "Unknown") ?? "Unknown";
}

function known(value) {
  return value && value !== "Unknown" ? value : null;
}

function cleanProjectName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function capitalize(value) {
  const text = String(value ?? "").trim();
  if (!text) return "Unknown";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProjectId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^sac-|^placer-/, "")
    .replace(/[^a-z0-9]/g, "");
}

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
