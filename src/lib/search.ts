import { companies, permits, projectCompanies, projects, signals } from "./seed-data";
import { collectedPermits, collectedProjects, collectedSignals } from "./collected-data";
import { getSupabase } from "./supabase";

const aliases: Record<string, string[]> = {
  apartments: ["mixed use", "residential", "units", "homes"],
  subdivision: ["subdivision", "subdivisions", "residential", "filing"],
  subdivisions: ["subdivision", "residential", "filing"],
  fence: ["fence", "fencing", "subdivision", "industrial", "utility", "utilities", "perimeter", "security", "chain link", "gate", "parks", "schools", "site work"],
  fencing: ["fence", "fencing", "subdivision", "industrial", "utility", "utilities", "perimeter", "warehouse", "security", "gate", "chain link", "parks", "schools", "site work"],
  commercial: ["commercial", "tenant", "business", "retail", "warehouse"],
  industrial: ["industrial", "warehouse", "logistics", "outdoor", "storage", "utility"],
  hvac: ["mechanical", "commercial", "government"],
  warehouse: ["warehouse", "industrial", "logistics", "fencing", "site work"],
  land: ["land purchase", "parcel", "rezoning"],
  purchases: ["land purchase"],
  approved: ["approved"],
  active: ["permitted", "under construction", "planning application"],
  opportunity: ["permit", "planning application", "subdivision filing", "approved"],
  opportunities: ["permit", "planning application", "subdivision filing", "approved"],
  jobs: ["permit", "approved", "permitted", "under construction"],
  work: ["permit", "approved", "permitted", "under construction"],
  bids: ["government", "public works", "infrastructure"],
  bid: ["government", "public works", "infrastructure"],
  parks: ["public works", "bid", "vendor", "fencing", "perimeter"],
  park: ["public works", "bid", "vendor", "fencing", "perimeter"],
  schools: ["public works", "bid", "vendor", "fencing", "perimeter"],
  school: ["public works", "bid", "vendor", "fencing", "perimeter"],
  perimeter: ["fencing", "security", "gate", "chain link"],
  security: ["fencing", "perimeter", "gate", "chain link"],
  utilities: ["utility", "drainage", "infrastructure", "site work", "fencing"],
  utility: ["utilities", "drainage", "infrastructure", "site work", "fencing"],
  sam: ["government", "public works", "infrastructure"],
  months: ["permitted", "approved"],
  six: ["permitted", "approved"],
  "90": ["permitted", "issued", "fast money"],
  days: ["permitted", "issued", "fast money"],
  fast: ["permitted", "issued", "under construction"],
  money: ["permitted", "issued", "under construction"],
  roseville: ["roseville", "placer"],
  rocklin: ["rocklin", "placer"],
};

function terms(query: string) {
  const base = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1);
  return [...new Set(base.flatMap((term) => [term, ...(aliases[term] ?? [])]))];
}

function scoreText(values: unknown[], queryTerms: string[]) {
  const text = values.join(" ").toLowerCase();
  return queryTerms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

export async function globalSearch(q: string) {
  const query = q.trim();
  if (!query) return { projects: [], companies: [], permits: [], signals: [] };

  const db = getSupabase();
  if (db) {
    const [projectRows, companyRows, permitRows, signalRows] = await Promise.all([
      db.from("projects").select("*").textSearch("search_vector", query, { type: "websearch" }).limit(20),
      db.from("companies").select("*").or(`name.ilike.%${query}%,company_type.ilike.%${query}%,city.ilike.%${query}%`).limit(20),
      db.from("permits").select("*, projects(name, city, county)").or(`permit_number.ilike.%${query}%,permit_type.ilike.%${query}%`).limit(20),
      db.from("signals").select("*").or(`signal_type.ilike.%${query}%,description.ilike.%${query}%,source.ilike.%${query}%`).limit(20),
    ]);
    return {
      projects: projectRows.data ?? [],
      companies: companyRows.data ?? [],
      permits: permitRows.data ?? [],
      signals: signalRows.data ?? [],
    };
  }

  const queryTerms = terms(query);
  const companyMatches = companies.filter((company) => scoreText([company.name, company.company_type, company.city, company.notes], queryTerms) > 0);
  const matchedCompanyIds = new Set(companyMatches.map((company) => company.id));
  const companyProjectIds = new Set(projectCompanies.filter((link) => matchedCompanyIds.has(link.company_id)).map((link) => link.project_id));
  const allProjects = projects.concat(collectedProjects);
  const allPermits = permits.concat(collectedPermits);
  const allSignals = signals.concat(collectedSignals);

  const permitMatches = allPermits.filter((permit) => scoreText([permit.permit_number, permit.permit_type, permit.permit_status], queryTerms) > 0);
  const permitProjectIds = new Set(permitMatches.map((permit) => permit.project_id));
  const signalMatches = allSignals.filter((signal) => scoreText([signal.signal_type, signal.description, signal.source, signal.parcel_number, signal.jurisdiction], queryTerms) > 0);
  const signalProjectIds = new Set(signalMatches.map((signal) => signal.project_id).filter(Boolean));

  const scoredProjects = allProjects
    .map((project) => ({
      project,
      score:
        scoreText([project.name, project.description, project.city, project.county, project.status, project.project_type, project.address, project.source_name], queryTerms) * 3
        + (companyProjectIds.has(project.id) ? 4 : 0)
        + (signalProjectIds.has(project.id) ? 5 : 0)
        + (permitProjectIds.has(project.id) ? 2 : 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.project.updated_at.localeCompare(a.project.updated_at));

  return {
    projects: scoredProjects.slice(0, 25).map((item) => item.project),
    companies: companyMatches.slice(0, 8),
    permits: permitMatches.slice(0, 8).map((permit) => ({ ...permit, projects: allProjects.find((project) => project.id === permit.project_id)! })),
    signals: signalMatches.slice(0, 12),
  };
}
