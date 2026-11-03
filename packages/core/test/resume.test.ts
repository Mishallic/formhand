import { describe, expect, it } from 'vitest';
import { parsePasted } from '../src/parse';
import { buildResumeMessage, parseResumeReply, RESUME_TEXT_LIMIT, resumeProfileText, tidyResumeText } from '../src/resume';

describe('tidyResumeText', () => {
  it('trims lines, collapses spaces and blank lines, and caps the length', () => {
    expect(tidyResumeText('  Jane   Doe \r\n\r\n\r\n\r\nProduct designer\t \n')).toBe('Jane Doe\n\nProduct designer');
    expect(tidyResumeText('a'.repeat(RESUME_TEXT_LIMIT + 10))).toHaveLength(RESUME_TEXT_LIMIT);
  });
});

describe('buildResumeMessage', () => {
  it('fences the text as data, or points at the attached PDF when there is none', () => {
    expect(buildResumeMessage('Jane Doe')).toBe('Resume:\n<<<\nJane Doe\n>>>');
    expect(buildResumeMessage('  ')).toBe('The resume is the attached PDF.');
  });
});

describe('parseResumeReply', () => {
  it('reads the details and drops empty or malformed ones', () => {
    const reply = parseResumeReply(
      '```json\n{"name":"Jane Doe","details":[{"label":"Email","value":"jane@x.io"},{"label":"Skills","value":"Figma\\nResearch"},{"label":"","value":"x"},{"label":"City"},"junk"]}\n```',
    );
    expect(reply).toEqual({
      name: 'Jane Doe',
      details: [
        { label: 'Email', value: 'jane@x.io' },
        { label: 'Skills', value: 'Figma, Research' },
      ],
    });
  });

  it('returns undefined without a details list', () => {
    expect(parseResumeReply('Sorry, I cannot read that.')).toBeUndefined();
    expect(parseResumeReply('{"name":"Jane"}')).toBeUndefined();
  });
});

describe('resumeProfileText', () => {
  const reply = { name: 'Jane Doe', details: [{ label: 'First name', value: 'Jane' }, { label: 'Email', value: 'jane@x.io' }] };

  it('puts the details first, then the whole resume', () => {
    expect(resumeProfileText(reply, 'Jane Doe\nDesigner at Acme')).toBe('First name: Jane\nEmail: jane@x.io\n\nResume:\nJane Doe\nDesigner at Acme');
  });

  it('is just the resume without details, and just the details without text', () => {
    expect(resumeProfileText(undefined, 'Jane Doe')).toBe('Jane Doe');
    expect(resumeProfileText(reply, '')).toBe('First name: Jane\nEmail: jane@x.io');
  });

  it('reads back as pairs for Match fields', () => {
    const parsed = parsePasted(resumeProfileText(reply, 'Jane Doe\nDesigner at Acme'));
    expect(parsed.kind).toBe('pairs');
    if (parsed.kind !== 'pairs') return;
    expect(parsed.pairs).toContainEqual(expect.objectContaining({ key: 'First name', value: 'Jane' }));
    expect(parsed.pairs).toContainEqual(expect.objectContaining({ key: 'Email', value: 'jane@x.io' }));
  });
});
