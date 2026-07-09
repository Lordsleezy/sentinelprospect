import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

/**
 * Enrich company contacts from the official CSLB License Master list
 * (BusinessPhone is public) plus optional website scrape for emails.
 *
 * Usage:
 *   node scripts/enrich-company-contacts.mjs
 *   node scripts/enrich-company-contacts.mjs --download
 */

const args = new Set(process.argv.slice(2));
const shouldDownload = args.has("--download") || args.has("--force-download");
const masterPath = resolve("data/cslb-license-master.csv");
const tmpMasterPath = resolve("tmp/cslb-license-master.csv");
const capturedAt = new Date().toISOString();

const companyProfiles = (await readJson("data/company_profiles.json")) ?? [];
const descriptionBusinesses = (await readJson("data/description_named_businesses.json")) ?? [];
const existingWebSources = (await readJson("data/company_web_sources.json")) ?? [];
const existingContactWeb = (await readJson("data/contact_web_sources.json")) ?? [];

const enrichmentTargets = buildEnrichmentTargets(companyProfiles, descriptionBusinesses, existingWebSources);

await ensureMasterList();
const cslbMatches = await matchCslbPhones(enrichmentTargets, masterPath);
const websiteEnrichments = await scrapeKnownWebsites(enrichmentTargets, existingWebSources);

const enrichment = mergeEnrichments(enrichmentTargets, cslbMatches, websiteEnrichments, existingWebSources, existingContactWeb);
const updatedWebSources = upsertWebSources(existingWebSources, enrichment);
const updatedContactWeb = upsertContactWebSources(existingContactWeb, enrichment);

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/company_contact_enrichment.json", enrichment),
  writeJson("data/company_web_sources.json", updatedWebSources),
  writeJson("data/contact_web_sources.json", updatedContactWeb),
  writeFile(resolve("reports/company-contact-enrichment.md"), renderReport(enrichment)),
]);

const withPhone = enrichment.filter((row) => row.phone).length;
const withEmail = enrichment.filter((row) => row.email).length;
console.log(`Enriched companies: ${enrichment.length}.`);
console.log(`With phone: ${withPhone}.`);
console.log(`With email: ${withEmail}.`);
console.log(`Updated company_web_sources.json entries: ${updatedWebSources.length}.`);

async function ensureMasterList() {
  if (!shouldDownload && existsSync(masterPath)) {
    console.log(`Using existing CSLB master list at ${masterPath}.`);
    return;
  }
  if (!shouldDownload && existsSync(tmpMasterPath)) {
    console.log(`Promoting tmp CSLB master list to ${masterPath}.`);
    await mkdir(resolve("data"), { recursive: true });
    await copyFile(tmpMasterPath, masterPath);
    return;
  }

  console.log("Downloading CSLB License Master CSV (includes BusinessPhone)...");
  await mkdir(resolve("tmp"), { recursive: true });
  await mkdir(resolve("data"), { recursive: true });
  await downloadCslbMaster(masterPath);
  console.log(`Saved CSLB master list to ${masterPath}.`);
}

