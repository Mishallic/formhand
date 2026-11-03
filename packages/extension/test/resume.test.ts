import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { docxText, readResume, RESUME_MAX_BYTES, ResumeError } from '../src/lib/resume';

/** A minimal .docx: just the zip entry Formhand reads. */
function docx(bodyXml: string): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`;
  return zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) });
}

const p = (...runs: string[]) => `<w:p>${runs.map((r) => `<w:r>${r}</w:r>`).join('')}</w:p>`;
const t = (text: string) => `<w:t xml:space="preserve">${text}</w:t>`;

// jsdom's File has no arrayBuffer(); the panel's browsers do.
function file(name: string, data: Uint8Array | string, type = ''): File {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return { name, type, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer } as unknown as File;
}

describe('docxText', () => {
  it('reads one line per paragraph, with tabs and line breaks', async () => {
    const text = await docxText(docx(p(t('Jane '), t('Doe')) + p(t('Email:'), '<w:tab/>', t('jane@x.io')) + p(t('Oslo'), '<w:br/>', t('Norway'))));
    expect(text).toBe('Jane Doe\nEmail:\tjane@x.io\nOslo\nNorway');
  });

  it('reads a text box inside a paragraph once', async () => {
    const box = `<w:r><w:pict><w:txbxContent>${p(t('In the box'))}</w:txbxContent></w:pict></w:r>`;
    const text = await docxText(docx(`<w:p><w:r>${t('Before')}</w:r>${box}</w:p>`));
    expect(text.split('\n')).toEqual(['Before', 'In the box']);
  });

  it('refuses a file that is not a Word document', async () => {
    await expect(docxText(strToU8('not a zip'))).rejects.toThrow(ResumeError);
    await expect(docxText(zipSync({ 'other.xml': strToU8('<x/>') }))).rejects.toThrow("This isn't a Word file Formhand can open.");
  });
});

describe('readResume', () => {
  it('reads Word and text files, tidied', async () => {
    expect(await readResume(file('cv.docx', docx(p(t('Jane   Doe')) + p('') + p('') + p(t('Designer')))))).toEqual({ fileName: 'cv.docx', text: 'Jane Doe\n\nDesigner' });
    expect(await readResume(file('cv.txt', '  Jane Doe \r\n Designer '))).toEqual({ fileName: 'cv.txt', text: 'Jane Doe\nDesigner' });
    expect((await readResume(file('notes', 'Jane', 'text/markdown'))).text).toBe('Jane');
  });

  it('explains files it cannot read', async () => {
    await expect(readResume(file('cv.doc', 'x'))).rejects.toThrow('old .doc files');
    await expect(readResume(file('cv.png', 'x', 'image/png'))).rejects.toThrow('Pick a PDF, a Word file (.docx) or a text file.');
    const big = { ...file('cv.pdf', 'x'), name: 'cv.pdf', size: RESUME_MAX_BYTES + 1 } as File;
    await expect(readResume(big)).rejects.toThrow('cv.pdf is larger than 10 MB.');
  });
});
