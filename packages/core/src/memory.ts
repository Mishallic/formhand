import { normalize, tokens, containsPhrase } from './text';
import type { Fill, FieldKind, FormField, Pair } from './types';

/** An answer the person approved on an earlier form, kept to reuse on later ones. */
export interface RememberedAnswer {
  /** The question as that form asked it: its label, else placeholder or name. */
  question: string;
  value: string;
  kind: FieldKind;
  /** Host name of the site it was given on. */
  site: string;
  /** ISO time it was last given. */
  at: string;
}

/** How many answers are kept; the oldest go first. */
export const MEMORY_LIMIT = 200;
/** Longer answers (cover-letter paragraphs) are about one job, so they aren't kept. */
export const MEMORY_VALUE_LIMIT = 500;

/** Consent belongs to one site; ticking it once must never tick it elsewhere. */
const CONSENT = /\b(agree|accept|terms|conditions|privacy|consent|polic(y|ies)|gdpr|newsletter|marketing|subscribe|news|updates|offers|promotions?)\b/i;

/** The key two answers share when they answer the same question. */
export function questionKey(question: string): string {
  return normalize(question);
}

export interface RememberContext {
  site: string;
  at: string;
  /** The info the fill came from. Answers already in it aren't worth remembering. */
  info: string;
}

/**
 * The answers worth keeping from a fill: what the person's info didn't already say,
 * such as a value they typed into the preview or an answer the AI worked out.
 */
export function answersToRemember(fields: FormField[], fills: Fill[], { site, at, info }: RememberContext): RememberedAnswer[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const infoWords = tokens(info).join(' ');
  const out: RememberedAnswer[] = [];
  for (const fill of fills) {
    const field = byId.get(fill.id);
    const value = fill.value.trim();
    if (!field || !value || value.length > MEMORY_VALUE_LIMIT) continue;
    const question = (field.label || field.placeholder || field.name || '').trim();
    if (!questionKey(question)) continue;
    if (field.kind === 'checkbox' && CONSENT.test(question)) continue;
    const words = tokens(value).join(' ');
    if (words && containsPhrase(infoWords, words)) continue;
    out.push({ question, value, kind: field.kind, site, at });
  }
  return out;
}

/** Adds new answers, newest first. A new answer replaces an older one to the same question. */
export function rememberAnswers(memory: RememberedAnswer[], answers: RememberedAnswer[], limit = MEMORY_LIMIT): RememberedAnswer[] {
  const fresh = new Map<string, RememberedAnswer>();
  for (const a of answers) fresh.set(questionKey(a.question), a);
  const kept = memory.filter((m) => !fresh.has(questionKey(m.question)));
  return [...fresh.values(), ...kept].slice(0, limit);
}

export function forgetAnswer(memory: RememberedAnswer[], question: string): RememberedAnswer[] {
  const key = questionKey(question);
  return memory.filter((m) => questionKey(m.question) !== key);
}

/**
 * True when two lists hold the same answers in the same order. Compares fields, not
 * JSON: Chrome's storage hands objects back with their keys sorted.
 */
export function sameMemory(a: RememberedAnswer[], b: RememberedAnswer[]): boolean {
  const key = (m: RememberedAnswer) => [m.question, m.value, m.kind, m.site, m.at].join('\u0000');
  return a.length === b.length && a.every((m, i) => key(m) === key(b[i]!));
}

/** Remembered answers as pairs for the matcher, the question as the key. */
export function memoryPairs(memory: RememberedAnswer[]): Pair[] {
  return memory.map((m) => ({ key: m.question, value: m.value }));
}
