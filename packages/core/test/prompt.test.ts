import { describe, expect, it } from 'vitest';
import { buildChatPrompt, buildUserMessage, describeField, MAX_OPTIONS, SYSTEM_PROMPT } from '../src/prompt';
import { parsePasted } from '../src/parse';
import type { FormSnapshot } from '../src/types';

const snapshot: FormSnapshot = {
  url: 'https://jobs.example.com/apply',
  title: 'Apply: Designer',
  fields: [
    { id: 'f1', kind: 'text', label: 'Full name', required: true, autocomplete: 'name' },
    { id: 'f2', kind: 'select', label: 'Country', options: [{ value: 'no', label: 'Norway' }] },
    { id: 'f3', kind: 'textarea', label: 'Why us?', maxLength: 500, value: 'draft' },
  ],
};

describe('describeField', () => {
  it('keeps only what the model needs', () => {
    expect(describeField(snapshot.fields[0]!)).toEqual({ id: 'f1', type: 'text', label: 'Full name', autocomplete: 'name', required: true });
    expect(describeField(snapshot.fields[1]!)).toEqual({ id: 'f2', type: 'select', label: 'Country', options: ['Norway'] });
    expect(describeField(snapshot.fields[2]!)).toEqual({ id: 'f3', type: 'textarea', label: 'Why us?', maxLength: 500, value: 'draft' });
  });

  it('falls back to the placeholder or name for unlabelled fields', () => {
    expect(describeField({ id: 'f1', kind: 'text', label: '', name: 'city' }).label).toBe('city');
  });

  it('cuts very long option lists and says how many are missing', () => {
    const options = Array.from({ length: MAX_OPTIONS + 20 }, (_, i) => ({ value: String(i), label: `Option ${i}` }));
    const d = describeField({ id: 'f1', kind: 'select', label: 'Pick', options });
    expect((d.options as string[]).length).toBe(MAX_OPTIONS);
    expect(d.moreOptions).toBe(20);
  });
});

describe('prompts', () => {
  it('puts the page, the fields, the info and the instructions in the user message', () => {
    const msg = buildUserMessage({ snapshot, info: 'Jane Doe, Oslo', instructions: 'Keep it short' });
    expect(msg).toContain('Page: Apply: Designer (https://jobs.example.com/apply)');
    expect(msg).toContain('{"id":"f2","type":"select","label":"Country","options":["Norway"]}');
    expect(msg).toContain('<<<\nJane Doe, Oslo\n>>>');
    expect(msg).toContain('My instructions: Keep it short');
  });

  it('builds a chat prompt whose reply format the paste box understands', () => {
    const prompt = buildChatPrompt({ snapshot, info: 'Jane' });
    expect(prompt.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(prompt).not.toContain('My instructions');
    // The format example inside the prompt is itself a valid reply.
    const example = SYSTEM_PROMPT.match(/\{"fills".*\}/)![0];
    expect(parsePasted(example).kind).toBe('fills');
  });
});