async function downloadCslbMaster(outPath) {
  const portal = "https://www.cslb.ca.gov/onlineservices/dataportal/ContractorList";
  const jar = new Map();

  const page1 = await fetch(portal, { headers: defaultHeaders() });
  captureCookies(jar, page1);
  const html1 = await page1.text();
  const state1 = extractAspNetState(html1);

  const selectBody = new URLSearchParams({
    __EVENTTARGET: "ctl00$MainContent$ddlStatus",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: state1.viewState,
    __VIEWSTATEGENERATOR: state1.viewStateGenerator,
    __EVENTVALIDATION: state1.eventValidation,
    "ctl00$MainContent$ddlStatus": "M",
  });
  const page2 = await fetch(portal, {
    method: "POST",
    headers: {
      ...defaultHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: selectBody,
  });
  captureCookies(jar, page2);
  const html2 = await page2.text();
  const state2 = extractAspNetState(html2);

  const downloadBody = new URLSearchParams({
    __EVENTTARGET: "ctl00$MainContent$lbMasterCSV",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: state2.viewState,
    __VIEWSTATEGENERATOR: state2.viewStateGenerator,
    __EVENTVALIDATION: state2.eventValidation,
    "ctl00$MainContent$ddlStatus": "M",
  });
  const fileResponse = await fetch(portal, {
    method: "POST",
    headers: {
      ...defaultHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: downloadBody,
  });
  if (!fileResponse.ok) {
    throw new Error(`CSLB download failed with status ${fileResponse.status}`);
  }
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  const head = buffer.subarray(0, 20).toString("utf8");
  if (!head.startsWith("LicenseNo")) {
    throw new Error(`CSLB download did not return CSV (starts with: ${head})`);
  }
  await writeFile(outPath, buffer);
}

function buildEnrichmentTargets(profiles, descriptionRows, webSources) {
  const byName = new Map();
  for (const profile of profiles) {
    byName.set(normalizeName(profile.company_name), {
      company_name: profile.company_name,
      official_website: profile.official_website ?? null,
      contact_page_url: profile.contact_page_url ?? null,
      phone: profile.phone ?? null,
    });
  }
  for (const row of descriptionRows) {
    const key = normalizeName(row.business_name);
    if (!key || byName.has(key)) continue;
    byName.set(key, {
      company_name: row.business_name,
      official_website: null,
      contact_page_url: null,
      phone: null,
    });
  }
  for (const source of webSources) {
    const key = normalizeName(source.company_name);
    if (!key) continue;
    const existing = byName.get(key) ?? {
      company_name: source.company_name,
      official_website: null,
      contact_page_url: null,
      phone: null,
    };
    existing.official_website = existing.official_website ?? source.official_website ?? null;
    existing.contact_page_url = existing.contact_page_url ?? source.contact_page_url ?? null;
    existing.phone = existing.phone ?? source.phone ?? null;
    byName.set(key, existing);
  }
  return [...byName.values()];
}

async function matchCslbPhones(profiles, csvPath) {
  const names = profiles.map((profile) => ({
    original: profile.company_name,
    key: normalizeName(profile.company_name),
    tokens: significantTokens(profile.company_name),
  }));
  const wanted = new Map(names.map((name) => [name.key, name]));
  const matches = [];

  const rl = createInterface({ input: createReadStream(csvPath) });
  let header = null;
  const cols = {};

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      header.forEach((name, index) => {
        cols[name] = index;
      });
      continue;
    }

    const row = parseCsvLine(line);
    const businessName = row[cols.BusinessName] || "";
    const fullBusinessName = row[cols.FullBusinessName] || "";
    const phone = formatPhone(row[cols.BusinessPhone] || "");
    const status = row[cols.PrimaryStatus] || "";
    const city = row[cols.City] || "";
    const county = row[cols.County] || "";
    const licenseNumber = row[cols.LicenseNo] || "";
    const address = row[cols.MailingAddress] || "";
    if (!phone) continue;

    const candidates = [fullBusinessName, businessName].filter(Boolean);
    for (const candidate of candidates) {
      const key = normalizeName(candidate);
      const direct = wanted.get(key);
      if (direct) {
        matches.push({
          company: direct.original,
          phone,
          city,
          county,
          license_number: licenseNumber,
          status,
          matched_as: candidate,
          address,
          score: scoreMatch(direct.tokens, key, status, county, true),
          source_url: `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=${licenseNumber}`,
        });
        continue;
      }

      for (const name of names) {
        if (!isStrongNameMatch(name.tokens, key)) continue;
        matches.push({
          company: name.original,
          phone,
          city,
          county,
          license_number: licenseNumber,
          status,
          matched_as: candidate,
          address,
          score: scoreMatch(name.tokens, key, status, county, false),
          source_url: `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=${licenseNumber}`,
        });
      }
    }
  }

  const best = new Map();
  for (const match of matches) {
    const previous = best.get(match.company);
    if (!previous || match.score > previous.score) best.set(match.company, match);
  }
  return [...best.values()];
}

