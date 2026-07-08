import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const companyProfiles = await readJson("data/company_profiles.json") ?? [];
const companyBehavior = await readJson("data/company_behavior.json") ?? [];
const documentExtractions = await readJson("data/document_extraction_results.json") ?? [];
const historicalRelationships = await readJson("data/historical_relationships.json") ?? [];
const relationshipEvidence = await readJson("data/relationship_evidence.json") ?? [];
const capturedAt = new Date().toISOString();

const graph = buildRelationshipGraph({
  companyProfiles,
  companyBehavior,
  documentExtractions,
  historicalRelationships,
  relationshipEvidence,
  capturedAt,
});

await mkdir(resolve("data"), { recursive: true });
await mkdir(resolve("reports"), { recursive: true });
await Promise.all([
  writeJson("data/relationship_graph.json", graph),
  writeJson("data/relationship_graph_nodes.json", graph.nodes),
  writeJson("data/relationship_graph_edges.json", graph.edges),
  writeFile(resolve("reports/top-developers.md"), renderTopDevelopers(graph)),
  writeFile(resolve("reports/top-general-contractors.md"), renderTopGeneralContractors(graph)),
  writeFile(resolve("reports/top-relationships.md"), renderTopRelationships(graph)),
  writeFile(resolve("reports/repeated-relationships.md"), renderRepeatedRelationships(graph)),
  writeFile(resolve("reports/opportunity-networks.md"), renderOpportunityNetworks(graph)),
]);

console.log(`Relationship graph nodes: ${graph.nodes.length}.`);
console.log(`Relationship graph edges: ${graph.edges.length}.`);
console.log(`Repeated relationships: ${graph.edges.filter((edge) => edge.project_count > 1 || edge.relationship_count > 1).length}.`);

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

