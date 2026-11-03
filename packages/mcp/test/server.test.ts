import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { BridgeMethod, FormSnapshot } from '@formhand/core';
import { BridgeError } from '../src/bridge';
import { createMcpServer, type BridgeLike } from '../src/server';

const snapshot: FormSnapshot = {
  url: 'https://shop.test/checkout',
  title: 'Checkout',
  fields: [
    { id: 'f1', kind: 'email', label: 'Email', required: true },
    { id: 'f2', kind: 'select', label: 'Country', options: [{ value: 'no', label: 'Norway' }] },
  ],
};

class FakeBridge implements BridgeLike {
  calls: { method: BridgeMethod; params: unknown }[] = [];
  clientName?: string;
  constructor(private readonly answer: (method: BridgeMethod, params: unknown) => unknown) {}
  async request(method: BridgeMethod, params: unknown): Promise<never> {
    this.calls.push({ method, params });
    return this.answer(method, params) as never;
  }
  setClientName(name: string | undefined): void {
    this.clientName = name;
  }
}

async function connect(bridge: BridgeLike) {
  const server = createMcpServer(bridge, '9.9.9');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-app', title: 'Test App', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string; text: string }[]).map((c) => c.text).join('\n');
}

describe('MCP server', () => {
  it('lists the three tools and gives the AI app instructions', async () => {
    const client = await connect(new FakeBridge(() => null));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_form', 'fill_form', 'undo_fill']);
    expect(tools.find((t) => t.name === 'get_form')?.annotations?.readOnlyHint).toBe(true);
    expect(client.getInstructions()).toMatch(/never submits a form/);
  });

  it('tells the bridge which AI app connected', async () => {
    const bridge = new FakeBridge(() => null);
    await connect(bridge);
    await new Promise((r) => setTimeout(r, 10));
    expect(bridge.clientName).toBe('Test App');
  });

  it('get_form returns compact field lines', async () => {
    const client = await connect(new FakeBridge(() => snapshot));
    const result = await client.callTool({ name: 'get_form', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(
      'Page: Checkout (https://shop.test/checkout)\n2 fields. Fill them with fill_form using these ids.\n' +
        '{"id":"f1","type":"email","label":"Email","required":true}\n' +
        '{"id":"f2","type":"select","label":"Country","options":["Norway"]}',
    );
  });

  it('get_form explains an empty page', async () => {
    const client = await connect(new FakeBridge(() => ({ ...snapshot, fields: [] })));
    expect(textOf(await client.callTool({ name: 'get_form', arguments: {} }))).toMatch(/No fillable fields found.*iframe/);
  });

  it('fill_form passes the fills on and reports what was skipped', async () => {
    const bridge = new FakeBridge(() => ({ filled: ['f1'], skipped: [{ id: 'f2', reason: 'no option "Mars"' }] }));
    const client = await connect(bridge);
    const fills = [
      { id: 'f1', value: 'jane@x.io' },
      { id: 'f2', value: 'Mars' },
    ];
    const result = await client.callTool({ name: 'fill_form', arguments: { fills } });
    expect(bridge.calls).toEqual([{ method: 'fill_form', params: { fills } }]);
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('Filled 1 of 2 fields (f1).');
    expect(textOf(result)).toContain('Skipped: f2 (no option "Mars").');
    expect(textOf(result)).toContain('was not submitted');
  });

  it('fill_form rejects an empty list before reaching the browser', async () => {
    const bridge = new FakeBridge(() => null);
    const client = await connect(bridge);
    const result = await client.callTool({ name: 'fill_form', arguments: { fills: [] } });
    expect(result.isError).toBe(true);
    expect(bridge.calls).toEqual([]);
  });

  it('marks a fill that filled nothing as an error', async () => {
    const client = await connect(new FakeBridge(() => ({ filled: [], skipped: [{ id: 'f9', reason: 'no such field' }] })));
    const result = await client.callTool({ name: 'fill_form', arguments: { fills: [{ id: 'f9', value: 'x' }] } });
    expect(result.isError).toBe(true);
  });

  it('undo_fill reports how many fields came back', async () => {
    const client = await connect(new FakeBridge(() => ({ restored: 3 })));
    expect(textOf(await client.callTool({ name: 'undo_fill', arguments: {} }))).toBe('Restored 3 fields.');
  });

  it('shows bridge errors to the AI as tool errors', async () => {
    const client = await connect(
      new FakeBridge(() => {
        throw new BridgeError("The Formhand browser extension isn't connected.");
      }),
    );
    const result = await client.callTool({ name: 'get_form', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("The Formhand browser extension isn't connected.");
  });
});
