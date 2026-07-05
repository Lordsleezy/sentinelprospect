import { companies, documents, permits, projectCompanies, projects, signals, sources } from "./seed-data";
import { collectedPermits, collectedProjects, collectedSignals, getCollectedProject, getCollectedProjectDetails } from "./collected-data";
import { getSupabase } from "./supabase";
import { generateOpportunities } from "./opportunities";
import type { Company, Document, Opportunity, Permit, Project, ProjectDetail, ProjectStatus, ProjectType, Signal } from "./types";

type ProjectFilters = {
  q?: string;
  city?: string;
  county?: string;
  project_type?: string;
  status?: string;
};

type PermitFilters = {
  q?: string;
  permit_type?: string;
  county?: string;
  status?: string;
  date?: string;
};

type PermitWithProjectSummary = Permit & { projects: Pick<Project, "city" | "county" | "name"> };

function includes(value: unknown, q: string) {
  return String(value ?? "").toLowerCase().includes(q.toLowerCase());
}

export async function getProjects(filters: ProjectFilters = {}) {
  const db = getSupabase();
  if (db) {
    let query = db.from("projects").select("*").order("updated_at", { ascending: false });
    if (filters.city) query = query.eq("city", filters.city);
    if (filters.county) query = query.eq("county", filters.county);
    if (filters.project_type) query = query.eq("project_type", filters.project_type);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.q) query = query.textSearch("search_vector", filters.q, { type: "websearch" });
    const { data, error } = await query;
    if (!error && data) return data as Project[];
  }

  return projects
    .concat(collectedProjects)
    .filter((p) => !filters.city || p.city === filters.city)
    .filter((p) => !filters.county || p.county === filters.county)
    .filter((p) => !filters.project_type || p.project_type === filters.project_type)
    .filter((p) => !filters.status || p.status === filters.status)
    .filter((p) => !filters.q || [p.name, p.description, p.city, p.county, p.project_type, p.status].some((v) => includes(v, filters.q!)))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  const db = getSupabase();
  if (db) {
    const { data, error } = await db.from("projects").select("*").eq("id", id).single();
    if (!error && data) {
      const [{ data: permitRows }, { data: documentRows }, { data: companyRows }, { data: signalRows }] = await Promise.all([
        db.from("permits").select("*").eq("project_id", id).order("permit_date", { ascending: false }),
        db.from("documents").select("*").eq("project_id", id).order("created_at", { ascending: false }),
        db.from("project_companies").select("role, companies(*)").eq("project_id", id),
        db.from("signals").select("*").eq("project_id", id).order("importance_score", { ascending: false }),
      ]);
      return {
        ...(data as Project),
        permits: (permitRows ?? []) as Permit[],
        documents: (documentRows ?? []) as Document[],
        signals: (signalRows ?? []) as Signal[],
        companies: ((companyRows ?? []) as unknown as Array<{ role: ProjectDetail["companies"][number]["role"]; companies: Company }>).map((row) => ({
          ...(Array.isArray(row.companies) ? row.companies[0] : row.companies),
          role: row.role,
        })),
      };
    }
  }

  const project = projects.find((item) => item.id === id);
  if (!project) return getCollectedProject(id);
  return {
    ...project,
    permits: permits.filter((permit) => permit.project_id === id),
    documents: documents.filter((document) => document.project_id === id),
    signals: signals.filter((signal) => signal.project_id === id).sort((a, b) => b.importance_score - a.importance_score),
    companies: projectCompanies
      .filter((link) => link.project_id === id)
      .map((link) => ({ ...companies.find((company) => company.id === link.company_id)!, role: link.role })),
  };
}

export async function getOpportunities(filters: { q?: string; horizon?: string; trade?: string; county?: string } = {}): Promise<Opportunity[]> {
  const db = getSupabase();
  if (db) {
    let query = db.from("opportunities").select("*").order("score", { ascending: false });
    if (filters.horizon) query = query.eq("horizon", filters.horizon);
    if (filters.trade) query = query.eq("trade", filters.trade);
    if (filters.county) query = query.eq("county", filters.county);
    if (filters.q) query = query.textSearch("search_vector", filters.q, { type: "websearch" });
    const { data, error } = await query;
    if (!error && data) return data as Opportunity[];
  }

  const projectDetails = [
    ...getCollectedProjectDetails(),
    ...(await Promise.all(projects.slice(0, 200).map((project) => getProject(project.id)))).filter(Boolean) as ProjectDetail[],
  ];
  return projectDetails
    .flatMap((project) => generateOpportunities(project))
    .filter((opportunity) => !filters.horizon || opportunity.horizon === filters.horizon)
    .filter((opportunity) => !filters.trade || opportunity.trade === filters.trade)
    .filter((opportunity) => !filters.county || opportunity.county === filters.county)
    .filter((opportunity) => !filters.q || [opportunity.title, opportunity.trade, opportunity.horizon, opportunity.city, opportunity.county, opportunity.recommended_action].some((value) => includes(value, filters.q!)))
    .sort((a, b) => b.score - a.score || a.horizon.localeCompare(b.horizon));
}