function buildRelationshipGraph(inputs) {
  const nodes = new Map();
  const edges = new Map();
  const profileById = new Map(inputs.companyProfiles.map((profile) => [profile.id, profile]));
  const profileByName = new Map(inputs.companyProfiles.map((profile) => [normalizeName(profile.company_name), profile]));

  for (const profile of inputs.companyProfiles) {
    addNode(nodes, companyNode(profile, inputs.capturedAt));
  }

  for (const document of inputs.documentExtractions) {
    const projectNodeId = nodeId("Project", document.project_name);
    addNode(nodes, {
      id: projectNodeId,
      type: "Project",
      name: document.project_name,
      evidence_count: document.evidence_count ?? 1,
      project_count: 1,
      relationship_count: 0,
      first_seen: document.last_verified,
      last_seen: document.last_verified,
      confidence: averageConfidence(document.extractions),
      metadata: {
        source_url: document.source_url,
        source_type: document.source_type,
        location: document.location,
      },
    });

    const city = cityFromLocation(document.location);
    const county = countyFromLocation(document.location);
    if (city) {
      addNode(nodes, placeNode("City", city, document.last_verified));
      addEdge(edges, {
        from_node_id: projectNodeId,
        to_node_id: nodeId("City", city),
        relationship_type: "project_city",
        project_name: document.project_name,
        source_url: document.source_url,
        evidence_count: 1,
        confidence: 0.7,
        seen_at: document.last_verified,
      });
    }
    if (county) {
      addNode(nodes, placeNode("County", county, document.last_verified));
      addEdge(edges, {
        from_node_id: projectNodeId,
        to_node_id: nodeId("County", county),
        relationship_type: "project_county",
        project_name: document.project_name,
        source_url: document.source_url,
        evidence_count: 1,
        confidence: 0.7,
        seen_at: document.last_verified,
      });
    }

    for (const trade of document.trades ?? []) {
      addNode(nodes, tradeNode(trade, document.last_verified));
      addEdge(edges, {
        from_node_id: projectNodeId,
        to_node_id: nodeId("Trade", trade),
        relationship_type: "project_trade",
        project_name: document.project_name,
        source_url: document.source_url,
        evidence_count: 1,
        confidence: 0.68,
        seen_at: document.last_verified,
      });
    }

    const companies = (document.companies ?? [])
      .map((company) => profileByName.get(normalizeName(company.name)) ?? companyProfileFromEvidence(company, inputs.capturedAt))
      .filter(Boolean);

    for (const company of companies) {
      addNode(nodes, companyObservationNode(company, document.last_verified));
      addEdge(edges, {
        from_node_id: projectNodeId,
        to_node_id: companyNodeId(company),
        relationship_type: projectRelationshipForCompany(company.company_type),
        project_name: document.project_name,
        source_url: document.source_url,
        evidence_count: 1,
        confidence: 0.78,
        seen_at: document.last_verified,
      });
    }

    for (const relationship of document.relationships ?? []) {
      const from = profileByName.get(normalizeName(relationship.from_company));
      const to = profileByName.get(normalizeName(relationship.to_company));
      if (!from || !to) continue;
      addEdge(edges, {
        from_node_id: companyNodeId(from),
        to_node_id: companyNodeId(to),
        relationship_type: relationship.relationship_type,
        project_name: relationship.project_name,
        source_url: relationship.source_url,
        evidence_count: 1,
        confidence: relationship.confidence,
        seen_at: relationship.last_verified,
      });
    }
  }

  for (const relationship of inputs.historicalRelationships) {
    const from = profileById.get(relationship.from_company_profile_id);
    const to = profileById.get(relationship.to_company_profile_id);
    if (!from || !to) continue;
    for (const project of relationship.projects ?? []) {
      addEdge(edges, {
        from_node_id: companyNodeId(from),
        to_node_id: companyNodeId(to),
        relationship_type: relationship.relationship_type,
        project_name: project.project_name,
        source_url: project.source_url,
        evidence_count: 1,
        confidence: relationship.confidence,
        seen_at: relationship.last_verified,
      });
    }
  }

  for (const behavior of inputs.companyBehavior) {
    const profile = profileById.get(behavior.company_profile_id);
    if (!profile) continue;
    const id = companyNodeId(profile);
    const node = nodes.get(id);
    if (!node) continue;
    node.project_count = Math.max(node.project_count, behavior.project_count ?? 0);
    node.evidence_count = Math.max(node.evidence_count, behavior.evidence_count ?? 0);
    node.metadata = {
      ...node.metadata,
      known_trades: behavior.known_trades ?? [],
      procurement_path_count: behavior.procurement_paths?.length ?? 0,
    };
  }

  const edgeRows = [...edges.values()]
    .map((edge) => {
      return {
        id: edge.id,
        from_node_id: edge.from_node_id,
        to_node_id: edge.to_node_id,
        relationship_type: edge.relationship_type,
        relationship_count: edge.relationship_count,
        evidence_count: edge.evidence_count,
        project_count: edge.project_count,
        first_seen: edge.first_seen,
        last_seen: edge.last_seen,
        projects: [...edge.projects.values()].sort((a, b) => a.project_name.localeCompare(b.project_name)),
        source_urls: [...edge.source_urls].sort(),
        confidence: Number((edge.confidence_total / edge.relationship_count).toFixed(2)),
      };
    })
    .sort((a, b) => b.relationship_count - a.relationship_count || b.project_count - a.project_count || a.relationship_type.localeCompare(b.relationship_type));

  for (const edge of edgeRows) {
    const from = nodes.get(edge.from_node_id);
    const to = nodes.get(edge.to_node_id);
    if (from) from.relationship_count += edge.relationship_count;
    if (to) to.relationship_count += edge.relationship_count;
  }

  return {
    generated_at: inputs.capturedAt,
    summary: {
      node_count: nodes.size,
      edge_count: edgeRows.length,
      repeated_relationship_count: edgeRows.filter((edge) => isOrganizationRelationship(edge) && edge.project_count > 1).length,
      evidence_document_count: inputs.documentExtractions.length,
      historical_relationship_count: inputs.historicalRelationships.length,
    },
    nodes: [...nodes.values()].sort((a, b) => a.type.localeCompare(b.type) || b.project_count - a.project_count || a.name.localeCompare(b.name)),
    edges: edgeRows,
  };
}

