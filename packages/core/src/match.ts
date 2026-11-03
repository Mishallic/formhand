import { conceptOf, conceptOfAutocomplete, type Concept } from './concepts';
import { normalize, parseBoolean, tokens, tokenSimilarity } from './text';
import type { Fill, FormField, Pair, Proposal } from './types';
import { fitsKind, normalizeDate, resolveOption } from './values';

export interface MatchOptions {
  /** Minimum score (0..1) for a pair to be proposed for a field. */
  threshold?: number;
  /** Decides day/month order for dates like 03/04/1990. */
  locale?: string;
}

interface FieldProfile {
  field: FormField;
  /** Concepts this field is about, with how strongly the evidence says so. */
  concepts: Map<Concept, number>;
  descriptors: string[];
  isConfirm: boolean;
}

/** Concepts that hold the same value under different names. */
const RELATED: [Concept, Concept][] = [['street-address', 'address-line1']];

const CONFIRM_RE = /\b(confirm|confirmation|repeat|re ?enter|retype|verify|again)\b/;

function addConcept(map: Map<Concept, number>, concept: Concept | undefined, weight: number): void {
  if (concept && weight > (map.get(concept) ?? 0)) map.set(concept, weight);
}

function profile(field: FormField): FieldProfile {
  const concepts = new Map<Concept, number>();
  addConcept(concepts, conceptOfAutocomplete(field.autocomplete), 0.95);
  addConcept(concepts, field.label ? conceptOf(field.label) : undefined, 0.92);
  addConcept(concepts, field.name ? conceptOf(field.name) : undefined, 0.88);
  addConcept(concepts, field.htmlId ? conceptOf(field.htmlId) : undefined, 0.86);
  addConcept(concepts, field.placeholder ? conceptOf(field.placeholder) : undefined, 0.84);
  // The input type is weaker evidence than any text: a type="url" box may be "LinkedIn".
  if (field.kind === 'email') addConcept(concepts, 'email', 0.7);
  if (field.kind === 'tel') addConcept(concepts, 'tel', 0.7);
  if (field.kind === 'url') addConcept(concepts, 'url', 0.6);
  for (const [a, b] of RELATED) {
    if (concepts.has(a)) addConcept(concepts, b, concepts.get(a)! - 0.07);
    if (concepts.has(b)) addConcept(concepts, a, concepts.get(b)! - 0.07);
  }

  const descriptors = [field.label, field.name, field.htmlId, field.placeholder]
    .filter((d): d is string => !!d)
    .map(normalize)
    .filter(Boolean);
  if (field.section && field.label) descriptors.push(normalize(`${field.section} ${field.label}`));

  const confirmText = normalize(`${field.label} ${field.name ?? ''} ${field.htmlId ?? ''}`);
  return { field, concepts, descriptors, isConfirm: CONFIRM_RE.test(confirmText) };
}

function textScore(key: string, descriptors: string[]): number {
  let best = 0;
  const keyTokens = tokens(key);
  for (const d of descriptors) {
    if (d === key) return 1;
    let sim = tokenSimilarity(key, d);
    const descTokens = new Set(d.split(' '));
    if (keyTokens.length && keyTokens.every((t) => descTokens.has(t))) sim = Math.max(sim, 0.75);
    best = Math.max(best, sim * 0.8);
  }
  return best;
}

function score(pair: Pair, p: FieldProfile): number {
  const key = normalize(pair.key);
  if (!key) return 0;
  const keyConcept = conceptOf(pair.key);
  let s = textScore(key, p.descriptors);
  if (keyConcept) {
    const conceptScore = p.concepts.get(keyConcept);
    if (conceptScore) s = Math.max(s, conceptScore);
    // "Name" should not land in "Company name" just because the words overlap.
    else if (p.concepts.size > 0) s *= 0.5;
  }
  if (!fitsKind(pair.value, p.field.kind, p.field.options)) s *= 0.3;
  if (pair.derived) s *= 0.97;
  return s;
}