export async function getSignals(projectId?: string) {
  const db = getSupabase();
  if (db) {
    let query = db.from("signals").select("*").order("importance_score", { ascending: false });
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    if (!error && data) return data as Signal[];
  }
  return signals.concat(collectedSignals)
    .filter((signal) => !projectId || signal.project_id === projectId)
    .sort((a, b) => b.importance_score - a.importance_score);
}

export async function getPermits(filters: PermitFilters = {}) {
  const db = getSupabase();
  if (db) {
    let query = db.from("permits").select("*, projects(city, county, name)").order("permit_date", { ascending: false });
    if (filters.permit_type) query = query.eq("permit_type", filters.permit_type);
    if (filters.status) query = query.eq("permit_status", filters.status);
    if (filters.date) query = query.eq("permit_date", filters.date);
    if (filters.q) query = query.or(`permit_number.ilike.%${filters.q}%,permit_type.ilike.%${filters.q}%`);
    const { data, error } = await query;
    if (!error && data) {
      return (data as Array<Permit & { projects: Pick<Project, "city" | "county" | "name"> }>)
        .filter((permit) => !filters.county || permit.projects?.county === filters.county);
    }
  }

  const seedPermits: PermitWithProjectSummary[] = permits
    .map((permit) => {
      const project = projects.find((item) => item.id === permit.project_id)!;
      return { ...permit, projects: { city: project.city, county: project.county, name: project.name } };
    });

  return seedPermits
    .concat(collectedPermits)
    .filter((permit) => !filters.permit_type || permit.permit_type === filters.permit_type)
    .filter((permit) => !filters.county || permit.projects.county === filters.county)
    .filter((permit) => !filters.status || permit.permit_status === filters.status)
    .filter((permit) => !filters.date || permit.permit_date === filters.date)
    .filter((permit) => !filters.q || [permit.permit_number, permit.permit_type, permit.projects.name].some((v) => includes(v, filters.q!)))
    .sort((a, b) => b.permit_date.localeCompare(a.permit_date));
}

export async function getCompanies(q = "") {
  const db = getSupabase();
  if (db) {
    let query = db.from("companies").select("*").order("name");
    if (q) query = query.or(`name.ilike.%${q}%,company_type.ilike.%${q}%,city.ilike.%${q}%`);
    const { data, error } = await query;
    if (!error && data) return data as Company[];
  }

  return companies
    .filter((company) => !q || [company.name, company.company_type, company.city, company.notes].some((v) => includes(v, q)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSources() {
  const db = getSupabase();
  if (db) {
    const { data, error } = await db.from("sources").select("*").order("name");
    if (!error && data) return data;
  }
  return sources;
}

export async function getDashboardStats() {
  const [projectRows, permitRows, companyRows, sourceRows] = await Promise.all([getProjects(), getPermits(), getCompanies(), getSources()]);
  return {
    totalProjects: projectRows.length,
    totalPermits: permitRows.length,
    totalCompanies: companyRows.length,
    activeSources: sourceRows.filter((source) => source.active).length,
  };
}

export async function getFilterOptions() {
  return {
    cities: [...new Set(projects.concat(collectedProjects).map((p) => p.city))].sort(),
    counties: [...new Set(projects.concat(collectedProjects).map((p) => p.county))].sort(),
    projectTypes: [...new Set(projects.concat(collectedProjects).map((p) => p.project_type))].sort() as ProjectType[],
    statuses: [...new Set(projects.concat(collectedProjects).map((p) => p.status))].sort() as ProjectStatus[],
    permitTypes: [...new Set([...permits, ...collectedPermits].map((p) => p.permit_type))].sort(),
    permitStatuses: [...new Set([...permits, ...collectedPermits].map((p) => p.permit_status))].sort(),
  };
}
