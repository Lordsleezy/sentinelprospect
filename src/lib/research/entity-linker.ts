import { normalizeEntityName, resolveEntityName } from "../graph/entity-resolution";
import type { ResearchAtom, ResearchEntity, ResearchEntityType } from "./types";

/**
 * Splink-inspired probabilistic linker for contractor research entities.
 * Pure TypeScript Fellegi-Sunter-ish scoring over name / place / parcel crumbs.
 */

export type LinkCandidate = {
  left: ResearchEntity;
  right: ResearchEntity;
  match_weight: number;
  reasons: string[];
};

const PRODUCTION_BUILDERS = /\b(lennar|kb home|taylor morrison|meritage|dr horton|d\.?r\.? horton|pulte|century communities|tri pointe|shea homes|richmond american|toll brothers|elliott homes|woodside homes|beazer)\b/i;
const SUBDIVISION_CUE = /\b(villages?\s+at|the\s+lakes?\s+at|unit\s+\d+|lot\s+\d+|subdivision|master\s*plan|tract\s+\d+|northlake|lakelet)\b/i;

export function extractResearchEntities(input: {
  title?: string | null;
  text?: string | null;
  developer?: string | null;
  general_contractor?: string | null;
  city?: string | null;
  county?: string | null;
  trade?: string | null;
  knownNames?: string[];
}): ResearchEntity[] {
  const entities: ResearchEntity[] = [];
  const blob = `${input.title ?? ""} ${input.text ?? ""}`;

  pushEntity(entities, "developer", input.developer, 0.9, input.knownNames);
  pushEntity(entities, "gc", input.general_contractor, 0.88, input.knownNames);
  pushEntity(entities, "city", input.city, 0.95);
  pushEntity(entities, "county", input.county, 0.95);
  pushEntity(entities, "trade", input.trade?.split(/[,/|]/)[0], 0.7);

  const builder = blob.match(PRODUCTION_BUILDERS)?.[0];
  if (builder) pushEntity(entities, "developer", builder, 0.86, input.knownNames);

  const subdivision = extractSubdivisionName(blob);
  if (subdivision) pushEntity(entities, "subdivision", subdivision, 0.8);

  const address = blob.match(/\b\d{1,6}\s+[A-Z][A-Za-z0-9 .'#-]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ln|Lane|Ct|Court)\b/);
  if (address) pushEntity(entities, "address", address[0], 0.75);

  const parcel = blob.match(/\b(?:APN|parcel)\s*[:#]?\s*([A-Z0-9-]{5,})\b/i);
  if (parcel) pushEntity(entities, "parcel", parcel[1], 0.85);

  return dedupeEntities(entities);
}

export function linkEntities(left: ResearchEntity[], right: ResearchEntity[]): LinkCandidate[] {
  const links: LinkCandidate[] = [];
  for (const a of left) {
    for (const b of right) {
      if (a.type !== b.type && !(a.type === "developer" && b.type === "company") && !(a.type === "company" && b.type === "developer")) {
        continue;
      }
      const weight = scoreEntityPair(a, b);
      if (weight < 0.55) continue;
      links.push({
        left: a,
        right: b,
        match_weight: weight,
        reasons: explainPair(a, b, weight),
      });
    }
  }
  return links.sort((x, y) => y.match_weight - x.match_weight);
}

export function clusterAtomsByLinkage(atoms: ResearchAtom[]): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p !== id) parent.set(id, find(p));
    return parent.get(id) ?? id;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const atom of atoms) parent.set(atom.id, atom.id);

  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = i + 1; j < atoms.length; j += 1) {
      // Place-only overlaps (city/county) are too common — require package-grade crumbs.
      const left = atoms[i].entities.filter((entity) => !["city", "county", "trade"].includes(entity.type));
      const right = atoms[j].entities.filter((entity) => !["city", "county", "trade"].includes(entity.type));
      if (!left.length || !right.length) continue;
      const links = linkEntities(left, right);
      const strong = links.filter((link) => link.match_weight >= 0.78);
      if (strong.length >= 1) union(atoms[i].id, atoms[j].id);
      else if (links.length >= 2 && links[0].match_weight >= 0.62) union(atoms[i].id, atoms[j].id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const atom of atoms) {
    const root = find(atom.id);
    const bucket = groups.get(root) ?? [];
    bucket.push(atom.id);
    groups.set(root, bucket);
  }
  return [...groups.values()].filter((group) => group.length >= 1);
}

function extractSubdivisionName(blob: string) {
  if (!SUBDIVISION_CUE.test(blob)) return null;
  const villages = blob.match(/\b(?:Villages?|Lakes?|Northlake|Lakelet)\s+(?:at\s+)?[A-Z][A-Za-z0-9 &'-]{2,40}/);
  if (villages) return villages[0].trim();
  const named = blob.match(/\b[A-Z][A-Za-z0-9 &'-]{2,40}\s+(?:Subdivision|Community|Homes|Village)\b/);
  return named?.[0]?.trim() ?? null;
}

function pushEntity(
  entities: ResearchEntity[],
  type: ResearchEntityType,
  value: string | null | undefined,
  confidence: number,
  knownNames: string[] = [],
) {
  if (!value || !String(value).trim() || /^(unknown|n\/a|none)$/i.test(value)) return;
  const resolved = resolveEntityName(value, knownNames);
  entities.push({
    type,
    value: value.trim(),
    canonical: resolved.canonicalName,
    confidence: Math.min(confidence, resolved.confidence),
  });
}

function dedupeEntities(entities: ResearchEntity[]) {
  const seen = new Set<string>();
  const out: ResearchEntity[] = [];
  for (const entity of entities) {
    const key = `${entity.type}:${normalizeEntityName(entity.canonical)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entity);
  }
  return out;
}

function scoreEntityPair(a: ResearchEntity, b: ResearchEntity) {
  const left = normalizeEntityName(a.canonical);
  const right = normalizeEntityName(b.canonical);
  if (!left || !right) return 0;
  if (left === right) return Math.min(0.99, 0.85 + a.confidence * 0.07 + b.confidence * 0.07);

  const tokensA = new Set(left.split(" "));
  const tokensB = new Set(right.split(" "));
  const overlap = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union ? overlap / union : 0;

  let weight = jaccard * 0.7;
  if (left.includes(right) || right.includes(left)) weight = Math.max(weight, 0.82);
  if (a.type === b.type) weight += 0.08;
  if (a.type === "parcel" && left === right) weight = 0.99;
  return Math.min(0.98, weight * ((a.confidence + b.confidence) / 2 + 0.15));
}

function explainPair(a: ResearchEntity, b: ResearchEntity, weight: number) {
  const reasons = [`${a.type}↔${b.type} weight ${weight.toFixed(2)}`];
  if (normalizeEntityName(a.canonical) === normalizeEntityName(b.canonical)) reasons.push("exact canonical match");
  return reasons;
}
