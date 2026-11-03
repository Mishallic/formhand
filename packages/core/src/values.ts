import type { FieldKind, FieldOption } from './types';
import { normalize, parseBoolean } from './text';

/** Common ways of writing a country that don't match its option label word for word. */
const ALIASES: Record<string, string[]> = {
  'united states': ['us', 'usa', 'u s', 'u s a', 'united states of america', 'america'],
  'united kingdom': ['uk', 'u k', 'great britain', 'britain', 'england'],
  'united arab emirates': ['uae', 'u a e', 'emirates'],
  'saudi arabia': ['ksa', 'kingdom of saudi arabia'],
  'south korea': ['korea', 'republic of korea'],
  netherlands: ['holland', 'the netherlands'],
  'czech republic': ['czechia'],
  'turkey': ['turkiye', 'türkiye'],
};

const ALIAS_INDEX = new Map<string, string>();
for (const [canonical, alts] of Object.entries(ALIASES)) {
  for (const alt of alts) ALIAS_INDEX.set(alt, canonical);
}

/**
 * Picks the option a value means: exact value, then exact label, then normalized
 * label or value, then a known alias ("USA" for "United States"), then a unique
 * option that starts with the value. Returns undefined rather than guessing between
 * several candidates.
 */
export function resolveOption(value: string, options: FieldOption[]): FieldOption | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const exact = options.find((o) => o.value === raw) ?? options.find((o) => o.label.trim() === raw);
  if (exact) return exact;

  const n = normalize(raw);
  const byNorm = options.find((o) => normalize(o.label) === n) ?? options.find((o) => normalize(o.value) === n);
  if (byNorm) return byNorm;

  const canonical = ALIAS_INDEX.get(n);
  if (canonical) {
    const aliased = options.find((o) => normalize(o.label) === canonical || ALIAS_INDEX.get(normalize(o.label)) === canonical);
    if (aliased) return aliased;
  } else {
    // The option might be the short form ("USA") while the value is the long one.
    const aliased = options.find((o) => ALIAS_INDEX.get(normalize(o.label)) === n);
    if (aliased) return aliased;
  }

  const bool = parseBoolean(raw);
  if (bool !== undefined) {
    const yesNo = options.find((o) => parseBoolean(o.label) === bool || parseBoolean(o.value) === bool);
    if (yesNo) return yesNo;
  }

  if (n.length >= 2) {
    const prefixed = options.filter((o) => normalize(o.label).startsWith(n));
    if (prefixed.length === 1) return prefixed[0];
  }
  return undefined;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function fullYear(y: number): number {
  return y < 100 ? (y > 50 ? 1900 + y : 2000 + y) : y;
}

/**
 * Turns the ways people write dates into YYYY-MM-DD, which is what a date input
 * accepts. For "03/04/1990" it uses the day/month order of `locale` (month first only
 * for en-US), unless one of the numbers can only be a day.
 */
export function normalizeDate(value: string, locale = 'en-GB'): string | undefined {
  const v = value.trim();
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);

  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = fullYear(+m[3]!);
    const monthFirst = a > 12 ? false : b > 12 ? true : locale.toLowerCase() === 'en-us';
    return monthFirst ? iso(y, a, b) : iso(y, b, a);
  }

  // "5 March 1990", "March 5, 1990", "5th Mar 1990"
  const words = v.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').split(/\s+/);
  const monthIdx = words.findIndex((w) => MONTHS.includes(w.slice(0, 3)) && /^[a-z]+$/.test(w));
  if (monthIdx >= 0 && words.length === 3) {
    const nums = words.filter((_, i) => i !== monthIdx).map(Number);
    if (nums.every((n) => Number.isInteger(n))) {
      const [x, y] = nums as [number, number];
      const year = x > 31 ? x : y;
      const day = x > 31 ? y : x;
      return iso(fullYear(year), MONTHS.indexOf(words[monthIdx]!.slice(0, 3)) + 1, day);
    }
  }
  return undefined;
}

/**
 * Whether `value` can go in a field of `kind` at all. Used to stop a confident-looking
 * label match from putting "Jane" into an email box.
 */
export function fitsKind(value: string, kind: FieldKind, options?: FieldOption[]): boolean {
  const v = value.trim();
  switch (kind) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    case 'tel':
      return (v.match(/\d/g)?.length ?? 0) >= 5;
    case 'url':
      return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+\S*$/i.test(v);
    case 'number':
      return /^-?\d+([.,]\d+)?$/.test(v.replace(/[\s,](?=\d{3}\b)/g, ''));
    case 'date':
      return normalizeDate(v) !== undefined;
    case 'checkbox':
      return parseBoolean(v) !== undefined;
    case 'select':
    case 'radio':
      return options ? resolveOption(v, options) !== undefined : true;
    default:
      return true;
  }
}