async function scrapeKnownWebsites(profiles, webSources) {
  const byName = new Map(webSources.map((source) => [normalizeName(source.company_name), source]));
  const results = [];

  const seedSites = [
    { company: "ALLTECH GATES AND ENTRY CONTROLS INC", urls: ["https://alltechgates.com/", "https://www.alltechgates.com/"] },
    { company: "WATERS CONSTRUCTION COMPANY LLC", urls: ["https://watersconco.com/"] },
    { company: "PRIME HOME SOLUTIONS INC", urls: ["https://primehomesolutions.com/"] },
    { company: "KENNETH DEVELOPMENT INC", urls: ["https://www.kennethdevelopment.com/"] },
    { company: "Lund Construction Co", urls: ["https://lundconstruction.com/", "https://lundconstruction.com/contact"] },
    { company: "ADVANCED ROOF DESIGN INC", urls: ["https://www.ardroofing.com/", "https://www.ardroofing.com/contact"] },
  ];

  for (const profile of profiles) {
    const existing = byName.get(normalizeName(profile.company_name));
    const seeded = seedSites.find((item) => normalizeName(item.company) === normalizeName(profile.company_name));
    const urls = [
      ...(seeded?.urls ?? []),
      existing?.official_website,
      existing?.contact_page_url,
      profile.official_website,
      profile.contact_page_url,
    ].filter(Boolean);

    const uniqueUrls = [...new Set(urls)];
    if (!uniqueUrls.length) continue;

    let bestPhone = null;
    let bestEmail = null;
    let bestUrl = null;
    for (const url of uniqueUrls.slice(0, 3)) {
      try {
        const response = await fetch(url, {
          headers: defaultHeaders(),
          signal: AbortSignal.timeout(12000),
          redirect: "follow",
        });
        if (!response.ok) continue;
        const html = await response.text();
        const phones = extractPhones(html);
        const emails = extractEmails(html);
        if (phones[0] || emails[0]) {
          bestPhone = bestPhone ?? phones[0] ?? null;
          bestEmail = bestEmail ?? emails[0] ?? null;
          bestUrl = url;
        }
      } catch {
        // Website scrape is best-effort.
      }
    }

    if (bestPhone || bestEmail) {
      results.push({
        company: profile.company_name,
        phone: bestPhone,
        email: bestEmail,
        source_url: bestUrl,
        source_type: "official_website",
      });
    }
  }

  return results;
}

function mergeEnrichments(profiles, cslbMatches, websiteEnrichments, existingWebSources, existingContactWeb) {
  const cslbByCompany = new Map(cslbMatches.map((row) => [normalizeName(row.company), row]));
  const webByCompany = new Map(websiteEnrichments.map((row) => [normalizeName(row.company), row]));
  const existingByCompany = new Map(existingWebSources.map((row) => [normalizeName(row.company_name), row]));
  const contactByCompany = new Map(existingContactWeb.map((row) => [normalizeName(row.company_name), row]));

  return profiles.map((profile) => {
    const key = normalizeName(profile.company_name);
    const cslb = cslbByCompany.get(key);
    const web = webByCompany.get(key);
    const existing = existingByCompany.get(key);
    const contact = contactByCompany.get(key);

    const phone = formatPhone(cslb?.phone || web?.phone || existing?.phone || contact?.phone || profile.phone || null);
    const email = cleanEmail(web?.email || contact?.email || existing?.email || null);
    const website = existing?.official_website || web?.source_url || profile.official_website || null;
    const contactPage = existing?.contact_page_url || (web?.source_url?.includes("contact") ? web.source_url : null) || profile.contact_page_url || null;

    return {
      company_name: profile.company_name,
      phone,
      email,
      official_website: website,
      contact_page_url: contactPage,
      license_number: cslb?.license_number ?? null,
      license_status: cslb?.status ?? null,
      city: cslb?.city ?? null,
      county: cslb?.county ?? null,
      address: cslb?.address ?? null,
      cslb_source_url: cslb?.source_url ?? null,
      website_source_url: web?.source_url ?? null,
      enrichment_sources: [
        cslb ? "cslb_license_master" : null,
        web ? "website_scrape" : null,
        existing?.phone || existing?.email ? "company_web_sources" : null,
        contact?.phone || contact?.email ? "contact_web_sources" : null,
      ].filter(Boolean),
      confidence: phone ? (cslb ? 0.92 : web ? 0.75 : 0.7) : email ? 0.65 : 0.2,
      last_verified: capturedAt,
      evidence_summary: evidenceSummary(profile.company_name, phone, email, cslb, web),
    };
  }).filter((row) => row.phone || row.email || row.official_website || row.contact_page_url);
}

