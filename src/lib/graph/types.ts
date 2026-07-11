export type GraphNodeType =
  | "Developer"
  | "Company"
  | "Contact"
  | "Project"
  | "Permit"
  | "Property"
  | "Parcel"
  | "City"
  | "County"
  | "Trade"
  | "Bid"
  | "Document"
  | "Agency"
  | "Signal"
  | "Breadcrumb"
  | "Hypothesis";

export type GraphRelationshipType =
  | "OWNS"
  | "LOCATED_IN"
  | "REFERENCES"
  | "REQUIRES"
  | "EMPLOYS"
  | "INVOLVED_IN"
  | "DESIGNED"
  | "WORKS_FOR"
  | "ASSOCIATED_WITH"
  | "DISCOVERED_FROM"
  | "SAME_AS"
  | "PART_OF"
  | "MENTIONS"
  | "SUPPORTS";

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  label: string;
  properties: Record<string, string | number | boolean | null>;
};

export type GraphRelationship = {
  id: string;
  from: string;
  to: string;
  type: GraphRelationshipType;
  properties: Record<string, string | number | boolean | null>;
};

export type IntelligenceGraph = {
  generated_at: string;
  nodes: GraphNode[];
  relationships: GraphRelationship[];
};

export type GraphInsight = {
  title: string;
  description: string;
  entity_id?: string;
  entity_label?: string;
  score?: number;
};

