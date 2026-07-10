import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import * as cheerio from "cheerio";

// pdf-parse v2 / pdfjs need DOM matrix shims in Node before import.
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {}
  };
}
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor() {}
  };
}
if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {
    constructor() {}
  };
}

const { PDFParse } = await import("pdf-parse");

const args = parseArgs(process.argv.slice(2));
const fetchEnabled = args.fetch !== false;
const fetchLimit = Number(args.limit ?? 25);
const capturedAt = new Date().toISOString();

const contractorOpportunities = await readJson("data/contractor_opportunities.json") ?? [];
const evidenceDocuments = await readJson("data/evidence_documents.json") ?? [];
const evidenceExpansion = await readJson("data/evidence_expansion.json") ?? [];
const documentExtraction = await readJson("data/document_extraction_results.json") ?? [];
const sacramentoPermits = await readJson("data/sacramento-county-permits.json");
const placerRecords = await readJson("data/placer-county-records.json");

const expansionById = new Map(evidenceExpansion.map((row) => [row.opportunity_id, row]));
const extractionById = new Map(documentExtraction.map((row) => [row.evidence_document_id ?? row.id, row]));
const permitTextByKey = buildPermitTextIndex([
  ...(sacramentoPermits?.records ?? []),
  ...(placerRecords?.records ?? []),
]);

await mkdir(resolve("data/document_fetch_cache"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });

const fetchStats = { attempted: 0, fetched: 0, cached: 0, failed: 0, skipped: 0 };

