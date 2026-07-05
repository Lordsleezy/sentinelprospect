import type { Company, Document, Permit, Project, ProjectCompany, Signal, SignalType, Source } from "./types";

const counties = [
  { county: "Sacramento County", cities: ["Sacramento", "Elk Grove", "Folsom", "Citrus Heights", "Rancho Cordova", "West Sacramento"], lat: 38.58, lng: -121.49 },
  { county: "Placer County", cities: ["Roseville", "Rocklin", "Lincoln", "Auburn", "Loomis"], lat: 38.79, lng: -121.25 },
  { county: "El Dorado County", cities: ["El Dorado Hills", "Placerville", "Cameron Park", "Shingle Springs"], lat: 38.73, lng: -120.8 },
  { county: "Nevada County", cities: ["Grass Valley", "Nevada City", "Penn Valley", "Truckee"], lat: 39.22, lng: -121.03 },
  { county: "Yuba County", cities: ["Marysville", "Linda", "Olivehurst", "Wheatland"], lat: 39.14, lng: -121.59 },
] as const;

const projectTypes = ["Residential", "Commercial", "Industrial", "Government", "Mixed Use", "Infrastructure"] as const;
const statuses = ["Planning", "Proposed", "Approved", "Permitted", "Under Construction", "Completed"] as const;
const companyTypes = ["Developer", "Builder", "General Contractor", "Architect", "Engineer", "Specialty Contractor"] as const;
const roles = ["developer", "builder", "contractor", "architect", "engineer"] as const;
const permitTypes = ["Grading", "Building", "Commercial Shell", "Subdivision Improvement", "Electrical", "Mechanical", "Solar Facility", "Public Works", "Warehouse Addition", "Design Review"];
const permitStatuses = ["Submitted", "In Review", "Approved", "Issued", "Finaled", "Pending"];
const signalTypes: SignalType[] = ["Land Purchase", "Parcel Split", "Rezoning", "Planning Application", "CEQA", "Subdivision Filing", "Environmental Review", "Permit", "Groundbreaking", "Construction Start", "Utility Expansion", "Infrastructure Project"];
const prefixes = ["Sierra", "Capital", "Riverbend", "Foothill", "North Valley", "Golden State", "Granite", "Summit", "Pacific", "Delta", "Heritage", "Civic"];
const suffixes = ["Development", "Builders", "Construction", "Engineering", "Design Group", "Partners", "Works", "Infrastructure", "Communities", "Industrial"];
const projectNouns = {
  Residential: ["Subdivision", "Estates", "Village", "Homes", "Ridge"],
  Commercial: ["Retail Center", "Market Hall", "Office Pads", "Business Park", "Service Plaza"],
  Industrial: ["Logistics Yard", "Cold Storage", "Warehouse", "Industrial Park", "Fabrication Facility"],
  Government: ["Civic Works", "Public Safety Center", "Maintenance Yard", "Library Renovation", "County Facility"],
  "Mixed Use": ["Town Center", "Village", "Main Street District", "Transit Village", "Commons"],
  Infrastructure: ["Solar Field", "Bridge Package", "Roadway Improvements", "Water Facility", "Utility Corridor"],
} as const;

function pick<T>(items: readonly T[], index: number) {
  return items[index % items.length];
}

function dateFromIndex(index: number) {
  const day = 1 + (index % 27);
  const month = 1 + (index % 6);
  return `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isoFromIndex(index: number) {
  return `${dateFromIndex(index)}T12:00:00Z`;
}

function moneyByType(type: Project["project_type"], index: number) {
  const base = {
    Residential: 3_500_000,
    Commercial: 2_200_000,
    Industrial: 7_500_000,
    Government: 4_500_000,
    "Mixed Use": 16_000_000,
    Infrastructure: 8_000_000,
  }[type];
  return base + (index % 70) * 1_150_000;
}

function unitsByType(type: Project["project_type"], index: number) {
  if (type === "Residential") return 8 + ((index * 11) % 520);
  if (type === "Mixed Use") return 24 + ((index * 7) % 340);
  return null;
}

export const companies: Company[] = Array.from({ length: 500 }, (_, i) => {
  const company_type = pick(companyTypes, i);
  const citySet = pick(counties, i);
  const name = `${pick(prefixes, i)} ${pick(suffixes, i * 3 + 2)} ${i + 1}`;
  return {
    id: `c-${String(i + 1).padStart(4, "0")}`,
    name,
    company_type,
    website: i % 9 === 0 ? null : `https://example.com/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    phone: i % 7 === 0 ? null : `(${916 + (i % 5) * 3}) 555-${String(1000 + i).slice(-4)}`,
    email: i % 8 === 0 ? null : `estimating${i + 1}@example.com`,
    city: pick(citySet.cities, i),
    state: "CA",
    notes: `${company_type} active in ${citySet.county}.`,
  };
});

