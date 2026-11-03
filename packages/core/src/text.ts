/**
 * Lower-cases, splits camelCase and snake_case, drops punctuation and required-markers,
 * so "firstName", "first_name", "First name *" and "user[first-name]" all become "first name".
 */
export function normalize(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\((required|optional)\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function tokens(input: string): string[] {
  const n = normalize(input);
  return n ? n.split(' ') : [];
}

/** Dice coefficient over word sets: 1 for the same words, 0 for none in common. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}

/** True when every word of `needle` appears, in order and adjacent, in `haystack`. */
export function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
export const PHONE_RE = /^\+?[\d\s().-]{7,}$/;

export function looksLikeEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function looksLikeUrl(v: string): boolean {
  return URL_RE.test(v.trim());
}

export function looksLikePhone(v: string): boolean {
  const t = v.trim();
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(t)) return false; // a date
  return PHONE_RE.test(t) && (t.match(/\d/g)?.length ?? 0) >= 7;
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'on', '1', 'checked', 'agree', 'i agree', 'accept']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'off', '0', 'unchecked', 'disagree']);

/** Reads "yes", "true", "on", "1" and the like; undefined when the value isn't a yes/no. */
export function parseBoolean(v: string): boolean | undefined {
  const n = normalize(v);
  if (TRUE_WORDS.has(n)) return true;
  if (FALSE_WORDS.has(n)) return false;
  return undefined;
}
