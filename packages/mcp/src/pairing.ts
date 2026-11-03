import { randomInt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** No 0/O or 1/I/L, so the code survives being read aloud or retyped. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Where the helper keeps its pairing code. FORMHAND_HOME overrides it (tests, portable installs). */
export function configDir(): string {
  return process.env.FORMHAND_HOME ?? join(homedir(), '.formhand');
}

/** Four groups of five characters, about 99 bits: "K7Q2M-9XWPA-3HDRT-ZB6NE". */
export function generatePairingCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 5; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}

/** Upper-cases and drops spaces and dashes, so "k7q2m 9xwpa..." equals "K7Q2M-9XWPA-...". */
export function canonicalCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function codesMatch(given: string, expected: string): boolean {
  const a = Buffer.from(canonicalCode(given));
  const b = Buffer.from(canonicalCode(expected));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * The code the extension must present. FORMHAND_PAIRING_CODE wins; otherwise the code
 * saved in the config directory, created on first use and readable only by this user.
 */
export function loadOrCreatePairingCode(): string {
  const fromEnv = process.env.FORMHAND_PAIRING_CODE;
  if (fromEnv) return fromEnv;
  const dir = configDir();
  const file = join(dir, 'pairing-code');
  try {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved) return saved;
  } catch {
    // Not created yet.
  }
  const code = generatePairingCode();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, `${code}\n`, { mode: 0o600 });
  return code;
}
