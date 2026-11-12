import { normalize } from './text';
import type { Fill, FormField } from './types';

/** The parts of a made-up test account, for testing sign-up forms. */
export type SeedRole = 'username' | 'password' | 'firstName' | 'lastName';

export interface SeedEntry {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
}

export const SEED_ROLES: { role: SeedRole; label: string }[] = [
  { role: 'username', label: 'Username' },
  { role: 'password', label: 'Password' },
  { role: 'firstName', label: 'First name' },
  { role: 'lastName', label: 'Last name' },
];

export const SEED_PASSWORD_LENGTH = 15;

const FIRST_NAMES = [
  'Mara', 'Jonas', 'Aiko', 'Tomas', 'Leila', 'Rafael', 'Ines', 'Kofi', 'Nadia', 'Elias', 'Sofia', 'Mateo', 'Yara', 'Oskar', 'Priya', 'Lucas',
  'Hana', 'Felix', 'Amara', 'Diego', 'Freya', 'Omar', 'Clara', 'Arjun', 'Lena', 'Hugo', 'Zara', 'Emil', 'Noor', 'Theo', 'Mira', 'Kai',
  'Alba', 'Samir', 'Ida', 'Bruno', 'Esme', 'Tariq', 'Vera', 'Joel', 'Anika', 'Pablo', 'Selin', 'Ravi', 'Lotte', 'Ezra', 'Maya', 'Nils',
];
const LAST_NAMES = [
  'Lindqvist', 'Okafor', 'Tanaka', 'Moreau', 'Haddad', 'Silva', 'Novak', 'Mensah', 'Petrov', 'Berg', 'Rossi', 'Garcia', 'Khalil', 'Larsen',
  'Sharma', 'Dubois', 'Sato', 'Fischer', 'Adeyemi', 'Romero', 'Nilsen', 'Aziz', 'Weber', 'Iyer', 'Jansen', 'Laurent', 'Kaya', 'Svensson',
  'Mwangi', 'Costa', 'Holm', 'Rahman', 'Bianchi', 'Kowalski', 'Ortiz', 'Eriksen', 'Nakamura', 'Owusu', 'Varga', 'Murphy', 'Sorensen', 'Yilmaz',
];

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const ALPHANUMERIC = UPPER + LOWER + DIGITS;

/** A uniform random integer in [0, n), from the platform's cryptographic generator. */
export function cryptoRandomInt(n: number): number {
  // Rejection sampling keeps every value equally likely.
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return buf[0]! % n;
}

type RandomInt = (n: number) => number;

function pick<T>(list: readonly T[], random: RandomInt): T {
  return list[random(list.length)]!;
}

function sequence(alphabet: string, length: number, random: RandomInt): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[random(alphabet.length)];
  return out;
}

/** 15 letters and digits with at least one capital, one small letter and one digit, like "c5DPbb5wDrxXHQw". */
export function strongSequence(random: RandomInt = cryptoRandomInt, length = SEED_PASSWORD_LENGTH): string {
  for (;;) {
    const s = sequence(ALPHANUMERIC, length, random);
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s)) return s;
  }
}

export interface SeedOptions {
  random?: RandomInt;
  /** Usernames handed out before, so a new one never repeats them. */
  taken?: Iterable<string>;
}

/**
 * A new made-up person. The username is the name in small letters plus four random
 * letters or digits ("maralindqvist7k2f"), letters and digits only so most sites
 * accept it, and never one in `taken`.
 */
export function makeSeedEntry({ random = cryptoRandomInt, taken = [] }: SeedOptions = {}): SeedEntry {
  const used = new Set([...taken].map((u) => u.toLowerCase()));
  const firstName = pick(FIRST_NAMES, random);
  const lastName = pick(LAST_NAMES, random);
  let username: string;
  do username = `${firstName}${lastName}`.toLowerCase() + sequence(LOWER + DIGITS, 4, random);
  while (used.has(username));
  return { firstName, lastName, username, password: strongSequence(random) };
}

const TEXT_KINDS = new Set(['text', 'search', 'email']);
const FIRST = /\b(first|given|fore|christian) ?names?\b|\bfname\b|^first$/;
const LAST = /\b(last|family|sur) ?names?\b|\blname\b|\bsurname\b|^last$/;
const USER = /\buser ?(name|id)\b|\busername\b|\blogin\b|\bhandle\b|\bscreen ?name\b|\bnick ?name\b|\bnick\b|\baccount ?name\b/;

/** Which part of a seed entry a field takes, or undefined for any other field. */
export function seedRole(field: FormField): SeedRole | undefined {
  if (field.kind === 'password') return 'password';
  if (!TEXT_KINDS.has(field.kind)) return undefined;
  const ac = (field.autocomplete ?? '').toLowerCase();
  if (/\busername\b/.test(ac)) return 'username';
  if (/\bgiven-name\b/.test(ac)) return 'firstName';
  if (/\bfamily-name\b/.test(ac)) return 'lastName';
  for (const text of [field.label, field.name, field.htmlId, field.placeholder].map((t) => normalize(t ?? ''))) {
    if (!text) continue;
    if (LAST.test(text)) return 'lastName';
    if (FIRST.test(text)) return 'firstName';
    if (USER.test(text)) return 'username';
  }
  return undefined;
}

export interface SeedPlan {
  fills: Fill[];
  /** Each field found, in page order, with the part it gets. */
  detected: { fieldId: string; role: SeedRole }[];
}

/** Puts one entry into every field that asks for a part of it, so "Confirm password" gets the same password. */
export function seedFills(fields: FormField[], entry: SeedEntry): SeedPlan {
  const detected = fields.flatMap((f) => {
    const role = seedRole(f);
    return role ? [{ fieldId: f.id, role }] : [];
  });
  return { detected, fills: detected.map((d) => ({ id: d.fieldId, value: entry[d.role] })) };
}
