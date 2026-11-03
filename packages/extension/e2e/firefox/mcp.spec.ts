import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PAIRING_CODE as CODE } from '../data';
import { expect, test } from './fixtures';

// Built by `npm run build -w @formhand/mcp`.
const HELPER = join(import.meta.dirname, '..', '..', '..', 'mcp', 'dist', 'formhand-mcp.js');

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

/** The real helper, started the way an AI app starts it: a child process speaking MCP on stdio. */
async function startHelper(port: number, name = 'Test AI app'): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [HELPER],
    env: { ...process.env, FORMHAND_PAIRING_CODE: CODE, FORMHAND_PORTS: String(port), FORMHAND_HOME: mkdtempSync(join(tmpdir(), 'formhand-e2e-')) } as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'e2e', title: name, version: '1.0.0' });
  await client.connect(transport);
  return client;
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { text: string }[]).map((c) => c.text).join('\n');
}

test('an AI app reads and fills the form over MCP', async ({ openForm, setSettings }) => {
  const port = await freePort();
  const client = await startHelper(port);
  try {
    await setSettings({ provider: 'anthropic', providers: {}, bridge: { enabled: true, pairingCode: CODE.toLowerCase(), ports: [port] } });
    const { form, panel } = await openForm();
    await panel.button('Test AI app connected');
    // The helper works on the tab the person is looking at.
    await form.focus();

    const read = text(await client.callTool({ name: 'get_form', arguments: {} }));
    expect(read).toContain('Page: Apply: Product designer at Northwind');
    expect(read).toContain('14 fields.');
    expect(read).not.toMatch(/password|Leave this empty/i);

    const fill = await client.callTool({
      name: 'fill_form',
      arguments: { fills: [{ id: 'f1', value: 'Jane' }, { id: 'f10', value: 'Sweden' }, { id: 'f11', value: 'Product manager' }] },
    });
    expect(text(fill)).toContain('Filled 3 of 3 fields');
    expect(await form.value('[name=first_name]')).toBe('Jane');
    expect(await form.value('[name=country]')).toBe('se');
    expect(await form.checked('[value=pm]')).toBe(true);
    await panel.waitForText('Test AI app filled 3 fields.');

    // Reading the panel made its tab the active one; a real sidebar is never a tab.
    await form.focus();
    expect(text(await client.callTool({ name: 'undo_fill', arguments: {} }))).toBe('Restored 3 fields.');
    expect(await form.value('[name=first_name]')).toBe('');
  } finally {
    await client.close();
  }
});

test('a wrong pairing code is refused and shown', async ({ openForm, setSettings }) => {
  const port = await freePort();
  const client = await startHelper(port);
  try {
    await setSettings({ provider: 'anthropic', providers: {}, bridge: { enabled: true, pairingCode: 'WRONG-CODE', ports: [port] } });
    const { panel } = await openForm();
    await panel.button('Pairing code refused');
  } finally {
    await client.close();
  }
});
