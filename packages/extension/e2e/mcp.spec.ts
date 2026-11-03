import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PAIRING_CODE as CODE } from './data';
import { expect, test } from './fixtures';

// Built by `npm run build -w @formhand/mcp`.
const HELPER = join(import.meta.dirname, '..', '..', 'mcp', 'dist', 'formhand-mcp.js');

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { text: string }[]).map((c) => c.text).join('\n');
}

test('an AI app reads and fills the form over MCP', async ({ openForm, setSettings }) => {
  const port = await freePort();
  // The real helper, started the way an AI app starts it: as a child process speaking MCP on stdio.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [HELPER],
    env: { ...process.env, FORMHAND_PAIRING_CODE: CODE, FORMHAND_PORTS: String(port), FORMHAND_HOME: mkdtempSync(join(tmpdir(), 'formhand-e2e-')) } as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'e2e', title: 'Test AI app', version: '1.0.0' });
  await client.connect(transport);

  try {
    await setSettings({ provider: 'anthropic', providers: {}, bridge: { enabled: true, pairingCode: CODE.toLowerCase(), ports: [port] } });
    const { form, panel } = await openForm();
    await expect(panel.getByRole('button', { name: 'Test AI app connected' })).toBeVisible();
    await form.bringToFront();

    const read = text(await client.callTool({ name: 'get_form', arguments: {} }));
    expect(read).toContain('Page: Apply: Product designer at Northwind');
    expect(read).toContain('14 fields.');
    expect(read).toContain('{"id":"f1","type":"text","label":"First name","section":"About you","autocomplete":"given-name","required":true}');
    expect(read).not.toMatch(/password|Leave this empty/i);

    const fill = await client.callTool({
      name: 'fill_form',
      arguments: {
        fills: [
          { id: 'f1', value: 'Jane' },
          { id: 'f10', value: 'Sweden' },
          { id: 'f11', value: 'Product manager' },
          { id: 'f12', value: 'lots' },
        ],
      },
    });
    expect(text(fill)).toContain('Filled 3 of 4 fields (f1, f10, f11).');
    expect(text(fill)).toContain('Skipped: f12 (the page rejected "lots" for this number field).');
    expect(await form.inputValue('[name=first_name]')).toBe('Jane');
    expect(await form.inputValue('[name=country]')).toBe('se');
    expect(await form.isChecked('[value=pm]')).toBe(true);
    await expect(panel.getByText('Test AI app filled 3 fields.')).toBeVisible();

    expect(text(await client.callTool({ name: 'undo_fill', arguments: {} }))).toBe('Restored 3 fields.');
    expect(await form.inputValue('[name=first_name]')).toBe('');
    expect(await form.isChecked('[value=pm]')).toBe(false);
  } finally {
    await client.close();
  }
});

test('a wrong pairing code is refused and shown', async ({ openForm, setSettings }) => {
  const port = await freePort();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [HELPER],
    env: { ...process.env, FORMHAND_PAIRING_CODE: CODE, FORMHAND_PORTS: String(port), FORMHAND_HOME: mkdtempSync(join(tmpdir(), 'formhand-e2e-')) } as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(transport);
  try {
    await setSettings({ provider: 'anthropic', providers: {}, bridge: { enabled: true, pairingCode: 'WRONG-CODE', ports: [port] } });
    const { panel } = await openForm();
    await expect(panel.getByRole('button', { name: 'Pairing code refused' })).toBeVisible();
  } finally {
    await client.close();
  }
});
