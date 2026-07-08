import companyHumanContacts from "../../data/company_human_contacts.json";
import opportunityContacts from "../../data/opportunity_contacts.json";

export interface HumanContact {
  name?: string;
  title?: string;
  company: string;
  phone?: string;
  email?: string;
  contactType:
    | "direct"
    | "sales"
    | "construction"
    | "regional"
    | "corporate"
    | "vendor"
    | "trade_partner";
  confidence: number;
  source: string;
  evidence: string[];
}

export type OpportunityHumanContact = {
  opportunity_id: string;
  project_name: string;
  best_contact: HumanContact | null;
  contacts: HumanContact[];
  backup_access_route: string;
  recommended_next_step: string;
  contact_coverage: "Known Human Contact" | "Company Office Contact" | "Access Route Only" | "Unknown";
};

const contactsByOpportunity = new Map(
  (opportunityContacts as OpportunityHumanContact[]).map((row) => [row.opportunity_id, row])
);

const contactsByProjectName = new Map(
  (opportunityContacts as OpportunityHumanContact[]).map((row) => [normalizeKey(row.project_name), row])
);

const contactsByCompany = new Map(
  (companyHumanContacts as Array<{ company_profile_id: string; company: string; contacts: HumanContact[] }>).map((row) => [row.company_profile_id, row])
);

export function getOpportunityHumanContact(opportunityId: string) {
  return contactsByOpportunity.get(opportunityId) ?? null;
}

export function getOpportunityHumanContactForProject(projectId: string, projectName: string) {
  return (
    contactsByOpportunity.get(projectId)
    ?? contactsByOpportunity.get(`sac-${projectId}`)
    ?? contactsByProjectName.get(normalizeKey(projectName))
    ?? null
  );
}

export function getCompanyHumanContacts(companyProfileId: string) {
  return contactsByCompany.get(companyProfileId)?.contacts ?? [];
}

export function formatHumanContact(contact: HumanContact | null) {
  if (!contact) return "Unknown";
  const name = contact.name ?? contact.company;
  const title = contact.title ? `, ${contact.title}` : "";
  const route = contact.phone ?? contact.email ?? contact.source;
  return `${name}${title} - ${route}`;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