function addNode(nodes, node) {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, node);
    return;
  }
  existing.evidence_count += node.evidence_count ?? 0;
  existing.project_count = Math.max(existing.project_count, node.project_count ?? 0);
  existing.first_seen = minDate(existing.first_seen, node.first_seen);
  existing.last_seen = maxDate(existing.last_seen, node.last_seen);
  existing.confidence = Math.max(existing.confidence, node.confidence ?? 0);
  existing.metadata = { ...existing.metadata, ...node.metadata };
}

function addEdge(edges, input) {
  const key = `${input.from_node_id}|${input.to_node_id}|${input.relationship_type}`;
  const existing = edges.get(key) ?? {
    id: `edge-${slug(key)}`,
    from_node_id: input.from_node_id,
    to_node_id: input.to_node_id,
    relationship_type: input.relationship_type,
    relationship_count: 0,
    evidence_count: 0,
    project_count: 0,
    projects: new Map(),
      source_urls: new Set(),
      evidence_keys: new Set(),
    first_seen: input.seen_at,
    last_seen: input.seen_at,
    confidence_total: 0,
  };
  const evidenceKey = `${input.project_name ?? "unknown"}|${input.source_url ?? "unknown"}`;
  if (!existing.evidence_keys.has(evidenceKey)) {
    existing.relationship_count += 1;
    existing.evidence_count += input.evidence_count ?? 1;
    existing.confidence_total += Number(input.confidence) || 0;
    existing.evidence_keys.add(evidenceKey);
  }
  if (input.project_name) {
    existing.projects.set(input.project_name, {
      project_name: input.project_name,
      source_url: input.source_url ?? "Unknown",
    });
  }
  existing.project_count = existing.projects.size;
  if (input.source_url) existing.source_urls.add(input.source_url);
  existing.first_seen = minDate(existing.first_seen, input.seen_at);
  existing.last_seen = maxDate(existing.last_seen, input.seen_at);
  edges.set(key, existing);
}

function renderTopDevelopers(graph) {
  const rows = companyRows(graph, "Developer").slice(0, 25);
  return [
    "# Top Developers",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows, [
      ["Developer", (row) => row.name],
      ["Projects", (row) => row.project_count],
      ["Relationships", (row) => row.relationship_count],
      ["Evidence Count", (row) => row.evidence_count],
      ["First Seen", (row) => dateOnly(row.first_seen)],
      ["Last Seen", (row) => dateOnly(row.last_seen)],
      ["Confidence", (row) => pct(row.confidence)],
      ["Why Pay Attention", (row) => attentionReason(row)],
    ]),
  ].join("\n");
}

function renderTopGeneralContractors(graph) {
  const rows = companyRows(graph, "General Contractor").slice(0, 25);
  return [
    "# Top General Contractors",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows, [
      ["General Contractor", (row) => row.name],
      ["Projects", (row) => row.project_count],
      ["Relationships", (row) => row.relationship_count],
      ["Evidence Count", (row) => row.evidence_count],
      ["First Seen", (row) => dateOnly(row.first_seen)],
      ["Last Seen", (row) => dateOnly(row.last_seen)],
      ["Confidence", (row) => pct(row.confidence)],
      ["Known Trades", (row) => topLabels(row.metadata.known_trades ?? [])],
    ]),
  ].join("\n");
}

function renderTopRelationships(graph) {
  const rows = graph.edges.filter((edge) => isOrganizationRelationship(edge)).slice(0, 30);
  return [
    "# Top Relationships",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    table(rows, [
      ["From", (row) => nodeName(graph, row.from_node_id)],
      ["To", (row) => nodeName(graph, row.to_node_id)],
      ["Type", (row) => row.relationship_type],
      ["Relationship Count", (row) => row.relationship_count],
      ["Project Count", (row) => row.project_count],
      ["Evidence Count", (row) => row.evidence_count],
      ["First Seen", (row) => dateOnly(row.first_seen)],
      ["Last Seen", (row) => dateOnly(row.last_seen)],
      ["Confidence", (row) => pct(row.confidence)],
    ]),
  ].join("\n");
}