export const projects: Project[] = Array.from({ length: 1000 }, (_, i) => {
  const type = pick(projectTypes, i);
  const area = pick(counties, i * 2);
  const city = pick(area.cities, i * 5);
  const noun = pick(projectNouns[type], i);
  const value = moneyByType(type, i);
  const units = unitsByType(type, i);
  return {
    id: `p-${String(i + 1).padStart(4, "0")}`,
    name: `${city} ${pick(prefixes, i + 4)} ${noun}`,
    description: `${type} project in ${city} with public records indicating contractor-relevant scope, site work, utility coordination, and trade opportunities.`,
    project_type: type,
    status: pick(statuses, i * 3 + Math.floor(i / 17)),
    city,
    county: area.county,
    state: "CA",
    address: `${100 + i} ${pick(["Main St", "Industrial Blvd", "Foothill Rd", "Market Dr", "Airport Rd", "Civic Center Way"], i)}, ${city}, CA`,
    latitude: Number((area.lat + ((i % 37) - 18) * 0.008).toFixed(5)),
    longitude: Number((area.lng + ((i % 41) - 20) * 0.009).toFixed(5)),
    estimated_units: units,
    estimated_value: value,
    source_url: `https://example.gov/projects/${i + 1}`,
    source_name: `${area.county.replace(" County", "")} Public Records`,
    created_at: isoFromIndex(i + 10),
    updated_at: isoFromIndex(180 - (i % 160)),
  };
});

export const permits: Permit[] = Array.from({ length: 5000 }, (_, i) => {
  const project = projects[i % projects.length];
  const type = pick(permitTypes, i * 2);
  return {
    id: `pm-${String(i + 1).padStart(5, "0")}`,
    project_id: project.id,
    permit_number: `${project.county.slice(0, 3).toUpperCase()}-${26 + (i % 2)}-${String(10000 + i)}`,
    permit_type: type,
    permit_status: pick(permitStatuses, i * 5),
    permit_date: dateFromIndex(i + 40),
    permit_value: Math.round((project.estimated_value ?? 1_000_000) * (0.03 + (i % 18) / 100)),
    source_url: `https://example.gov/permits/${10000 + i}`,
    created_at: isoFromIndex(i + 40),
  };
});

export const projectCompanies: ProjectCompany[] = projects.flatMap((project, i) =>
  roles.map((role, roleIndex) => ({
    project_id: project.id,
    company_id: companies[(i * 7 + roleIndex * 31) % companies.length].id,
    role,
  })),
);

export const documents: Document[] = projects.flatMap((project, i) => {
  const base = [
    { title: "Planning Staff Report", document_type: "Staff Report", summary: "Scope summary, conditions of approval, and agency comments." },
    { title: "Site Plan Package", document_type: "Site Plan", summary: "Plan sheets showing access, utilities, structures, and site improvements." },
  ];
  return base.map((doc, docIndex) => ({
    id: `d-${String(i * 2 + docIndex + 1).padStart(5, "0")}`,
    project_id: project.id,
    title: `${project.name} ${doc.title}`,
    document_type: doc.document_type,
    source_url: `https://example.gov/documents/${project.id}-${docIndex + 1}.pdf`,
    summary: doc.summary,
    created_at: isoFromIndex(i + docIndex + 70),
  }));
});

export const signals: Signal[] = projects.flatMap((project, i) => {
  const count = 2 + (i % 4);
  return Array.from({ length: count }, (_, signalIndex) => {
    const signal_type = pick(signalTypes, i + signalIndex * 3);
    return {
      id: `sig-${String(i * 5 + signalIndex + 1).padStart(5, "0")}`,
      project_id: project.id,
      signal_type,
      signal_date: dateFromIndex(i + signalIndex + 20),
      description: `${signal_type} detected for ${project.name}. This may indicate upcoming contractor opportunity around ${project.project_type.toLowerCase()} scope.`,
      source: project.source_name,
      importance_score: Math.min(100, 45 + (i % 35) + signalIndex * 8),
    };
  });
});

export const sources: Source[] = counties.map((area, i) => ({
  id: `s-${String(i + 1).padStart(3, "0")}`,
  name: `${area.county.replace(" County", "")} Public Records`,
  source_type: pick(["Planning Portal", "Permit Portal", "Planning Agendas", "Capital Projects", "Open Data"], i),
  base_url: `https://example.gov/${area.county.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  active: i !== 4,
  last_sync: isoFromIndex(190 - i),
  records_collected: 900 + i * 140,
}));
