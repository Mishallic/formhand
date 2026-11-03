import { describe, expect, it } from 'vitest';
import { conceptOf, conceptOfAutocomplete } from '../src/concepts';
import { fillsToProposals, matchPairs } from '../src/match';
import { parsePasted } from '../src/parse';
import type { FormField, Pair } from '../src/types';

const COUNTRIES = ['Canada', 'Norway', 'United Kingdom', 'United States'].map((c) => ({ value: c.slice(0, 2).toUpperCase(), label: c }));

const signup: FormField[] = [
  { id: 'f1', kind: 'text', label: 'First name', name: 'fname', required: true },
  { id: 'f2', kind: 'text', label: 'Last name', name: 'lname', required: true },
  { id: 'f3', kind: 'email', label: 'Work email', name: 'email' },
  { id: 'f4', kind: 'email', label: 'Confirm email', name: 'email_confirm' },
  { id: 'f5', kind: 'tel', label: 'Mobile', name: 'phone' },
  { id: 'f6', kind: 'text', label: 'Company name', name: 'company' },
  { id: 'f7', kind: 'select', label: 'Country', name: 'country', options: COUNTRIES },
  { id: 'f8', kind: 'date', label: 'Date of birth', name: 'dob' },
  { id: 'f9', kind: 'checkbox', label: 'Subscribe to the newsletter', name: 'newsletter' },
  { id: 'f10', kind: 'text', label: 'Postcode', autocomplete: 'postal-code' },
];

function pairsOf(text: string): Pair[] {
  const r = parsePasted(text);
  if (r.kind !== 'pairs') throw new Error(`expected pairs, got ${r.kind}`);
  return r.pairs;
}

function byField(proposals: { fieldId: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(proposals.map((p) => [p.fieldId, p.value]));
}

describe('conceptOf', () => {
  it.each([
    ['First name', 'given-name'],
    ['firstName', 'given-name'],
    ['user[first_name]', 'given-name'],
    ['Surname', 'family-name'],
    ['Company email', 'email'],
    ['Email address', 'email'],
    ['Name of company', 'organization'],
    ['Company name', 'organization'],
    ['Phone number (mobile)', 'tel'],
    ['Street address line 1', 'address-line1'],
    ['Zip / Postal', 'postal-code'],
    ['Your name *', 'name'],
  ])('%s is %s', (text, concept) => {
    expect(conceptOf(text)).toBe(concept);
  });

  it('ignores loose words inside longer labels', () => {
    expect(conceptOf('Is this your first time here?')).toBeUndefined();
  });

  it('reads section-prefixed autocomplete tokens', () => {
    expect(conceptOfAutocomplete('shipping given-name')).toBe('given-name');
    expect(conceptOfAutocomplete('section-x billing country-name')).toBe('country');
    expect(conceptOfAutocomplete('off')).toBeUndefined();
  });
});

describe('matchPairs', () => {
  it('fills a signup form from labelled lines', () => {
    const proposals = matchPairs(
      pairsOf('First name: Jane\nLast name: Doe\nEmail: jane@acme.com\nPhone: +47 912 34 567\nCompany: Acme\nCountry: Norway\nDOB: 31/01/1990\nNewsletter: yes\nZip: 0150'),
      signup,
    );
    expect(byField(proposals)).toEqual({
      f1: 'Jane',
      f2: 'Doe',
      f3: 'jane@acme.com',
      f4: 'jane@acme.com',
      f5: '+47 912 34 567',
      f6: 'Acme',
      f7: 'Norway',
      f8: '1990-01-31',
      f9: 'true',
      f10: '0150',
    });
  });

  it('splits a full name over first and last name fields', () => {
    const proposals = matchPairs(pairsOf('Name: Mary Ann Smith'), signup);
    expect(byField(proposals)).toEqual({ f1: 'Mary Ann', f2: 'Smith' });
    expect(proposals[0]!.source).toBe('first name (from full name)');
  });

  it('joins first and last name for a single name field', () => {
    const fields: FormField[] = [{ id: 'f1', kind: 'text', label: 'Full name' }];
    expect(byField(matchPairs(pairsOf('first_name: Jane\nlast_name: Doe'), fields))).toEqual({ f1: 'Jane Doe' });
  });

  it('does not put a person name into "Company name"', () => {
    const fields: FormField[] = [
      { id: 'f1', kind: 'text', label: 'Company name' },
      { id: 'f2', kind: 'text', label: 'Your message' },
    ];
    expect(matchPairs(pairsOf('Name: Jane'), fields)).toEqual([]);
  });

  it('refuses values that cannot go in the field', () => {
    const fields: FormField[] = [{ id: 'f1', kind: 'email', label: 'Email' }];
    expect(matchPairs([{ key: 'Email', value: 'ask me later' }], fields)).toEqual([]);
  });

  it('maps country aliases onto the option label', () => {
    expect(byField(matchPairs([{ key: 'country', value: 'USA' }], signup))).toEqual({ f7: 'United States' });
  });

  it('uses the section to tell billing from shipping', () => {
    const fields: FormField[] = [
      { id: 'f1', kind: 'text', label: 'City', section: 'Shipping address' },
      { id: 'f2', kind: 'text', label: 'City', section: 'Billing address' },
    ];
    const proposals = matchPairs(pairsOf('Billing address city: Bergen\nShipping address city: Oslo'), fields);
    expect(byField(proposals)).toEqual({ f1: 'Oslo', f2: 'Bergen' });
  });

  it('matches on placeholder when there is no label', () => {
    const fields: FormField[] = [{ id: 'f1', kind: 'text', label: '', placeholder: 'Your city' }];
    expect(byField(matchPairs([{ key: 'city', value: 'Oslo' }], fields))).toEqual({ f1: 'Oslo' });
  });

  it('cuts text to maxLength', () => {
    const fields: FormField[] = [{ id: 'f1', kind: 'text', label: 'Postcode', maxLength: 4 }];
    expect(byField(matchPairs([{ key: 'zip', value: '0150-123' }], fields))).toEqual({ f1: '0150' });
  });
});

describe('fillsToProposals', () => {
  it('validates AI fills against the form', () => {
    const { proposals, rejected } = fillsToProposals(
      [
        { id: 'f7', value: 'United Kingdom' },
        { id: 'f1', value: 'Jane' },
        { id: 'f99', value: 'x' },
        { id: 'f3', value: '' },
        { id: 'f8', value: 'soon' },
        { id: 'f9', value: 'false' },
      ],
      signup,
    );
    expect(proposals.map((p) => [p.fieldId, p.value])).toEqual([
      ['f1', 'Jane'],
      ['f7', 'United Kingdom'],
      ['f9', 'false'],
    ]);
    expect(rejected).toEqual([
      { id: 'f99', reason: 'no field with this id on the page' },
      { id: 'f8', reason: '"soon" doesn\'t fit this date field' },
    ]);
  });
});