/** Adds first/last name pairs from a full name, and a full name from first + last. */
function derivePairs(pairs: Pair[]): Pair[] {
  const byConcept = new Map<Concept, Pair>();
  for (const pair of pairs) {
    const c = conceptOf(pair.key);
    if (c && !byConcept.has(c)) byConcept.set(c, pair);
  }
  const derived: Pair[] = [];
  const full = byConcept.get('name');
  if (full && !byConcept.has('given-name') && !byConcept.has('family-name')) {
    const parts = full.value.trim().split(/\s+/);
    if (parts.length >= 2) {
      derived.push({ key: 'first name', value: parts.slice(0, -1).join(' '), derived: true, origin: full.key });
      derived.push({ key: 'last name', value: parts[parts.length - 1]!, derived: true, origin: full.key });
    }
  }
  const given = byConcept.get('given-name');
  const family = byConcept.get('family-name');
  if (given && family && !full) {
    derived.push({ key: 'full name', value: `${given.value} ${family.value}`.trim(), derived: true, origin: `${given.key} + ${family.key}` });
  }
  return [...pairs, ...derived];
}

/**
 * Puts a value in the shape its field expects: the chosen option's label for
 * selects and radios, YYYY-MM-DD for dates, "true"/"false" for checkboxes.
 * Returns undefined when the value can't go in the field.
 */
export function coerceValue(value: string, field: FormField, locale?: string): string | undefined {
  switch (field.kind) {
    case 'select':
    case 'radio': {
      if (!field.options) return value;
      return resolveOption(value, field.options)?.label;
    }
    case 'date':
      return normalizeDate(value, locale);
    case 'checkbox': {
      const b = parseBoolean(value);
      return b === undefined ? undefined : String(b);
    }
    default:
      return field.maxLength && field.maxLength > 0 ? value.slice(0, field.maxLength) : value;
  }
}

/**
 * Matches pasted pairs to form fields without AI. Every pair goes to at most one
 * field and every field gets at most one pair, best scores first, except that
 * "Confirm email"-style fields reuse the value of the field they confirm.
 */
export function matchPairs(pairs: Pair[], fields: FormField[], options: MatchOptions = {}): Proposal[] {
  const threshold = options.threshold ?? 0.55;
  const all = derivePairs(pairs);
  const profiles = fields.map(profile);

  const candidates: { pi: number; fi: number; s: number }[] = [];
  all.forEach((pair, pi) => {
    profiles.forEach((p, fi) => {
      const s = score(pair, p);
      if (s >= threshold) candidates.push({ pi, fi, s });
    });
  });
  // Best score first; on a tie, keep the order of the page and of the paste.
  candidates.sort((a, b) => b.s - a.s || a.fi - b.fi || a.pi - b.pi);

  const usedPairs = new Set<number>();
  const assigned = new Map<number, { pi: number; s: number }>();
  for (const c of candidates) {
    if (assigned.has(c.fi) || usedPairs.has(c.pi)) continue;
    // A field confirming another one is handled below, once the original is filled.
    if (profiles[c.fi]!.isConfirm) continue;
    assigned.set(c.fi, { pi: c.pi, s: c.s });
    usedPairs.add(c.pi);
  }
  for (const c of candidates) {
    if (assigned.has(c.fi) || !profiles[c.fi]!.isConfirm) continue;
    assigned.set(c.fi, { pi: c.pi, s: c.s });
  }

  const proposals: Proposal[] = [];
  profiles.forEach((p, fi) => {
    const hit = assigned.get(fi);
    if (!hit) return;
    const pair = all[hit.pi]!;
    const value = coerceValue(pair.value, p.field, options.locale);
    if (value === undefined) return;
    proposals.push({
      fieldId: p.field.id,
      value,
      source: pair.origin ?? pair.key,
      confidence: Math.min(1, Math.round(hit.s * 100) / 100),
    });
  });
  return proposals;
}

/** Turns fills from an AI reply into proposals, dropping unknown ids and values that don't fit. */
export function fillsToProposals(
  fills: Fill[],
  fields: FormField[],
  options: MatchOptions = {},
): { proposals: Proposal[]; rejected: { id: string; reason: string }[] } {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const proposals: Proposal[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const fill of fills) {
    const field = byId.get(fill.id);
    if (!field) {
      rejected.push({ id: fill.id, reason: 'no field with this id on the page' });
      continue;
    }
    if (seen.has(fill.id)) continue;
    seen.add(fill.id);
    if (fill.value.trim() === '' && field.kind !== 'checkbox') continue;
    const value = coerceValue(fill.value, field, options.locale);
    if (value === undefined) {
      rejected.push({ id: fill.id, reason: `"${fill.value}" doesn't fit this ${field.kind} field` });
      continue;
    }
    proposals.push({ fieldId: field.id, value, source: 'AI', confidence: 1 });
  }
  const order = new Map(fields.map((f, i) => [f.id, i]));
  proposals.sort((a, b) => order.get(a.fieldId)! - order.get(b.fieldId)!);
  return { proposals, rejected };
}
