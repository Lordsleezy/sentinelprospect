import type { SemanticSearchFilters, SemanticSearchHit } from "./types";

/**
 * ConstructIQ-style semantic opportunity search.
 *
 * Pattern borrowed from ConstructIQ / permit semantic search:
 * natural-language query + structured metadata filters + ranked hits.
 *
 * v1 uses a local hybrid lexical index (TF-IDF cosine) so Sentinel works
 * offline without Pinecone/OpenAI. Swap `embedQuery` / `embedDocument` later
 * for OpenAI text-embedding-3-small or Sentence-BERT while keeping the same API.
 */

export type IndexedDocument = {
  id: string;
  title: string;
  text: string;
  metadata: Record<string, string | number | boolean | null | undefined>;
};

type ScoredDoc = IndexedDocument & {
  vector: Map<string, number>;
  tokens: string[];
};

export class ConstructIQIndex {
  private docs: ScoredDoc[] = [];
  private idf = new Map<string, number>();

  constructor(documents: IndexedDocument[] = []) {
    this.rebuild(documents);
  }

  rebuild(documents: IndexedDocument[]) {
    const tokenized = documents.map((doc) => ({
      ...doc,
      tokens: tokenize(`${doc.title} ${doc.text}`),
      vector: new Map<string, number>(),
    }));

    const df = new Map<string, number>();
    for (const doc of tokenized) {
      for (const token of new Set(doc.tokens)) {
        df.set(token, (df.get(token) ?? 0) + 1);
      }
    }

    const n = Math.max(tokenized.length, 1);
    this.idf = new Map([...df.entries()].map(([token, count]) => [token, Math.log((n + 1) / (count + 1)) + 1]));

    this.docs = tokenized.map((doc) => {
      const tf = new Map<string, number>();
      for (const token of doc.tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
      const vector = new Map<string, number>();
      const length = Math.max(doc.tokens.length, 1);
      for (const [token, count] of tf) {
        vector.set(token, (count / length) * (this.idf.get(token) ?? 0));
      }
      return { ...doc, vector };
    });
  }

  search(query: string, filters: SemanticSearchFilters = {}, topK = 20): SemanticSearchHit[] {
    const qTokens = tokenize(query);
    const qVector = this.queryVector(qTokens);
    const hits: SemanticSearchHit[] = [];

    for (const doc of this.docs) {
      if (!matchesFilters(doc.metadata, filters)) continue;
      const lexical = cosine(qVector, doc.vector);
      const metadataBoost = metadataScore(query, doc, filters);
      const phraseBoost = phraseOverlap(`${doc.title} ${doc.text}`, qTokens);
      const score = lexical * 0.62 + metadataBoost * 0.28 + phraseBoost * 0.1;
      if (score < 0.04 && lexical < 0.02) continue;
      hits.push({
        id: doc.id,
        score: round(score),
        lexical_score: round(lexical),
        metadata_score: round(metadataBoost),
        title: doc.title,
        snippet: snippetFor(doc.text, qTokens),
        trade: stringMeta(doc.metadata.trade),
        city: stringMeta(doc.metadata.city),
        county: stringMeta(doc.metadata.county),
        stage: stringMeta(doc.metadata.stage),
        package_size: stringMeta(doc.metadata.package_size),
        metadata: Object.fromEntries(
          Object.entries(doc.metadata).map(([key, value]) => [key, value ?? null]),
        ) as Record<string, string | number | boolean | null>,
      });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private queryVector(tokens: string[]) {
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    const vector = new Map<string, number>();
    const length = Math.max(tokens.length, 1);
    for (const [token, count] of tf) {
      vector.set(token, (count / length) * (this.idf.get(token) ?? 0.5));
    }
    return vector;
  }
}

function matchesFilters(metadata: IndexedDocument["metadata"], filters: SemanticSearchFilters) {
  if (filters.trade && !includesLoose(String(metadata.trade ?? ""), filters.trade)) return false;
  if (filters.city && !includesLoose(String(metadata.city ?? ""), filters.city)) return false;
  if (filters.county && !includesLoose(String(metadata.county ?? ""), filters.county)) return false;
  if (filters.stage && !includesLoose(String(metadata.stage ?? ""), filters.stage)) return false;
  if (filters.package_size && String(metadata.package_size ?? "") !== filters.package_size) return false;
  if (filters.min_valuation != null) {
    const valuation = Number(metadata.valuation ?? 0);
    if (!(valuation >= filters.min_valuation)) return false;
  }
  if (filters.has_phone === true && metadata.has_phone !== true) return false;
  if (filters.has_phone === false && metadata.has_phone === true) return false;
  return true;
}

function metadataScore(query: string, doc: ScoredDoc, filters: SemanticSearchFilters) {
  let score = 0;
  const q = query.toLowerCase();
  if (filters.trade && includesLoose(String(doc.metadata.trade ?? ""), filters.trade)) score += 0.35;
  if (includesLoose(String(doc.metadata.city ?? ""), q)) score += 0.2;
  if (includesLoose(String(doc.metadata.county ?? ""), q)) score += 0.15;
  if (includesLoose(String(doc.metadata.trade ?? ""), q)) score += 0.25;
  if (includesLoose(String(doc.metadata.package_size ?? ""), q)) score += 0.1;
  if (includesLoose(String(doc.metadata.stage ?? ""), q)) score += 0.1;
  return Math.min(1, score);
}

function phraseOverlap(text: string, tokens: string[]) {
  if (!tokens.length) return 0;
  const lower = text.toLowerCase();
  const hits = tokens.filter((token) => token.length > 2 && lower.includes(token)).length;
  return hits / tokens.length;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP.has(token));
}

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [token, weight] of a) {
    magA += weight * weight;
    const other = b.get(token);
    if (other) dot += weight * other;
  }
  for (const weight of b.values()) magB += weight * weight;
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function snippetFor(text: string, tokens: string[]) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const lower = clean.toLowerCase();
  const hit = tokens.find((token) => token.length > 2 && lower.includes(token));
  if (!hit) return clean.slice(0, 160);
  const idx = lower.indexOf(hit);
  const start = Math.max(0, idx - 50);
  const end = Math.min(clean.length, idx + 110);
  return clean.slice(start, end).trim();
}

function includesLoose(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function stringMeta(value: string | number | boolean | null | undefined) {
  if (value == null || value === "") return null;
  return String(value);
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "jobs", "job", "in", "of", "to", "a", "an", "or", "on", "at",
]);
