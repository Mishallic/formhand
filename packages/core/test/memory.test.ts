import { describe, expect, it } from 'vitest';
import { answersToRemember, forgetAnswer, memoryPairs, questionKey, rememberAnswers, sameMemory, type RememberedAnswer } from '../src/memory';
import { matchPairs } from '../src/match';
import type { FormField } from '../src/types';

const fields: FormField[] = [
  { id: 'f1', kind: 'email', label: 'Email' },
  { id: 'f2', kind: 'text', label: 'Notice period' },
  { id: 'f3', kind: 'checkbox', label: 'I agree to the privacy policy' },
  { id: 'f4', kind: 'checkbox', label: 'Willing to relocate' },
  { id: 'f5', kind: 'textarea', label: 'Cover letter' },
  { id: 'f6', kind: 'number', label: 'Years of experience' },
  { id: 'f7', kind: 'text', label: '', placeholder: 'How did you hear about us?' },
];
const ctx = { site: 'jobs.acme.test', at: '2026-11-03T12:00:00.000Z', info: 'Name: Jane Doe\nEmail: jane@acme.test\nPhone: +47 912 34 567' };

const answer = (question: string, value: string, at = ctx.at): RememberedAnswer => ({ question, value, kind: 'text', site: ctx.site, at });

describe('answersToRemember', () => {
  it('keeps answers the info did not already give', () => {
    const kept = answersToRemember(
      fields,
      [
        { id: 'f1', value: 'jane@acme.test' },
        { id: 'f2', value: '3 months' },
        { id: 'f4', value: 'true' },
        { id: 'f6', value: '7' },
        { id: 'f7', value: 'A friend' },
      ],
      ctx,
    );
    expect(kept.map((a) => [a.question, a.value])).toEqual([
      ['Notice period', '3 months'],
      ['Willing to relocate', 'true'],
      // "7" is not a word of the phone number, so it is new information.
      ['Years of experience', '7'],
      ['How did you hear about us?', 'A friend'],
    ]);
    expect(kept[0]).toMatchObject({ kind: 'text', site: 'jobs.acme.test', at: ctx.at });
  });

  it('never keeps consent boxes, long answers, empty values or unknown fields', () => {
    const kept = answersToRemember(
      fields,
      [
        { id: 'f3', value: 'true' },
        { id: 'f5', value: 'x'.repeat(501) },
        { id: 'f2', value: '  ' },
        { id: 'f99', value: 'ghost' },
      ],
      ctx,
    );
    expect(kept).toEqual([]);
  });
});

describe('rememberAnswers', () => {
  it('puts new answers first and replaces older answers to the same question', () => {
    const memory = [answer('Notice period', '1 month', '2026-01-01'), answer('Salary expectation', '600000')];
    const next = rememberAnswers(memory, [answer('notice  period:', '3 months')]);
    expect(next.map((a) => a.value)).toEqual(['3 months', '600000']);
  });

  it('keeps at most the limit, dropping the oldest', () => {
    const memory = [answer('A', '1'), answer('B', '2'), answer('C', '3')];
    expect(rememberAnswers(memory, [answer('D', '4')], 3).map((a) => a.question)).toEqual(['D', 'A', 'B']);
  });

  it('forgets one question', () => {
    expect(forgetAnswer([answer('Notice period', '1'), answer('City', 'Oslo')], 'notice period').map((a) => a.question)).toEqual(['City']);
    expect(questionKey('Notice period *')).toBe('notice period');
  });
});

describe('sameMemory', () => {
  it('ignores key order, which Chrome storage changes, but not values or order', () => {
    const a = answer('City', 'Bergen');
    const sorted = { at: a.at, kind: a.kind, question: a.question, site: a.site, value: a.value };
    expect(sameMemory([a], [sorted])).toBe(true);
    expect(sameMemory([a], [{ ...a, value: 'Oslo' }])).toBe(false);
    expect(sameMemory([a, answer('B', '1')], [answer('B', '1'), a])).toBe(false);
    expect(sameMemory([], [a])).toBe(false);
  });
});

describe('memoryPairs', () => {
  it('lets the matcher fill the same question on another form', () => {
    const proposals = matchPairs(memoryPairs([answer('Notice period', '3 months'), answer('How did you hear about us?', 'A friend')]), fields);
    expect(proposals).toContainEqual(expect.objectContaining({ fieldId: 'f2', value: '3 months' }));
    expect(proposals).toContainEqual(expect.objectContaining({ fieldId: 'f7', value: 'A friend' }));
  });
});
