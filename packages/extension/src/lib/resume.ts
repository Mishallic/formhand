import { tidyResumeText } from '@formhand/core';

/** What the file picker offers. */
export const RESUME_ACCEPT = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
].join(',');
export const RESUME_MAX_BYTES = 10 * 1024 * 1024;
/** Pages read from a PDF; a resume longer than this is mostly not about the forms. */
const PDF_PAGE_LIMIT = 20;

/** A file that can't be read, worded for the person who picked it. */
export class ResumeError extends Error {}

export interface ResumeFile {
  fileName: string;
  /** The resume's text, tidied. Empty for a scanned PDF. */
  text: string;
  /** For a PDF with no text layer (a scan), the file itself, base64, so Claude can read it. */
  scannedPdf?: string;
}

function extension(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Text of a PDF, line by line, using pdf.js (loaded only when a PDF is picked). */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, PDF_PAGE_LIMIT); n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = '';
        }
      }
      if (line) lines.push(line);
      pages.push(lines.join('\n'));
    }
    return pages.join('\n\n');
  } finally {
    // Ends the worker too.
    await task.destroy();
  }
}

/** The paragraph an element belongs to, so text boxes nested in a paragraph aren't read twice. */
function paragraphOf(node: Element): Element | null {
  let n: Element | null = node.parentElement;
  while (n && n.localName !== 'p') n = n.parentElement;
  return n;
}

/** Text of a Word file: word/document.xml inside the zip, one line per paragraph. */
export async function docxText(bytes: Uint8Array): Promise<string> {
  const { strFromU8, unzipSync } = await import('fflate');
  let xml: Uint8Array | undefined;
  try {
    xml = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })['word/document.xml'];
  } catch {
    xml = undefined;
  }
  if (!xml) throw new ResumeError("This isn't a Word file Formhand can open. Save it as .docx or PDF and try again.");
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml');
  const lines: string[] = [];
  for (const p of Array.from(doc.getElementsByTagName('w:p'))) {
    let line = '';
    for (const node of Array.from(p.getElementsByTagName('*'))) {
      if (paragraphOf(node) !== p) continue;
      if (node.localName === 't') line += node.textContent ?? '';
      else if (node.localName === 'tab') line += '\t';
      else if (node.localName === 'br' || node.localName === 'cr') line += '\n';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Reads a resume the person picked: PDF, Word (.docx), or plain text. Nothing leaves the browser. */
export async function readResume(file: File): Promise<ResumeFile> {
  if (file.size > RESUME_MAX_BYTES) throw new ResumeError(`${file.name} is larger than 10 MB. Pick a smaller copy, or paste the text.`);
  const ext = extension(file.name);
  if (ext === 'doc') throw new ResumeError('Formhand can’t read old .doc files. In Word, choose Save As and pick .docx or PDF.');
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (ext === 'pdf' || file.type === 'application/pdf') {
    let text: string;
    try {
      text = tidyResumeText(await pdfText(bytes));
    } catch (e) {
      throw new ResumeError(/password/i.test((e as Error).message) ? 'This PDF is password-protected. Save a copy without a password.' : `Formhand couldn’t read this PDF: ${(e as Error).message}`);
    }
    return text ? { fileName: file.name, text } : { fileName: file.name, text: '', scannedPdf: toBase64(bytes) };
  }
  if (ext === 'docx') return { fileName: file.name, text: tidyResumeText(await docxText(bytes)) };
  if (ext === 'txt' || ext === 'md' || file.type.startsWith('text/')) {
    return { fileName: file.name, text: tidyResumeText(new TextDecoder().decode(bytes)) };
  }
  throw new ResumeError('Pick a PDF, a Word file (.docx) or a text file.');
}
