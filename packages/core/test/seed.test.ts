import { describe, expect, it } from 'vitest';
import { cryptoRandomInt, makeSeedEntry, SEED_PASSWORD_LENGTH, seedFills, seedRole, strongSequence } from '../src/seed';
import type { FormField } from '../src/types';

const field = (over: Partial<FormField>): FormField => ({ id: 'f1', kind: 'text', label: '', ...over });

describe('strongSequence', () => {
  it('is 15 letters and digits with a capital, a small letter and a digit', () => {
    for (let i = 0; i < 200; i++) {
      const s = strongSequence();
      expect(s).toMatch(/^[A-Za-z0-9]+$/);
      expect(s).toHaveLength(SEED_PASSWORD_LENGTH);
      expect(s).toMatch(/[A-Z]/);
      expect(s).toMatch(/[a-z]/);
      expect(s).toMatch(/\d/);
    }
  });

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 500 }, () => strongSequence())).size).toBe(500);
  });
});

describe('cryptoRandomInt', () => {
  it('stays in range', () => {
    for (let i = 0; i < 500; i++) {
      const n = cryptoRandomInt(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });
});

describe('makeSeedEntry', () => {
  it('makes a name, a username built from it, and a strong password', () => {
    const e = makeSeedEntry();
    expect(e.firstName).toMatch(/^[A-Z][a-z]+$/);
    expect(e.lastName).toMatch(/^[A-Z][a-z]+$/);
    expect(e.username).toMatch(/^[a-z0-9]+$/);
    expect(e.username.startsWith(`${e.firstName}${e.lastName}`.toLowerCase())).toBe(true);
    expect(e.username).toHaveLength(e.firstName.length + e.lastName.length + 4);
    expect(e.password).toHaveLength(SEED_PASSWORD_LENGTH);
  });

  it('never hands out a username that was taken before', () => {
    // Scripted rolls first (names, then username endings), real randomness for the rest.
    const scripted = (rolls: number[]) => {
      let i = 0;
      return (n: number) => (i < rolls.length ? rolls[i++]! % n : cryptoRandomInt(n));
    };
    const first = makeSeedEntry({ random: scripted([0, 0, 1, 1, 1, 1]) });
    expect(first.username).toBe('maralindqvistbbbb');
    // The same rolls again would repeat it, so the ending is drawn again.
    const second = makeSeedEntry({ random: scripted([0, 0, 1, 1, 1, 1, 2, 2, 2, 2]), taken: [first.username.toUpperCase()] });
    expect(second.username).toBe('maralindqvistcccc');
  });

  it('gives different entries each time', () => {
    const entries = Array.from({ length: 200 }, () => makeSeedEntry());
    expect(new Set(entries.map((e) => e.username)).size).toBe(200);
    expect(new Set(entries.map((e) => e.password)).size).toBe(200);
  });
});

describe('seedRole', () => {
  it('finds each part by label, name, id, placeholder or autocomplete', () => {
    expect(seedRole(field({ label: 'Username' }))).toBe('username');
    expect(seedRole(field({ name: 'user_name' }))).toBe('username');
    expect(seedRole(field({ htmlId: 'loginId', label: 'Login' }))).toBe('username');
    expect(seedRole(field({ label: 'Pick a handle' }))).toBe('username');
    expect(seedRole(field({ label: 'Account', autocomplete: 'username' }))).toBe('username');
    expect(seedRole(field({ label: 'First name *' }))).toBe('firstName');
    expect(seedRole(field({ name: 'firstName' }))).toBe('firstName');
    expect(seedRole(field({ placeholder: 'Given name' }))).toBe('firstName');
    expect(seedRole(field({ label: 'Name', autocomplete: 'given-name' }))).toBe('firstName');
    expect(seedRole(field({ label: 'Surname' }))).toBe('lastName');
    expect(seedRole(field({ name: 'lname' }))).toBe('lastName');
    expect(seedRole(field({ label: 'Family name' }))).toBe('lastName');
    expect(seedRole(field({ kind: 'password', label: 'Password' }))).toBe('password');
    expect(seedRole(field({ kind: 'password', label: 'Repeat it' }))).toBe('password');
  });

  it('leaves other fields alone', () => {
    expect(seedRole(field({ label: 'Email', kind: 'email' }))).toBeUndefined();
    expect(seedRole(field({ label: 'Company name' }))).toBeUndefined();
    expect(seedRole(field({ label: 'Full name' }))).toBeUndefined();
    expect(seedRole(field({ label: 'Phone', kind: 'tel' }))).toBeUndefined();
    expect(seedRole(field({ label: 'Username', kind: 'checkbox' }))).toBeUndefined();
    expect(seedRole(field({ label: 'Last name', kind: 'select', options: [] }))).toBeUndefined();
  });
});

describe('seedFills', () => {
  it('gives every matching field the same entry, in page order', () => {
    const fields = [
      field({ id: 'f1', label: 'Email', kind: 'email' }),
      field({ id: 'f2', label: 'Username' }),
      field({ id: 'f3', label: 'Password', kind: 'password' }),
      field({ id: 'f4', label: 'Confirm password', kind: 'password' }),
      field({ id: 'f5', label: 'First name' }),
    ];
    const entry = { firstName: 'Mara', lastName: 'Berg', username: 'maraberg7k2f', password: 'c5DPbb5wDrxXHQw' };
    expect(seedFills(fields, entry)).toEqual({
      detected: [
        { fieldId: 'f2', role: 'username' },
        { fieldId: 'f3', role: 'password' },
        { fieldId: 'f4', role: 'password' },
        { fieldId: 'f5', role: 'firstName' },
      ],
      fills: [
        { id: 'f2', value: 'maraberg7k2f' },
        { id: 'f3', value: 'c5DPbb5wDrxXHQw' },
        { id: 'f4', value: 'c5DPbb5wDrxXHQw' },
        { id: 'f5', value: 'Mara' },
      ],
    });
  });
});