function renderRepeatedRelationships(graph) {
  const rows = graph.edges.filter((edge) => isOrganizationRelationship(edge) && edge.project_count > 1);
  return [
    "# Repeated Relationships",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    rows.length ? table(rows, [
      ["From", (row) => nodeName(graph, row.from_node_id)],
      ["To", (row) => nodeName(graph, row.to_node_id)],
      ["Type", (row) => row.relationship_type],
      ["Projects", (row) => row.projects.map((project) => project.project_name).join(", ")],
      ["Project Count", (row) => row.project_count],
      ["Evidence Count", (row) => row.evidence_count],
      ["Confidence", (row) => pct(row.confidence)],
    ]) : "_No repeated organization-to-organization relationships are source-backed yet._",
  ].join("\n");
}

function renderOpportunityNetworks(graph) {
  const rows = graph.nodes
    .filter((node) => ["Developer", "General Contractor", "Architect", "Engineer", "Property Owner"].includes(node.type))
    .sort((a, b) => b.project_count - a.project_count || b.relationship_count - a.relationship_count || b.evidence_count - a.evidence_count || a.name.localeCompare(b.name))
    .slice(0, 30);

  return [
    "# Opportunity Networks",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Graph nodes: ${graph.summary.node_count}`,
    `- Graph relationships: ${graph.summary.edge_count}`,
    `- Repeated relationships: ${graph.summary.repeated_relationship_count}`,
    `- Evidence documents represented: ${graph.summary.evidence_document_count}`,
    "",
    "## Organizations Contractors Should Watch",
    "",
    table(rows, [
      ["Organization", (row) => row.name],
      ["Type", (row) => row.type],
      ["Projects", (row) => row.project_count],
      ["Relationships", (row) => row.relationship_count],
      ["Evidence Count", (row) => row.evidence_count],
      ["Procurement Paths", (row) => row.metadata.procurement_path_count ?? 0],
      ["Connected To", (row) => connectedNames(graph, row.id).join(", ") || "Unknown"],
      ["Reason", (row) => attentionReason(row)],
    ]),
  ].join("\n");
}

function companyRows(graph, type) {
  return graph.nodes
    .filter((node) => node.type === type)
    .sort((a, b) => b.project_count - a.project_count || b.relationship_count - a.relationship_count || b.evidence_count - a.evidence_count || a.name.localeCompare(b.name));
}

function companyNode(profile, seenAt) {
  return {
    id: companyNodeId(profile),
    type: profile.company_type,
    name: profile.company_name,
    evidence_count: profile.source_count ?? 1,
    project_count: profile.metadata?.collector_project_count ?? 0,
    relationship_count: 0,
    first_seen: seenAt ?? profile.last_verified,
    last_seen: seenAt ?? profile.last_verified,
    confidence: profile.profile_confidence ?? 0.5,
    metadata: {
      company_profile_id: profile.id,
      website: profile.official_website,
      procurement_path_count: 0,
    },
  };
}

function companyObservationNode(profile, seenAt) {
  return {
    id: companyNodeId(profile),
    type: profile.company_type,
    name: profile.company_name,
    evidence_count: 1,
    project_count: 1,
    relationship_count: 0,
    first_seen: seenAt ?? profile.last_verified,
    last_seen: seenAt ?? profile.last_verified,
    confidence: profile.profile_confidence ?? 0.5,
    metadata: {
      company_profile_id: profile.id,
      website: profile.official_website,
      procurement_path_count: 0,
    },
  };
}

function companyProfileFromEvidence(company, capturedAt) {
  return {
    id: `evidence-company-${slug(company.name)}`,
    company_name: company.name,
    company_type: company.role,
    source_count: 1,
    profile_confidence: 0.68,
    last_verified: capturedAt,
    metadata: { collector_project_count: 0 },
  };
}

function placeNode(type, name, seenAt) {
  return {
    id: nodeId(type, name),
    type,
    name,
    evidence_count: 1,
    project_count: 1,
    relationship_count: 0,
    first_seen: seenAt,
    last_seen: seenAt,
    confidence: 0.7,
    metadata: {},
  };
}

function tradeNode(name, seenAt) {
  return {
    id: nodeId("Trade", name),
    type: "Trade",
    name,
    evidence_count: 1,
    project_count: 1,
    relationship_count: 0,
    first_seen: seenAt,
    last_seen: seenAt,
    confidence: 0.68,
    metadata: {},
  };
}

function projectRelationshipForCompany(companyType) {
  if (companyType === "Developer") return "project_developer";
  if (companyType === "General Contractor") return "project_gc";
  if (companyType === "Architect") return "project_architect";
  if (companyType === "Engineer") return "project_engineer";
  if (companyType === "Property Owner") return "project_property_owner";
  return "project_company";
}

function isOrganizationRelationship(edge) {
  return ["developer_gc", "developer_architect", "developer_engineer", "developer_property_owner", "gc_trade_contractor", "developer_trade_contractor"].includes(edge.relationship_type);
}

function companyNodeId(profile) {
  return nodeId(profile.company_type, profile.company_name);
}

function nodeId(type, name) {
  return `${type.toLowerCase().replace(/\s+/g, "-")}:${slug(name)}`;
}

function nodeName(graph, id) {
  return graph.nodes.find((node) => node.id === id)?.name ?? id;
}

function connectedNames(graph, nodeIdValue) {
  const names = new Set();
  for (const edge of graph.edges) {
    if (!isOrganizationRelationship(edge)) continue;
    if (edge.from_node_id === nodeIdValue) names.add(nodeName(graph, edge.to_node_id));
    if (edge.to_node_id === nodeIdValue) names.add(nodeName(graph, edge.from_node_id));
  }
  return [...names].sort();
}

function attentionReason(row) {
  const reasons = [];
  if (row.project_count) reasons.push(`${row.project_count} source-backed project(s)`);
  if (row.relationship_count) reasons.push(`${row.relationship_count} relationship link(s)`);
  if (row.metadata?.procurement_path_count) reasons.push(`${row.metadata.procurement_path_count} procurement path(s)`);
  return reasons.join("; ") || "Source-backed organization, but current network evidence is thin";
}

function averageConfidence(extractions) {
  const values = (extractions ?? []).map((item) => Number(item.confidence)).filter((value) => Number.isFinite(value));
  if (!values.length) return 0.5;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function cityFromLocation(location) {
  const value = String(location ?? "");
  if (/sacramento/i.test(value) || /natomas/i.test(value)) return "Sacramento";
  return value.split(",")[0]?.trim() || null;
}

function countyFromLocation(location) {
  const value = String(location ?? "");
  if (/sacramento/i.test(value)) return "Sacramento";
  return null;
}

function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) <= new Date(b) ? a : b;
}

function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : "Unknown";
}

function topLabels(items) {
  return items.slice(0, 5).map((item) => `${item.name} (${item.count})`).join(", ") || "Unknown";
}

function normalizeName(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|incorporated|company|co|limited|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (normalized.includes("lennar")) return "lennar homes of california";
  if (normalized.includes("kevin l cook architect")) return "kevin l cook architect";
  if (normalized.includes("lund construction")) return "lund construction";
  if (normalized.includes("taylor morrison")) return "taylor morrison of california";
  if (normalized.includes("integral communities")) return "integral communities";
  return normalized;
}

function slug(value) {
  return normalizeName(value).replace(/\s+/g, "-") || "unknown";
}

function table(rows, columns) {
  if (!rows.length) return "_None._";
  return [
    `| ${columns.map(([name]) => name).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, getter]) => escapeCell(getter(row))).join(" | ")} |`),
  ].join("\n");
}

function escapeCell(value) {
  return String(value ?? "Unknown").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}
