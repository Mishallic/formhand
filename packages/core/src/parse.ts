import type { Fill, Pair } from './types';
import { looksLikeEmail, looksLikePhone, looksLikeUrl } from './text';

export type ParsedInput =
  | { kind: 'fills'; fills: Fill[]; notes?: string }
  | { kind: 'pairs'; pairs: Pair[] }
  | { kind: 'empty' };

/** Pulls the outermost {...} out of text that may wrap it in prose or a ```json fence. */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const FIELD_ID = /^f\d+$/;

/**
 * Reads an AI reply in Formhand's format, { "fills": [{ "id": "f1", "value": "..." }] },
 * or the looser { "f1": "...", "f2": "..." }. Returns undefined for anything else.
 */
export function parseFillsReply(text: string): { fills: Fill[]; notes?: string } | undefined {
  const obj = extractJsonObject(text);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const record = obj as Record<string, unknown>;
  const notes = typeof record.notes === 'string' && record.notes.trim() ? record.notes.trim() : undefined;

  if (Array.isArray(record.fills)) {
    const fills: Fill[] = [];
    for (const item of record.fills) {
      if (!item || typeof item !== 'object') continue;
      const { id, value } = item as Record<string, unknown>;
      if (typeof id !== 'string' || value === undefined || value === null) continue;
      fills.push({ id, value: String(value) });
    }
    return { fills, notes };
  }

  const keys = Object.keys(record).filter((k) => k !== 'notes');
  if (keys.length > 0 && keys.every((k) => FIELD_ID.test(k))) {
    return {
      fills: keys
        .filter((k) => record[k] !== null && record[k] !== undefined)
        .map((k) => ({ id: k, value: String(record[k]) })),
      notes,
    };
  }
  return undefined;
}

/** Flattens nested JSON into pairs: { address: { city: "Oslo" } } gives "address city" = "Oslo". */
function flatten(value: unknown, prefix: string, out: Pair[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) {
      out.push({ key: prefix, value: value.join(', ') });
    } else {
      value.forEach((v, i) => flatten(v, `${prefix} ${i + 1}`, out));
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix} ${k}` : k, out);
    }
    return;
  }
  const s = String(value).trim();
  if (s && prefix) out.push({ key: prefix, value: s });
}

// "Name: Jane", "Name = Jane", "Name - Jane", "Name\tJane". The key can't start a URL ("https://...").
const LINE_PAIR = /^\s*(?:[-*•]\s+)?([^:=\t]{1,60}?)\s*(?::(?!\/\/)|=|\t|\s[-–—]\s)\s*(.+?)\s*$/;

function splitRow(line: string, sep: string): string[] {
  if (sep === '\t') return line.split('\t').map((c) => c.trim());
  // Comma rows: respect simple "quoted, values".
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** A header row plus a value row, as copied from a spreadsheet or a CSV file. */
function parseTable(lines: string[]): Pair[] | undefined {
  if (lines.length !== 2) return undefined;
  for (const sep of ['\t', ',']) {
    const header = splitRow(lines[0]!, sep);
    const row = splitRow(lines[1]!, sep);
    if (header.length >= 3 && header.length === row.length && header.every((h) => /\p{L}/u.test(h))) {
      return header.map((key, i) => ({ key, value: row[i]! })).filter((p) => p.value);
    }
  }
  return undefined;
}

/** Gives a key to a line that is only a value, when the value says what it is. */
function inferKey(value: string): string | undefined {
  if (looksLikeEmail(value)) return 'email';
  if (/linkedin\.com\//i.test(value)) return 'linkedin';
  if (/github\.com\//i.test(value)) return 'github';
  if (looksLikeUrl(value)) return 'website';
  if (looksLikePhone(value)) return 'phone';
  return undefined;
}

/**
 * Reads whatever the user pasted: an AI reply with field ids, a JSON object,
 * "Key: value" lines, or a two-row table. Lines that are only an email, phone number
 * or link get a key from their shape; other unlabelled lines are dropped.
 */
export function parsePasted(text: string): ParsedInput {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'empty' };

  const reply = parseFillsReply(trimmed);
  if (reply) return { kind: 'fills', ...reply };

  if (trimmed.includes('{')) {
    const obj = extractJsonObject(trimmed);
    if (obj && typeof obj === 'object') {
      const pairs: Pair[] = [];
      flatten(obj, '', pairs);
      if (pairs.length) return { kind: 'pairs', pairs };
    }
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  const table = parseTable(lines);
  if (table) return { kind: 'pairs', pairs: table };

  const pairs: Pair[] = [];
  for (const line of lines) {
    const bare = line.trim();
    const inferred = inferKey(bare);
    if (inferred) {
      pairs.push({ key: inferred, value: bare });
      continue;
    }
    const m = line.match(LINE_PAIR);
    if (m && /\p{L}/u.test(m[1]!)) {
      pairs.push({ key: m[1]!.trim(), value: m[2]!.trim() });
    }
  }
  return pairs.length ? { kind: 'pairs', pairs } : { kind: 'empty' };
}
