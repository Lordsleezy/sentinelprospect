import type { ContactIntelligence } from "./types";

const PLACEHOLDER_PATTERNS = [
  /example\.(com|gov|org)/i,
  /\b555[-\s]?\d{4}\b/i,
  /\b(to be determined|tbd|unknown|n\/a|none)\b/i,
  /select edit below/i,
  /enter name/i,
  /\b(owner builder|owner-builder)\b/i,
  /\b(contact|developer|project manager)\s+\d+\b/i,
  /\b\w+\s+(construction|development|builders|contractor|developer)\s+\d+\b/i,
];

export function isPlaceholderIntelligence(values: Array<string | null | undefined>) {
  const blob = values.filter(Boolean).join(" ").toLowerCase();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(blob));
}

export function isPlaceholderContact(contact: ContactIntelligence) {
  return isPlaceholderIntelligence([contact.company, contact.name, contact.phone, contact.email, contact.website, contact.source]);
}

export function isSourceBackedCompanyName(name: string | null | undefined) {
  if (!name?.trim()) return false;
  return !isPlaceholderIntelligence([name]);
}