async function main() {
  const document_intelligence = [];

  for (const opportunity of contractorOpportunities) {
    const sources = discoverDocumentSources(opportunity);
    const documents = [];

    for (const source of sources) {
      const extracted = await resolveDocumentText(source);
      if (!extracted?.text) continue;
      documents.push({
        ...source,
        text: extracted.text,
        text_source: extracted.text_source,
        fetched: extracted.fetched,
        ocr_ready: extracted.ocr_ready ?? false,
        char_count: extracted.text.length,
      });
    }

    const combinedText = documents.map((doc) => doc.text).join("\n\n");
    const dossier = buildOpportunityDossier(opportunity, documents, combinedText);
    document_intelligence.push(dossier);
  }

  await Promise.all([
    writeJson("data/document_intelligence.json", document_intelligence),
    writeFile(resolve("reports/document-intelligence-report.md"), renderReport(document_intelligence, fetchStats)),
  ]);

  const withScope = document_intelligence.filter((row) => row.scope_items.length > 0).length;
  const withQuantities = document_intelligence.filter((row) => row.identified_quantities.length > 0).length;
  const withTimeline = document_intelligence.filter((row) => row.timeline_signals.length > 0).length;
  const withEvidence = document_intelligence.filter((row) => row.evidence.length > 0).length;

  console.log(`Document intelligence dossiers: ${document_intelligence.length}.`);
  console.log(`With scope items: ${withScope}. With quantities: ${withQuantities}. With timeline: ${withTimeline}. With evidence quotes: ${withEvidence}.`);
  console.log(`Fetch stats: attempted=${fetchStats.attempted} fetched=${fetchStats.fetched} cached=${fetchStats.cached} failed=${fetchStats.failed} skipped=${fetchStats.skipped}.`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  if (out.fetch === "false") out.fetch = false;
  if (out.fetch === "true") out.fetch = true;
  return out;
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

function buildPermitTextIndex(records) {
  const map = new Map();
  for (const record of records) {
    const attrs = record.attributes ?? record;
    const id = attrs.Application ?? attrs.PERMITNUMBER ?? attrs.OBJECTID ?? record.id;
    const text = [
      attrs.ProjectName,
      attrs.WorkDescription,
      attrs.DESCRIPTION,
      attrs.Status,
      attrs.Address,
    ].filter(Boolean).join("\n");
    if (!id || !text.trim()) continue;
    map.set(String(id).toLowerCase(), text);
    map.set(normalizeKey(String(attrs.ProjectName ?? "")), text);
  }
  return map;
}

function discoverDocumentSources(opportunity) {
  const sources = [];
  const seen = new Set();

  function add(source) {
    if (!source?.id || seen.has(source.id)) return;
    seen.add(source.id);
    sources.push(source);
  }

  // Local opportunity / permit text is always available and preferred as baseline evidence.
  const localText = [
    opportunity.project_name,
    opportunity.project_description,
    opportunity.project_summary,
    opportunity.scope_summary,
    opportunity.qualification_reason,
    opportunity.trade,
    opportunity.developer,
    opportunity.general_contractor,
  ].filter(Boolean).join("\n");

  add({
    id: `local-${opportunity.id}`,
    label: "Opportunity / permit record",
    source_type: "opportunity_record",
    source_url: opportunity.source_url ?? null,
    fetchable: false,
    seed_text: localText,
  });

  const permitKey = opportunity.id.replace(/^sac-/, "").toLowerCase();
  const permitText = permitTextByKey.get(permitKey) || permitTextByKey.get(normalizeKey(opportunity.project_name));
  if (permitText) {
    add({
      id: `permit-text-${opportunity.id}`,
      label: "Permit work description",
      source_type: "permit_record",
      source_url: opportunity.source_url ?? null,
      fetchable: false,
      seed_text: permitText,
    });
  }

  const expansion = expansionById.get(opportunity.id);
  for (const doc of [...(expansion?.related_documents ?? []), ...(expansion?.related_evidence ?? []), ...(expansion?.evidence_sources ?? [])]) {
    add({
      id: doc.id ?? `related-${opportunity.id}-${sources.length}`,
      label: doc.label ?? doc.title ?? "Related document",
      source_type: doc.source_type ?? "related_document",
      source_url: doc.source_url ?? null,
      fetchable: isFetchableUrl(doc.source_url),
      seed_text: doc.summary ?? "",
    });
  }

  for (const curated of evidenceDocuments) {
    if (curated.id === opportunity.id || normalizeKey(curated.project_name ?? "") === normalizeKey(opportunity.project_name)) {
      add({
        id: curated.id,
        label: curated.title ?? curated.id,
        source_type: curated.source_type ?? "curated_document",
        source_url: curated.source_url,
        fetchable: isFetchableUrl(curated.source_url),
        seed_text: curated.summary ?? "",
      });
    }
  }

  const extraction = extractionById.get(opportunity.id);
  if (extraction?.full_text) {
    add({
      id: `extraction-${opportunity.id}`,
      label: "Prior document extraction",
      source_type: "document_extraction",
      source_url: extraction.source_url ?? opportunity.source_url ?? null,
      fetchable: false,
      seed_text: extraction.full_text,
    });
  }

  if (opportunity.source_url && isFetchableUrl(opportunity.source_url)) {
    add({
      id: `source-${opportunity.id}`,
      label: "Primary source URL",
      source_type: "source_url",
      source_url: opportunity.source_url,
      fetchable: true,
      seed_text: "",
    });
  }

  return sources;
}

function isFetchableUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return false;
  // ArcGIS explore UIs are not useful document bodies.
  if (/data\.saccounty\.gov\/datasets|placer\.maps\.arcgis|arcgis\.com\/apps/i.test(url)) return false;
  return true;
}

async function resolveDocumentText(source) {
  if (source.seed_text && source.seed_text.trim().length >= 40 && !source.fetchable) {
    return { text: cleanText(source.seed_text), text_source: "local_record", fetched: false, ocr_ready: false };
  }

  if (source.fetchable && source.source_url && fetchEnabled && fetchStats.attempted < fetchLimit) {
    const remote = await fetchDocumentText(source.source_url);
    if (remote?.text) {
      const merged = [source.seed_text, remote.text].filter(Boolean).join("\n\n");
      return { text: cleanText(merged), text_source: remote.text_source, fetched: true, ocr_ready: remote.ocr_ready };
    }
  } else if (source.fetchable && (!fetchEnabled || fetchStats.attempted >= fetchLimit)) {
    fetchStats.skipped += 1;
  }

  if (source.seed_text?.trim()) {
    return { text: cleanText(source.seed_text), text_source: "local_summary", fetched: false, ocr_ready: false };
  }
  return null;
}

async function fetchDocumentText(url) {
  fetchStats.attempted += 1;
  const cacheKey = createHash("sha1").update(url).digest("hex");
  const cachePath = resolve("data/document_fetch_cache", `${cacheKey}.json`);

  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (cached?.text) {
      fetchStats.cached += 1;
      return cached;
    }
  } catch {
    // continue
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "SentinelProspectsDocumentIntelligence/1.0",
        Accept: "text/html,application/pdf,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await response.arrayBuffer());
    let text = "";
    let textSource = "html";
    let ocrReady = false;

    if (contentType.includes("pdf") || /\.pdf($|\?)/i.test(url) || extname(new URL(url).pathname).toLowerCase() === ".pdf") {
      const parser = new PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        text = parsed?.text ?? "";
      } finally {
        await parser.destroy().catch(() => {});
      }
      textSource = "pdf";
      // Scanned PDFs with almost no extractable text are OCR-ready for a future pass.
      ocrReady = text.replace(/\s+/g, "").length < 80;
    } else {
      const html = buffer.toString("utf8");
      text = extractHtmlText(html);
      textSource = "html";
    }

    const payload = {
      url,
      text: cleanText(text),
      text_source: textSource,
      ocr_ready: ocrReady,
      fetched_at: capturedAt,
    };
    await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`);
    fetchStats.fetched += 1;
    return payload;
  } catch (error) {
    fetchStats.failed += 1;
    console.warn(`Document fetch failed for ${url}: ${error.message}`);
    return null;
  }
}

function extractHtmlText(html) {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header, iframe, svg").remove();
  const main = $("main, article, .entry-content, .content, #content, .post-content").first();
  const raw = (main.length ? main.text() : $("body").text()) || $.root().text();
  return raw;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function buildOpportunityDossier(opportunity, documents, combinedText) {
  const text = combinedText || "";
  const scopeItems = extractScopeItems(text, documents);
  const quantities = extractQuantities(text, documents);
  const timelineSignals = extractTimelineSignals(text, documents);
  const procurement = extractProcurement(text, documents);
  const contacts = extractDocumentContacts(text, opportunity, documents);
  const tradeEvidence = extractTradeEvidence(text, opportunity, documents);
  const workCategories = [...new Set(scopeItems.map((item) => item.category).filter(Boolean))];
  const evidence = buildEvidenceQuotes(text, documents, scopeItems, quantities, tradeEvidence);
  const primaryTrade = opportunity.primary_contractor_trade || guessPrimaryTrade(workCategories, tradeEvidence);

  return {
    opportunity_id: opportunity.id,
    project_name: opportunity.project_name,
    city: opportunity.city,
    county: opportunity.county,
    primary_trade: primaryTrade,
    source_url: opportunity.source_url,
    documents_reviewed: documents.map((doc) => ({
      id: doc.id,
      label: doc.label,
      source_type: doc.source_type,
      source_url: doc.source_url,
      text_source: doc.text_source,
      fetched: doc.fetched,
      ocr_ready: doc.ocr_ready,
      char_count: doc.char_count,
    })),
    project_description: summarizeProjectDescription(opportunity, text, scopeItems),
    construction_summary: summarizeConstruction(opportunity, scopeItems, quantities),
    what_is_being_built: summarizeWhatIsBeingBuilt(opportunity, scopeItems),
    work_categories: workCategories,
    trade_relevance: primaryTrade,
    trade_evidence: tradeEvidence,
    why_this_trade_matters: summarizeWhyTradeMatters(primaryTrade, tradeEvidence, scopeItems, quantities),
    scope_items: scopeItems,
    scope_summary: summarizeScope(scopeItems, quantities),
    identified_quantities: quantities,
    quantities,
    timeline_signals: timelineSignals,
    timeline_summary: summarizeTimeline(timelineSignals),
    procurement_signals: procurement.signals,
    procurement_path: procurement.path,
    contact_signals: contacts,
    document_contacts: contacts,
    best_contact: pickBestDocumentContact(contacts, opportunity),
    risk_signals: extractRiskSignals(text),
    recommended_action: buildRecommendedAction(opportunity, primaryTrade, contacts, timelineSignals, procurement.path),
    evidence,
    confidence_reasoning: buildConfidenceReasoning(documents, scopeItems, quantities, tradeEvidence),
    project_summary: summarizeProjectDescription(opportunity, text, scopeItems),
    last_verified: capturedAt,
  };
}

const SCOPE_PATTERNS = [
  { type: "chain_link_fence", category: "Fencing", label: "Chain link fence", pattern: /chain[-\s]?link(?:\s+fence|\s+fencing)?/gi },
  { type: "wood_fence", category: "Fencing", label: "Wood fence", pattern: /wood(?:en)?\s+fence|cedar\s+fence/gi },
  { type: "vinyl_fence", category: "Fencing", label: "Vinyl fence", pattern: /vinyl\s+fence/gi },
  { type: "security_fence", category: "Fencing", label: "Security fence", pattern: /security\s+fence|perimeter\s+security/gi },
  { type: "perimeter_fence", category: "Fencing", label: "Perimeter fence", pattern: /perimeter\s+fenc(?:e|ing)/gi },
  { type: "construction_fence", category: "Fencing", label: "Temporary construction fence", pattern: /temporary\s+(?:construction\s+)?fenc(?:e|ing)|construction\s+fenc(?:e|ing)/gi },
  { type: "gate", category: "Gates", label: "Gate", pattern: /\b(?:sliding|vehicle|pedestrian|automatic|steel|security)\s+gates?\b|\bgate\s+systems?\b|\bfence(?:ing)?\s+and\s+gates?\b/gi },
  { type: "foundation", category: "Foundation", label: "Foundation", pattern: /\bfoundations?\b|\bfootings?\b/gi },
  { type: "stemwall", category: "Foundation", label: "Stemwall", pattern: /stem\s*-?\s*walls?/gi },
  { type: "slab", category: "Slab", label: "Slab", pattern: /concrete\s+slabs?|\bslab\s+on\s+grade\b|\bfloor\s+slabs?\b/gi },
  { type: "flatwork", category: "Flatwork", label: "Flatwork", pattern: /\bflatwork\b|sidewalks?|curb(?:s|ing)?(?:\s+and\s+gutter)/gi },
  { type: "driveway", category: "Driveways", label: "Driveway", pattern: /\bdriveways?\b/gi },
  { type: "retaining_wall", category: "Retaining Walls", label: "Retaining wall", pattern: /retaining\s+walls?/gi },
  { type: "reroof", category: "Roofing", label: "Re-roof", pattern: /\bre-?roofs?\b|roof\s+replacement|new\s+roof|\broofing\b/gi },
  { type: "hvac", category: "HVAC", label: "HVAC", pattern: /\bhvac\b|heat\s+pumps?|package\s+units?|\brtu\b|split\s+system/gi },
  { type: "electrical", category: "Electrical", label: "Electrical", pattern: /\belectrical\b|service\s+panel|solar|photovoltaic|\bpv\b/gi },
  { type: "plumbing", category: "Plumbing", label: "Plumbing", pattern: /\bplumbing\b|repipe|backflow|gas\s+line/gi },
  { type: "water", category: "Utilities", label: "Water", pattern: /water\s+(?:main|line|service)|domestic\s+water/gi },
  { type: "sewer", category: "Utilities", label: "Sewer", pattern: /\bsewer\b|sanitary\s+sewer/gi },
  { type: "storm_drain", category: "Utilities", label: "Storm drain", pattern: /storm\s+drain|stormwater|drainage/gi },
  { type: "site_work", category: "Site Prep", label: "Site work", pattern: /site\s+work|grading|earthwork|excavation/gi },
  { type: "demolition", category: "Demolition", label: "Demolition", pattern: /\bdemolition\b|\bdemo\b/gi },
];

function extractScopeItems(text, documents) {
  const items = [];
  for (const rule of SCOPE_PATTERNS) {
    const matches = text.match(rule.pattern);
    if (!matches?.length) continue;
    const quantity = findNearbyQuantity(text, rule.pattern);
    const sourceDoc = documents.find((doc) => rule.pattern.test(doc.text)) ?? documents[0];
    items.push({
      type: rule.type,
      label: rule.label,
      category: rule.category,
      quantity: quantity?.display ?? null,
      confidence: quantity ? "high" : matches.length > 1 ? "medium" : "medium",
      source: sourceDoc?.label ?? "project document",
      source_url: sourceDoc?.source_url ?? null,
      mentions: matches.length,
    });
  }
  return items;
}

function extractQuantities(text, documents) {
  const patterns = [
    { kind: "linear_feet", regex: /(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*(?:linear\s*feet|lin(?:ear)?\.?\s*ft\.?|\bLF\b)/gi },
    { kind: "square_feet", regex: /(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*(?:square\s*feet|sq\.?\s*ft\.?|\bSF\b)/gi },
    { kind: "cubic_yards", regex: /(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*(?:cubic\s*yards?|cu\.?\s*yds?\.?|\bCY\b)/gi },
  ];
  const out = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const display = match[0].replace(/\s+/g, " ").trim();
      const context = snippetAround(text, match.index, 90);
      const sourceDoc = documents.find((doc) => doc.text.includes(match[0])) ?? documents[0];
      out.push({
        kind: pattern.kind,
        quantity: display,
        context,
        confidence: /fence|wall|sidewalk|driveway|slab|roof|pipe/i.test(context) ? "high" : "medium",
        source: sourceDoc?.label ?? "project document",
        source_url: sourceDoc?.source_url ?? null,
      });
    }
  }
  return dedupeBy(out, (row) => `${row.kind}:${row.quantity}:${row.context.slice(0, 40)}`).slice(0, 12);
}

function findNearbyQuantity(text, pattern) {
  const match = pattern.exec(text);
  pattern.lastIndex = 0;
  if (!match || match.index == null) return null;
  const window = text.slice(Math.max(0, match.index - 60), Math.min(text.length, match.index + match[0].length + 60));
  const qty = window.match(/(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*(?:linear\s*feet|lin(?:ear)?\.?\s*ft\.?|\bLF\b|square\s*feet|sq\.?\s*ft\.?|\bSF\b)/i);
  if (!qty) return null;
  return { display: qty[0].replace(/\s+/g, " ").trim() };
}

function extractTimelineSignals(text, documents) {
  const signals = [];
  const patterns = [
    { type: "bid_due", label: "Bid Due", regex: /bid\s+(?:due|date|deadline|opening)[:\s-]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi },
    { type: "hearing_date", label: "Hearing Date", regex: /(?:planning\s+)?(?:commission\s+)?hearing(?:\s+date)?[:\s-]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi },
    { type: "approval_date", label: "Planning Approval", regex: /(?:approved|approval(?:\s+date)?)[:\s-]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi },
    { type: "construction_start", label: "Construction Start", regex: /(?:construction\s+start|start\s+of\s+construction|commence(?:ment)?)[:\s-]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|Q[1-4]\s+\d{4})/gi },
    { type: "construction_completion", label: "Expected Completion", regex: /(?:completion|complete(?:d)? by|finish(?:ed)? by)[:\s-]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|Q[1-4]\s+\d{4})/gi },
    { type: "permit_issued", label: "Permit Issued", regex: /permit\s+issued[:\s-]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi },
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const sourceDoc = documents.find((doc) => doc.text.includes(match[0])) ?? documents[0];
      signals.push({
        type: pattern.type,
        label: pattern.label,
        value: match[1].replace(/\s+/g, " ").trim(),
        source: sourceDoc?.label ?? "project document",
        source_url: sourceDoc?.source_url ?? null,
        confidence: "medium",
      });
    }
  }
  return dedupeBy(signals, (row) => `${row.type}:${row.value}`).slice(0, 10);
}

function extractProcurement(text, documents) {
  const signals = [];
  const rules = [
    { path: "Public Bid", regex: /\bpublic\s+bid\b|\binvite(?:d)?\s+bid|\bbid\s+opening\b|\bsealed\s+bid\b/gi },
    { path: "RFP", regex: /\brequest\s+for\s+proposal\b|\bRFP\b/gi },
    { path: "RFQ", regex: /\brequest\s+for\s+qualifications?\b|\bRFQ\b/gi },
    { path: "Design-Build", regex: /\bdesign[-\s]?build\b/gi },
    { path: "GC Relationship", regex: /\bgeneral\s+contractor\b|\bGC\b|\bsubcontractor\b|\btrade\s+partner\b/gi },
    { path: "Developer Direct", regex: /\bdeveloper\b|\bbuilder\b|\bowner[-\s]?builder\b/gi },
    { path: "Subcontract Opportunity", regex: /\bsubcontract(?:or|ing)?\s+opportunit|\bbidding\s+to\s+GC\b/gi },
  ];
  for (const rule of rules) {
    const matches = text.match(rule.regex);
    if (!matches?.length) continue;
    const sourceDoc = documents.find((doc) => rule.regex.test(doc.text)) ?? documents[0];
    signals.push({
      path: rule.path,
      mentions: matches.length,
      source: sourceDoc?.label ?? "project document",
      source_url: sourceDoc?.source_url ?? null,
    });
  }
  const path = signals[0]?.path
    || (/\bpermit\b/i.test(text) ? "Permit / GC Relationship" : "Unknown");
  return { signals, path };
}

function extractDocumentContacts(text, opportunity, documents) {
  const contacts = [];
  const companyPatterns = [
    { role: "General Contractor", regex: /(?:general\s+contractor|GC|builder)\s*[:\-]\s*([A-Z][A-Za-z0-9&.,' -]{2,60})/g },
    { role: "Developer", regex: /(?:developer|client|owner)\s*[:\-]\s*([A-Z][A-Za-z0-9&.,' -]{2,60})/g },
    { role: "Architect", regex: /(?:architect(?:ural)?(?:\s+firm)?)\s*[:\-]\s*([A-Z][A-Za-z0-9&.,' -]{2,60})/g },
    { role: "Engineer", regex: /(?:civil\s+)?engineer(?:ing)?(?:\s+firm)?\s*[:\-]\s*([A-Z][A-Za-z0-9&.,' -]{2,60})/g },
  ];
  for (const pattern of companyPatterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const name = cleanContactName(match[1]);
      if (!name) continue;
      contacts.push({
        name,
        role: pattern.role,
        company: name,
        phone: null,
        email: null,
        source: documents[0]?.label ?? "project document",
        source_url: documents[0]?.source_url ?? null,
        confidence: "medium",
      });
    }
  }

  if (safeName(opportunity.general_contractor)) {
    contacts.push({
      name: opportunity.general_contractor,
      role: "General Contractor",
      company: opportunity.general_contractor,
      phone: null,
      email: null,
      source: "Opportunity record",
      source_url: opportunity.source_url ?? null,
      confidence: "high",
    });
  }
  if (safeName(opportunity.developer)) {
    contacts.push({
      name: opportunity.developer,
      role: "Developer",
      company: opportunity.developer,
      phone: null,
      email: null,
      source: "Opportunity record",
      source_url: opportunity.source_url ?? null,
      confidence: "high",
    });
  }
  if (safeName(opportunity.architect)) {
    contacts.push({
      name: opportunity.architect,
      role: "Architect",
      company: opportunity.architect,
      phone: null,
      email: null,
      source: "Opportunity record",
      source_url: opportunity.source_url ?? null,
      confidence: "high",
    });
  }

  return dedupeBy(contacts, (row) => `${row.role}:${normalizeKey(row.name)}`).slice(0, 12);
}

function extractTradeEvidence(text, opportunity, documents) {
  const trade = opportunity.primary_contractor_trade || "";
  const termsByTrade = {
    Fencing: ["fence", "fencing", "gate", "chain link", "perimeter"],
    Concrete: ["concrete", "stemwall", "stem wall", "foundation", "footing", "flatwork", "slab", "driveway", "sidewalk"],
    Roofing: ["roof", "roofing", "reroof", "re-roof", "shingle", "membrane"],
    HVAC: ["hvac", "heat pump", "package unit", "rtu", "mechanical"],
    Electrical: ["electrical", "solar", "panel", "photovoltaic"],
    Plumbing: ["plumbing", "repipe", "sewer", "water line"],
  };
  const terms = termsByTrade[trade] ?? [String(trade).toLowerCase()].filter(Boolean);
  const evidence = [];
  for (const term of terms) {
    const idx = text.toLowerCase().indexOf(term);
    if (idx < 0) continue;
    const snippet = snippetAround(text, idx, 110);
    const sourceDoc = documents.find((doc) => doc.text.toLowerCase().includes(term)) ?? documents[0];
    evidence.push({
      trade: trade || "Unknown",
      term,
      snippet,
      source: sourceDoc?.label ?? "project document",
      source_url: sourceDoc?.source_url ?? null,
      confidence: "high",
    });
    if (evidence.length >= 5) break;
  }
  return evidence;
}

function extractRiskSignals(text) {
  const signals = [];
  if (/no\s+fence|fencing\s+not\s+required|exclude(?:s|d)?\s+fence/i.test(text)) signals.push("Document language may exclude fencing scope.");
  if (/self[-\s]?perform|in[-\s]?house/i.test(text)) signals.push("GC may self-perform portions of the work.");
  if (/complete[d]?\s+project|finaled|closed\s+permit/i.test(text)) signals.push("Project may already be complete or finaled.");
  return signals;
}

function buildEvidenceQuotes(text, documents, scopeItems, quantities, tradeEvidence) {
  const quotes = [];
  for (const item of tradeEvidence.slice(0, 3)) {
    quotes.push({
      text: item.snippet,
      signal: item.term,
      source: item.source,
      source_url: item.source_url,
      confidence: item.confidence,
    });
  }
  for (const qty of quantities.slice(0, 2)) {
    quotes.push({
      text: qty.context,
      signal: qty.quantity,
      source: qty.source,
      source_url: qty.source_url,
      confidence: qty.confidence,
    });
  }
  for (const scope of scopeItems.slice(0, 2)) {
    const doc = documents.find((row) => row.label === scope.source) ?? documents[0];
    if (!doc) continue;
    const idx = doc.text.toLowerCase().indexOf(scope.label.split(" ")[0].toLowerCase());
    if (idx < 0) continue;
    quotes.push({
      text: snippetAround(doc.text, idx, 100),
      signal: scope.label,
      source: scope.source,
      source_url: scope.source_url,
      confidence: scope.confidence,
    });
  }
  return dedupeBy(quotes, (row) => row.text.slice(0, 80)).slice(0, 6);
}

function summarizeProjectDescription(opportunity, text, scopeItems) {
  if (opportunity.project_description && opportunity.project_description.length > 40) return truncate(opportunity.project_description, 280);
  if (scopeItems.length) {
    return `${opportunity.project_name} includes ${scopeItems.slice(0, 3).map((item) => item.label.toLowerCase()).join(", ")}.`;
  }
  const firstSentence = text.split(/[.!?]/).map((part) => part.trim()).find((part) => part.length > 30);
  return firstSentence ? truncate(firstSentence, 280) : opportunity.project_name;
}

function summarizeConstruction(opportunity, scopeItems, quantities) {
  const parts = [];
  if (scopeItems.length) parts.push(`Identified work: ${scopeItems.slice(0, 4).map((item) => item.label).join(", ")}.`);
  if (quantities.length) parts.push(`Quantities found: ${quantities.slice(0, 3).map((item) => item.quantity).join(", ")}.`);
  if (!parts.length) parts.push("Construction details are limited to the available source records.");
  return parts.join(" ");
}

function summarizeWhatIsBeingBuilt(opportunity, scopeItems) {
  if (opportunity.primary_scope && !/^unknown$/i.test(opportunity.primary_scope)) return opportunity.primary_scope;
  if (scopeItems.length) return scopeItems.slice(0, 3).map((item) => item.label).join(", ");
  return opportunity.project_name;
}

function summarizeWhyTradeMatters(trade, tradeEvidence, scopeItems, quantities) {
  if (tradeEvidence[0]?.snippet) return `Source document: “${tradeEvidence[0].snippet}”`;
  const tradeScopes = scopeItems.filter((item) => !trade || item.category.toLowerCase().includes(String(trade).toLowerCase()) || String(trade).toLowerCase().includes(item.category.toLowerCase().split(" ")[0]));
  if (tradeScopes[0] && quantities[0]) return `Documents reference ${tradeScopes[0].label.toLowerCase()} with quantity ${quantities[0].quantity}.`;
  if (tradeScopes[0]) return `Documents reference ${tradeScopes[0].label.toLowerCase()}.`;
  return trade ? `${trade} relevance is not yet confirmed in extracted document language.` : "Trade relevance is not yet confirmed in extracted document language.";
}

function summarizeScope(scopeItems, quantities) {
  if (!scopeItems.length && !quantities.length) return "No detailed scope items extracted from available documents yet.";
  const scopePart = scopeItems.slice(0, 5).map((item) => item.quantity ? `${item.label} (${item.quantity})` : item.label).join("; ");
  return scopePart || `Quantities noted: ${quantities.slice(0, 3).map((item) => item.quantity).join(", ")}.`;
}

function summarizeTimeline(signals) {
  if (!signals.length) return "No bid or construction dates extracted from available documents yet.";
  return signals.slice(0, 4).map((signal) => `${signal.label}: ${signal.value}`).join("\n");
}

function pickBestDocumentContact(contacts, opportunity) {
  const preferred = contacts.find((contact) => /general contractor/i.test(contact.role))
    || contacts.find((contact) => /developer/i.test(contact.role))
    || contacts[0]
    || null;
  if (preferred) return preferred;
  if (safeName(opportunity.general_contractor)) {
    return { name: opportunity.general_contractor, role: "General Contractor", company: opportunity.general_contractor, phone: null, email: null, source: "Opportunity record", confidence: "medium" };
  }
  return null;
}

function buildRecommendedAction(opportunity, trade, contacts, timeline, procurementPath) {
  const contact = contacts.find((row) => row.phone) || contacts[0];
  const due = timeline.find((row) => row.type === "bid_due");
  if (contact?.name && due) return `Contact ${contact.name} before bid due ${due.value} regarding ${String(trade || "trade").toLowerCase()} scope.`;
  if (contact?.name) return `Contact ${contact.name} about ${String(trade || "trade").toLowerCase()} work on ${cleanProjectName(opportunity.project_name)}.`;
  if (procurementPath === "Public Bid" && due) return `Review the public bid package and prepare ${String(trade || "trade").toLowerCase()} pricing before ${due.value}.`;
  return `Review source documents and identify who awards ${String(trade || "trade").toLowerCase()} work on this project.`;
}

function buildConfidenceReasoning(documents, scopeItems, quantities, tradeEvidence) {
  const parts = [];
  parts.push(`Reviewed ${documents.length} source document(s).`);
  parts.push(`${documents.filter((doc) => doc.fetched).length} remotely fetched.`);
  parts.push(`${scopeItems.length} scope item(s), ${quantities.length} quantity signal(s), ${tradeEvidence.length} trade evidence quote(s).`);
  if (documents.some((doc) => doc.ocr_ready)) parts.push("At least one PDF appears scan-like and is marked OCR-ready for a future pass.");
  return parts.join(" ");
}

function guessPrimaryTrade(workCategories, tradeEvidence) {
  if (tradeEvidence[0]?.trade) return tradeEvidence[0].trade;
  return workCategories[0] || "Unknown";
}

function snippetAround(text, index, radius = 100) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function cleanContactName(value) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
  if (cleaned.length < 3 || cleaned.length > 80) return null;
  if (/^(the|and|for|with|from)$/i.test(cleaned)) return null;
  return cleaned;
}

function safeName(value) {
  if (!value) return false;
  return !["unknown", "not identified", "n/a", "none"].includes(String(value).trim().toLowerCase());
}

function cleanProjectName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function truncate(value, max) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function dedupeBy(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function renderReport(rows, stats) {
  const withScope = rows.filter((row) => row.scope_items.length > 0);
  const withQty = rows.filter((row) => row.identified_quantities.length > 0);
  const lines = [
    "# Document Intelligence Report",
    "",
    `Generated: ${capturedAt}`,
    "",
    "## Coverage",
    "",
    `- Opportunities processed: ${rows.length}`,
    `- With scope items: ${withScope.length}`,
    `- With quantities: ${withQty.length}`,
    `- With timeline signals: ${rows.filter((row) => row.timeline_signals.length > 0).length}`,
    `- With evidence quotes: ${rows.filter((row) => row.evidence.length > 0).length}`,
    `- Fetch attempted: ${stats.attempted}, fetched: ${stats.fetched}, cached: ${stats.cached}, failed: ${stats.failed}, skipped: ${stats.skipped}`,
    "",
    "## Top Dossiers With Extracted Scope",
    "",
  ];

  for (const row of withScope.slice(0, 25)) {
    lines.push(`### ${row.project_name}`);
    lines.push("");
    lines.push(`- Trade: ${row.primary_trade}`);
    lines.push(`- What is being built: ${row.what_is_being_built}`);
    lines.push(`- Scope: ${row.scope_summary}`);
    if (row.identified_quantities.length) lines.push(`- Quantities: ${row.identified_quantities.map((item) => item.quantity).join(", ")}`);
    if (row.timeline_summary) lines.push(`- Timeline: ${row.timeline_summary.replace(/\n/g, " | ")}`);
    lines.push(`- Procurement: ${row.procurement_path}`);
    if (row.best_contact) lines.push(`- Best contact: ${row.best_contact.name} (${row.best_contact.role})`);
    if (row.evidence[0]) lines.push(`- Evidence: “${row.evidence[0].text}”`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

await main();
