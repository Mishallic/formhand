import { describe, expect, it } from 'vitest';
import { parseFillsReply, parsePasted } from '../src/parse';

describe('parsePasted', () => {
  it('reads "Key: value" lines, with or without bullets', () => {
    const r = parsePasted('Name: Jane Doe\n- Email = jane@doe.com\n• Phone - +1 555 010 9999\nCity\tOslo');
    expect(r).toEqual({
      kind: 'pairs',
      pairs: [
        { key: 'Name', value: 'Jane Doe' },
        { key: 'Email', value: 'jane@doe.com' },
        { key: 'Phone', value: '+1 555 010 9999' },
        { key: 'City', value: 'Oslo' },
      ],
    });
  });

  it('keeps colons inside values, such as links and times', () => {
    const r = parsePasted('Website: https://jane.dev\nAvailable: 09:30');
    expect(r).toEqual({
      kind: 'pairs',
      pairs: [
        { key: 'Website', value: 'https://jane.dev' },
        { key: 'Available', value: '09:30' },
      ],
    });
  });

  it('gives unlabelled emails, phones and links a key from their shape', () => {
    const r = parsePasted('Jane Doe\njane@doe.com\n+44 20 7946 0958\nhttps://www.linkedin.com/in/janedoe\nhttps://jane.dev');
    expect(r).toEqual({
      kind: 'pairs',
      pairs: [
        { key: 'email', value: 'jane@doe.com' },
        { key: 'phone', value: '+44 20 7946 0958' },
        { key: 'linkedin', value: 'https://www.linkedin.com/in/janedoe' },
        { key: 'website', value: 'https://jane.dev' },
      ],
    });
  });

  it('does not take a date for a phone number', () => {
    expect(parsePasted('2024-01-31')).toEqual({ kind: 'empty' });
  });

  it('flattens nested JSON, joining lists', () => {
    const r = parsePasted('```json\n{"name":"Jane","address":{"city":"Oslo","zip":"0150"},"skills":["TS","Go"],"age":null}\n```');
    expect(r).toEqual({
      kind: 'pairs',
      pairs: [
        { key: 'name', value: 'Jane' },
        { key: 'address city', value: 'Oslo' },
        { key: 'address zip', value: '0150' },
        { key: 'skills', value: 'TS, Go' },
      ],
    });
  });

  it('reads a header row and a value row copied from a spreadsheet', () => {
    const r = parsePasted('First name\tLast name\tEmail\nJane\tDoe\tjane@doe.com');
    expect(r).toEqual({
      kind: 'pairs',
      pairs: [
        { key: 'First name', value: 'Jane' },
        { key: 'Last name', value: 'Doe' },
        { key: 'Email', value: 'jane@doe.com' },
      ],
    });
  });

  it('reads a two-row CSV with quoted commas', () => {
    const r = parsePasted('name,company,city\n"Doe, Jane",Acme,Oslo');
    expect(r.kind === 'pairs' && r.pairs[0]).toEqual({ key: 'name', value: 'Doe, Jane' });
  });

  it('recognises an AI reply by its field ids', () => {
    const r = parsePasted('Sure! Here you go:\n```json\n{"fills":[{"id":"f1","value":"Jane"},{"id":"f2","value":true}],"notes":"Check the phone."}\n```');
    expect(r).toEqual({
      kind: 'fills',
      fills: [
        { id: 'f1', value: 'Jane' },
        { id: 'f2', value: 'true' },
      ],
      notes: 'Check the phone.',
    });
  });

  it('is empty for blank or unlabelled prose', () => {
    expect(parsePasted('   ')).toEqual({ kind: 'empty' });
    expect(parsePasted('I am a designer who loves bikes')).toEqual({ kind: 'empty' });
  });
});

describe('parseFillsReply', () => {
  it('accepts the loose { "f1": "..." } shape', () => {
    expect(parseFillsReply('{"f1":"Jane","f3":"Oslo","notes":""}')).toEqual({
      fills: [
        { id: 'f1', value: 'Jane' },
        { id: 'f3', value: 'Oslo' },
      ],
      notes: undefined,
    });
  });

  it('skips malformed entries', () => {
    expect(parseFillsReply('{"fills":[{"id":"f1"},{"value":"x"},null,{"id":"f2","value":"ok"}]}')).toEqual({
      fills: [{ id: 'f2', value: 'ok' }],
      notes: undefined,
    });
  });

  it('rejects JSON that is not a reply', () => {
    expect(parseFillsReply('{"name":"Jane"}')).toBeUndefined();
    expect(parseFillsReply('not json {')).toBeUndefined();
  });
});
