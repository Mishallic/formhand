import { describe, expect, it } from 'vitest';
import { fitsKind, normalizeDate, resolveOption } from '../src/values';
import { normalize, parseBoolean } from '../src/text';

const options = [
  { value: '', label: 'Choose…' },
  { value: 'us', label: 'United States' },
  { value: 'gb', label: 'United Kingdom' },
  { value: 'ae', label: 'United Arab Emirates' },
  { value: 'no', label: 'Norway' },
  { value: 'nz', label: 'New Zealand' },
];

describe('resolveOption', () => {
  it.each([
    ['gb', 'United Kingdom'],
    ['Norway', 'Norway'],
    ['norway ', 'Norway'],
    ['UK', 'United Kingdom'],
    ['U.S.A.', 'United States'],
    ['UAE', 'United Arab Emirates'],
    ['New Z', 'New Zealand'],
  ])('%s picks %s', (value, label) => {
    expect(resolveOption(value, options)?.label).toBe(label);
  });

  it('does not guess between several prefix matches', () => {
    expect(resolveOption('United', options)).toBeUndefined();
  });

  it('maps yes/no onto Yes/No options', () => {
    const yn = [
      { value: '1', label: 'Yes' },
      { value: '0', label: 'No' },
    ];
    expect(resolveOption('true', yn)?.label).toBe('Yes');
    expect(resolveOption('n', yn)?.label).toBe('No');
  });

  it('finds a short option label from the long form', () => {
    expect(resolveOption('United States of America', [{ value: '1', label: 'USA' }])?.label).toBe('USA');
  });
});

describe('normalizeDate', () => {
  it.each([
    ['1990-01-31', '1990-01-31'],
    ['1990/1/5', '1990-01-05'],
    ['31/01/1990', '1990-01-31'],
    ['01/31/1990', '1990-01-31'],
    ['5 March 1990', '1990-03-05'],
    ['March 5th, 1990', '1990-03-05'],
    ['5-Mar-90', undefined],
  ])('%s is %s', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });

  it('uses the locale for ambiguous day/month', () => {
    expect(normalizeDate('03/04/1990', 'en-GB')).toBe('1990-04-03');
    expect(normalizeDate('03/04/1990', 'en-US')).toBe('1990-03-04');
  });

  it('rejects impossible dates', () => {
    expect(normalizeDate('1990-02-30')).toBeUndefined();
    expect(normalizeDate('2024-13-01')).toBeUndefined();
  });
});

describe('fitsKind', () => {
  it('checks the value against the field type', () => {
    expect(fitsKind('jane@x.io', 'email')).toBe(true);
    expect(fitsKind('Jane', 'email')).toBe(false);
    expect(fitsKind('+1 (555) 010', 'tel')).toBe(true);
    expect(fitsKind('call me', 'tel')).toBe(false);
    expect(fitsKind('jane.dev/blog', 'url')).toBe(true);
    expect(fitsKind('12,500', 'number')).toBe(true);
    expect(fitsKind('twelve', 'number')).toBe(false);
    expect(fitsKind('yes', 'checkbox')).toBe(true);
    expect(fitsKind('Mars', 'select', options)).toBe(false);
    expect(fitsKind('anything', 'textarea')).toBe(true);
  });
});

describe('text helpers', () => {
  it('normalizes the ways field names are written', () => {
    expect(normalize('firstName')).toBe('first name');
    expect(normalize('user[first_name]')).toBe('user first name');
    expect(normalize('E-mail address *')).toBe('e mail address');
    expect(normalize('Phone (optional)')).toBe('phone');
    expect(normalize('HTMLParser')).toBe('html parser');
  });

  it('reads booleans', () => {
    expect(parseBoolean('Yes')).toBe(true);
    expect(parseBoolean('off')).toBe(false);
    expect(parseBoolean('maybe')).toBeUndefined();
  });
});
