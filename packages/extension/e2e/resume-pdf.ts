import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The test resume, one line each. The fake AI in server.ts knows Jane's details. */
export const RESUME_LINES = ['Jane Doe', 'Product designer at Acme, 2019 to now', 'jane@northwind.test', '+47 912 34 567', 'Storgata 1, 0155 Oslo, Norway'];

/** A one-page PDF with real text on it, built by hand so the tests need no PDF tool. */
export function resumePdf(lines: string[] = RESUME_LINES): Buffer {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${escape(l)}) Tj T*`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Writes the test resume to a temporary folder and returns its path, for file pickers. */
export function resumePdfFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'formhand-resume-')), 'resume.pdf');
  writeFileSync(path, resumePdf());
  return path;
}
