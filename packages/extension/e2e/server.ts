import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { build } from 'esbuild';

/** What the fake AI "knows" about the applicant, by field label. */
export const AI_ANSWERS: Record<string, string> = {
  'First name': 'Jane',
  'Last name': 'Doe',
  Email: 'jane@northwind.test',
  'Confirm email': 'jane@northwind.test',
  Country: 'Norway',
  'Position applied for': 'Product designer',
  'Why Northwind?': 'I design calm tools for busy people, and Northwind builds exactly those.',
};

export interface TestServer {
  url: string;
  /** Bodies of the chat completion requests the fake AI received. */
  aiRequests: { model: string; response_format?: unknown; messages: { role: string; content: string }[] }[];
  close(): Promise<void>;
}

async function body(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data;
}

/**
 * Serves the test pages and a fake OpenAI-compatible API that answers from AI_ANSWERS,
 * using the field ids and labels it finds in Formhand's prompt.
 */
export async function startServer(): Promise<TestServer> {
  const aiRequests: TestServer['aiRequests'] = [];
  // React ships no browser build, so the React test page is bundled here.
  const reactBundle = (
    await build({
      entryPoints: [join(import.meta.dirname, 'pages', 'react-form.tsx')],
      bundle: true,
      write: false,
      format: 'iife',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    })
  ).outputFiles[0]!.text;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
      return;
    }
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      const request = JSON.parse(await body(req)) as TestServer['aiRequests'][number];
      aiRequests.push(request);
      const prompt = request.messages.find((m) => m.role === 'user')?.content ?? '';
      const fills = [...prompt.matchAll(/^\{"id":"(f\d+)".*?"label":"([^"]*)"/gm)]
        .filter(([, , label]) => label! in AI_ANSWERS)
        .map(([, id, label]) => ({ id, value: AI_ANSWERS[label!] }));
      const content = JSON.stringify({ fills, notes: 'Add your phone number yourself.' });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
      return;
    }
    if (url.pathname === '/react.html') {
      const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Join Northwind</title></head><body><div id="app"></div><script>${reactBundle}</script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
      return;
    }
    const file = url.pathname === '/' ? 'apply.html' : url.pathname.slice(1);
    try {
      const html = readFileSync(join(import.meta.dirname, 'pages', file));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    aiRequests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