function upsertWebSources(existing, enrichment) {
  const byName = new Map(existing.map((row) => [normalizeName(row.company_name), structuredClone(row)]));

  for (const row of enrichment) {
    if (!row.phone && !row.email && !row.official_website) continue;
    const key = normalizeName(row.company_name);
    const current = byName.get(key) ?? {
      company_name: row.company_name,
      sources: [],
      procurement_paths: [],
    };

    if (row.phone) current.phone = row.phone;
    if (row.email) current.email = row.email;
    if (row.official_website) current.official_website = row.official_website;
    if (row.contact_page_url) current.contact_page_url = row.contact_page_url;

    current.sources = current.sources ?? [];
    if (row.phone && row.cslb_source_url) {
      upsertSource(current.sources, {
        source_type: "public_license_record",
        source_name: "CSLB License Master (BusinessPhone)",
        source_url: row.cslb_source_url,
        field_name: "phone",
        field_value: row.phone,
        excerpt: `CSLB public license record lists business phone ${row.phone} for ${row.company_name}${row.license_number ? ` (license ${row.license_number})` : ""}.`,
      });
    }
    if (row.email && row.website_source_url) {
      upsertSource(current.sources, {
        source_type: "official_website",
        source_name: "Company website contact scrape",
        source_url: row.website_source_url,
        field_name: "email",
        field_value: row.email,
        excerpt: `Company website lists email ${row.email}.`,
      });
    }

    if (row.phone || row.email) {
      current.procurement_paths = current.procurement_paths ?? [];
      const pathUrl = row.contact_page_url || row.cslb_source_url || row.official_website || row.website_source_url;
      if (pathUrl && !current.procurement_paths.some((path) => path.path_url === pathUrl)) {
        current.procurement_paths.push({
          path_type: "general_contact",
          path_url: pathUrl,
          source_url: pathUrl,
          source_type: row.cslb_source_url ? "public_license_record" : "official_website",
          confidence: row.confidence,
          contractor_value: row.phone ? "High" : "Medium",
          evidence_summary: row.evidence_summary,
        });
      }
    }

    byName.set(key, current);
  }

  return [...byName.values()].sort((a, b) => a.company_name.localeCompare(b.company_name));
}

function upsertContactWebSources(existing, enrichment) {
  const byName = new Map(existing.map((row) => [normalizeName(row.company_name), structuredClone(row)]));
  for (const row of enrichment) {
    if (!row.phone && !row.email) continue;
    const key = normalizeName(row.company_name);
    const current = byName.get(key) ?? {
      company_name: row.company_name,
      sources: [],
    };
    if (row.phone) current.phone = row.phone;
    if (row.email) current.email = row.email;
    if (row.official_website) current.website = row.official_website;
    current.sources = current.sources ?? [];
    if (row.phone && row.cslb_source_url) {
      upsertSource(current.sources, {
        source_type: "public_license_record",
        source_name: "CSLB License Master",
        source_url: row.cslb_source_url,
        field_name: "phone",
        field_value: row.phone,
        excerpt: row.evidence_summary,
      });
    }
    if (row.email && (row.website_source_url || row.official_website)) {
      upsertSource(current.sources, {
        source_type: "official_website",
        source_name: "Company website",
        source_url: row.website_source_url || row.official_website,
        field_name: "email",
        field_value: row.email,
        excerpt: `Website lists ${row.email}.`,
      });
    }
    byName.set(key, current);
  }
  return [...byName.values()].sort((a, b) => a.company_name.localeCompare(b.company_name));
}

function upsertSource(sources, source) {
  const index = sources.findIndex((item) => item.field_name === source.field_name && item.source_url === source.source_url);
  if (index >= 0) sources[index] = source;
  else sources.push(source);
}

function evidenceSummary(company, phone, email, cslb, web) {
  const parts = [];
  if (phone && cslb) parts.push(`CSLB license ${cslb.license_number} lists business phone ${phone}.`);
  else if (phone && web) parts.push(`Company website lists phone ${phone}.`);
  else if (phone) parts.push(`Source-backed phone ${phone} found for ${company}.`);
  if (email) parts.push(`Source-backed email ${email} found for ${company}.`);
  return parts.join(" ") || `No direct phone/email enrichment yet for ${company}.`;
}

