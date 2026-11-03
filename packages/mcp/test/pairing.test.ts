import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalCode, codesMatch, generatePairingCode, loadOrCreatePairingCode } from '../src/pairing';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'formhand-'));
  process.env.FORMHAND_HOME = home;
  delete process.env.FORMHAND_PAIRING_CODE;
});

afterEach(() => {
  delete process.env.FORMHAND_HOME;
  delete process.env.FORMHAND_PAIRING_CODE;
  rmSync(home, { recursive: true, force: true });
});

describe('pairing code', () => {
  it('looks like four groups of five unambiguous characters', () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}(-[A-HJKMNP-Z2-9]{5}){3}$/);
    expect(generatePairingCode()).not.toBe(code);
  });

  it('is created once and then reused', () => {
    const first = loadOrCreatePairingCode();
    expect(readFileSync(join(home, 'pairing-code'), 'utf8').trim()).toBe(first);
    expect(loadOrCreatePairingCode()).toBe(first);
  });

  it('can be set from the environment', () => {
    process.env.FORMHAND_PAIRING_CODE = 'TEST-CODE';
    expect(loadOrCreatePairingCode()).toBe('TEST-CODE');
  });

  it('compares codes ignoring case, spaces and dashes', () => {
    expect(canonicalCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(codesMatch('abcde fghjk', 'ABCDE-FGHJK')).toBe(true);
    expect(codesMatch('ABCDE-FGHJX', 'ABCDE-FGHJK')).toBe(false);
    expect(codesMatch('ABCDE', 'ABCDE-FGHJK')).toBe(false);
    expect(codesMatch('', '')).toBe(false);
  });
});
