import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const searchUrl = "https://api.sam.gov/opportunities/v2/search";
const outputPath = resolve("data/samgov-opportunities.json");
const apiKey = process.env.SAM_GOV_API_KEY;
const keywords = ["fencing", "site work", "concrete", "roofing", "HVAC", "electrical", "utility"];
const capturedAt = new Date().toISOString();

const records = [];
const sourceNotes = [];

if (!apiKey) {
  sourceNotes.push("SAM.gov Opportunities API requires SAM_GOV_API_KEY. No federal opportunities were collected in this run.");
} else {
  for (const keyword of keywords) {
    const params = new URLSearchParams({
      api_key: apiKey,
      limit: "10",
      offset: "0",
      postedFrom: formatSamDate(daysAgo(30)),
      postedTo: formatSamDate(new Date()),
      keyword,
    });
    const response = await fetch(`${searchUrl}?${params.toString()}`);
    if (!response.ok) {
      sourceNotes.push(`SAM.gov request failed for ${keyword}: ${response.status}`);
      continue;
    }
    const payload = await response.json();
    for (const item of payload.opportunitiesData ?? []) {
      const noticeId = text(item.noticeId) || text(item.solicitationNumber) || `${keyword}-${records.length}`;
      const sourceId = `samgov-${noticeId}`;
      if (records.some((record) => record.sourceId === sourceId)) continue;
      const normalized = normalizeRecord(item, keyword, capturedAt);
      records.push({
        sourceId,
        sourceName: "SAM.gov Contract Opportunities",
        sourceUrl: text(item.uiLink, "https://sam.gov/opportunities"),
        capturedAt,
        payload: { ...item, keyword },
        normalized,
      });
    }
  }
}

const artifact = {
  sourceName: "SAM.gov Contract Opportunities",
  sourceType: "SAM.gov Opportunities API",
  sourceUrl: searchUrl,
  capturedAt,
  query: { keywords },
  sourceNotes,
  records,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Stored ${records.length} SAM.gov source records at ${outputPath}`);
if (sourceNotes.length) console.log(sourceNotes.join("\n"));

function normalizeRecord(item, keyword, capturedAt) {
  const noticeId = text(item.noticeId) || text(item.solicitationNumber) || keyword;
  const trade = inferTrade({ ...item, keyword });
  const projectId = `samgov-${noticeId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const summary = buildDescription(item);
  return {
    project: {
      id: projectId,
      external_id: noticeId,
      name: text(item.title, "SAM.gov opportunity"),
      description: summary,
      project_type: "Government",
      status: "Permitted",
      city: inferCity(item),
      county: "Federal",
      state: inferState(item),
      address: inferPlace(item),
      latitude: 38.5816,
      longitude: -121.4944,
      estimated_units: null,
      estimated_value: null,
      source_url: text(item.uiLink, "https://sam.gov/opportunities"),
      source_name: "SAM.gov Contract Opportunities",
      created_at: capturedAt,
      updated_at: capturedAt,
    },
    permit: {
      id: `samgov-permit-${noticeId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      permit_number: text(item.solicitationNumber, noticeId),
      permit_type: text(item.type, "Contract Opportunity"),
      permit_status: text(item.active, "Active"),
      permit_date: text(item.postedDate, capturedAt.slice(0, 10)),
      permit_value: null,
      source_url: text(item.uiLink, "https://sam.gov/opportunities"),
      created_at: capturedAt,
    },
    signal: {
      id: `samgov-signal-${noticeId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      signal_type: "Permit",
      signal_date: text(item.postedDate, capturedAt.slice(0, 10)),
      description: `SAM.gov ${text(item.type, "opportunity")} notice: ${summary}`,
      source: "SAM.gov Contract Opportunities",
      source_url: text(item.uiLink, "https://sam.gov/opportunities"),
      external_id: noticeId,
      parcel_number: null,
      jurisdiction: "Federal",
      importance_score: 88,
    },
    evidence: {
      id: `samgov-evidence-${noticeId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      record_type: "source_record",
      record_id: noticeId,
      source_name: "SAM.gov Contract Opportunities",
      source_url: text(item.uiLink, "https://sam.gov/opportunities"),
      title: text(item.title, "SAM.gov opportunity"),
      summary,
      captured_at: capturedAt,
      confidence: 0.88,
      metadata: {
        source: "SAM.gov Opportunities API",
        notice_id: noticeId,
        solicitation_number: item.solicitationNumber,
        notice_type: item.type,
        response_deadline: item.responseDeadLine,
        agency: item.fullParentPathName,
        inferred_trades: [trade],
        revenue_windows: {},
        raw: item,
      },
    },
    contactCompany: extractAgency(item),
    inferredTrades: [trade],
    revenueWindows: {},
  };
}

function inferTrade(item) {
  const blob = `${text(item.title)} ${text(item.description)} ${text(item.keyword)} ${text(item.type)}`.toLowerCase();
  if (blob.includes("fenc")) return "Fencing";
  if (blob.includes("roof")) return "Roofing";
  if (blob.includes("hvac") || blob.includes("mechanical")) return "HVAC";
  if (blob.includes("electric")) return "Electrical";
  if (blob.includes("concrete")) return "Concrete";
  if (blob.includes("site") || blob.includes("utility")) return "Site work";
  return "General";
}

function extractAgency(item) {
  const name = text(item.fullParentPathName) || text(item.organizationName);
  if (!name) return null;
  return {
    id: `samgov-agency-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
    name,
    company_type: "Government buyer",
    website: null,
    phone: null,
    email: null,
    city: inferCity(item),
    state: inferState(item),
    notes: `Buyer/agency listed on SAM.gov notice ${text(item.noticeId) || text(item.solicitationNumber)}.`,
    role: "developer",
  };
}

function buildDescription(item) {
  return [text(item.title), text(item.type), text(item.fullParentPathName), text(item.responseDeadLine) ? `Response due ${text(item.responseDeadLine)}` : ""].filter(Boolean).join(" - ");
}

function inferPlace(item) {
  return item.placeOfPerformance ? JSON.stringify(item.placeOfPerformance) : "Federal opportunity";
}

function inferCity(item) {
  const place = inferPlace(item);
  return place.match(/"city":\s*"([^"]+)"/i)?.[1] ?? "Federal";
}

function inferState(item) {
  const place = inferPlace(item);
  return place.match(/"state":\s*"([^"]+)"/i)?.[1] ?? "US";
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function formatSamDate(date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