function isStrongNameMatch(tokens, candidateKey) {
  if (tokens.length < 2) return false;
  const candidateTokens = new Set(candidateKey.split(" ").filter(Boolean));
  // Require whole-token matches (avoids "us" matching inside "kustom").
  if (!tokens.every((token) => candidateTokens.has(token))) return false;
  if (tokens.length === 2 && tokens.every((token) => token.length <= 5)) return false;
  // Avoid matching short brand tokens into unrelated longer names.
  if (tokens.length <= 2 && candidateTokens.size - tokens.length >= 2) return false;
  const overlap = tokens.filter((token) => candidateTokens.has(token)).length;
  return overlap >= Math.min(tokens.length, 3) || (overlap === tokens.length && tokens.join(" ").length >= 12);
}

function scoreMatch(tokens, candidateKey, status, county, exact) {
  let score = exact ? 100 : 70;
  score += Math.min(20, tokens.join(" ").length);
  if (/CLEAR/i.test(status)) score += 15;
  if (/sacramento|placer|el dorado|yolo|sutter|butte/i.test(county)) score += 20;
  if (candidateKey.split(" ").length - tokens.length > 3) score -= 10;
  return score;
}

function significantTokens(value) {
  return normalizeName(value)
    .split(" ")
    .filter((token) => token.length > 1)
    .filter((token) => !["and", "of", "dba"].includes(token));
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(inc|incorporated|llc|corp|corporation|co|company|ltd|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  const cleaned = String(value).trim();
  return cleaned || null;
}

function extractPhones(html) {
  const text = String(html ?? "");
  const matches = [...text.matchAll(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g)]
    .map((match) => formatPhone(match[0]))
    .filter(Boolean)
    .filter((phone) => !/^\(555\)/.test(phone));
  return [...new Set(matches)];
}

function extractEmails(html) {
  const text = String(html ?? "");
  const matches = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
    .map((match) => cleanEmail(match[0]))
    .filter(Boolean);
  return [...new Set(matches)];
}

function cleanEmail(value) {
  if (!value) return null;
  const email = String(value).trim().toLowerCase().replace(/^%20/, "");
  if (!email.includes("@")) return null;
  if (/(example\.com|sentry\.|wixpress|cloudflare|schema\.org|github\.com|w3\.org|domain\.com|email\.com|caanet\.org|forcabinetsake\.com)/i.test(email)) return null;
  if (/^(user|test|name)@/i.test(email)) return null;
  return email;
}

function extractAspNetState(html) {
  return {
    viewState: matchInput(html, "__VIEWSTATE"),
    viewStateGenerator: matchInput(html, "__VIEWSTATEGENERATOR"),
    eventValidation: matchInput(html, "__EVENTVALIDATION"),
  };
}

function matchInput(html, id) {
  const match = html.match(new RegExp(`id="${id}" value="([^"]*)"`));
  if (!match) throw new Error(`Missing ASP.NET field ${id}`);
  return match[1];
}

function defaultHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (compatible; SentinelProspects/1.0; +https://github.com/Lordsleezy/sentinelprospect)",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
}

function captureCookies(jar, response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [pair] = cookie.split(";");
    const [name, ...rest] = pair.split("=");
    jar.set(name, rest.join("="));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

function renderReport(rows) {
  const withPhone = rows.filter((row) => row.phone);
  const withEmail = rows.filter((row) => row.email);
  return [
    "# Company Contact Enrichment",
    "",
    `Generated: ${capturedAt}`,
    "",
    `- Companies enriched: ${rows.length}`,
    `- With phone: ${withPhone.length}`,
    `- With email: ${withEmail.length}`,
    `- Primary source: CSLB License Master BusinessPhone (public record)`,
    "",
    "## Phones",
    "",
    ...withPhone.map((row) => `- **${row.company_name}**: ${row.phone}${row.email ? ` / ${row.email}` : ""} (${row.enrichment_sources.join(", ")})`),
    "",
    "## Emails",
    "",
    ...(withEmail.length ? withEmail.map((row) => `- **${row.company_name}**: ${row.email}`) : ["- None yet"]),
    "",
  ].join("\n");
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
