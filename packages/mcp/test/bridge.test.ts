import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { CLOSE_BAD_TOKEN, type HelperToExtension } from '@formhand/core';
import { Bridge, BridgeError, NOT_CONNECTED } from '../src/bridge';

const CODE = 'ABCDE-FGHJK-MNPQR-STUVW';
const bridges: Bridge[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await Promise.all(bridges.splice(0).map((b) => b.close()));
});

async function startBridge(overrides: Partial<ConstructorParameters<typeof Bridge>[0]> = {}): Promise<Bridge> {
  const bridge = new Bridge({ pairingCode: CODE, version: '1.2.3', ports: [0], connectWaitMs: 200, requestTimeoutMs: 500, ...overrides });
  bridges.push(bridge);
  await bridge.listen();
  return bridge;
}

/** A stand-in for the extension's background script. */
class FakeExtension {
  readonly socket: WebSocket;
  readonly received: HelperToExtension[] = [];
  private waiters: ((m: HelperToExtension) => void)[] = [];

  constructor(port: number, origin = 'chrome-extension://abcdefghijklmnop') {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
    sockets.push(this.socket);
    this.socket.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as HelperToExtension;
      this.received.push(m);
      this.waiters.splice(0).forEach((w) => w(m));
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
  }

  closed(): Promise<number> {
    return new Promise((resolve) => this.socket.once('close', (code) => resolve(code)));
  }

  next(): Promise<HelperToExtension> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Connects and pairs, answering requests with `answer` from the start; resolves after the welcome. */
  static async paired(port: number, code = CODE, browser = 'chrome', answer?: (method: string) => unknown): Promise<FakeExtension> {
    const ext = new FakeExtension(port);
    if (answer) ext.serve(answer);
    await ext.opened();
    const welcome = ext.next();
    ext.send({ type: 'hello', token: code, browser, version: '0.1.0' });
    await welcome;
    return ext;
  }

  /** Answers every request with `answer(method, params)`. */
  serve(answer: (method: string, params: unknown) => unknown): void {
    this.socket.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as HelperToExtension;
      if (m.type !== 'request') return;
      try {
        this.send({ type: 'result', requestId: m.requestId, ok: true, data: answer(m.method, m.params) });
      } catch (error) {
        this.send({ type: 'result', requestId: m.requestId, ok: false, error: (error as Error).message });
      }
    });
  }
}

describe('Bridge', () => {
  it('refuses the handshake from a web page', async () => {
    const bridge = await startBridge();
    const ext = new FakeExtension(bridge.port!, 'https://evil.example');
    await expect(ext.opened()).rejects.toThrow(/403/);
  });

  it('closes a socket that sends the wrong pairing code', async () => {
    const bridge = await startBridge();
    const ext = new FakeExtension(bridge.port!);
    await ext.opened();
    const closed = ext.closed();
    ext.send({ type: 'hello', token: 'WRONG-CODE', browser: 'chrome', version: '0.1.0' });
    expect(await closed).toBe(CLOSE_BAD_TOKEN);
    expect(bridge.connectionCount).toBe(0);
  });

  it('closes a socket that never says hello', async () => {
    const bridge = await startBridge({ helloTimeoutMs: 50 });
    const ext = new FakeExtension(bridge.port!);
    await ext.opened();
    expect(await ext.closed()).toBe(CLOSE_BAD_TOKEN);
  });

  it('accepts the code in any case and spacing, and welcomes with the AI app name', async () => {
    const bridge = await startBridge();
    bridge.setClientName('Claude Desktop');
    const ext = await FakeExtension.paired(bridge.port!, ' abcde fghjk mnpqr stuvw ');
    expect(ext.received[0]).toEqual({ type: 'welcome', helperVersion: '1.2.3', clientName: 'Claude Desktop' });
    expect(bridge.connectionCount).toBe(1);

    const update = ext.next();
    bridge.setClientName('Cursor');
    expect(await update).toMatchObject({ type: 'welcome', clientName: 'Cursor' });
  });

  it('answers pings', async () => {
    const bridge = await startBridge();
    const ext = await FakeExtension.paired(bridge.port!);
    const pong = ext.next();
    ext.send({ type: 'ping' });
    expect(await pong).toEqual({ type: 'pong' });
  });

  it('sends a request to the extension and returns its answer', async () => {
    const bridge = await startBridge();
    const ext = await FakeExtension.paired(bridge.port!);
    ext.serve((method) => (method === 'get_form' ? { url: 'https://x.test', title: 'X', fields: [] } : null));
    await expect(bridge.request('get_form', {})).resolves.toEqual({ url: 'https://x.test', title: 'X', fields: [] });
  });

  it('turns an error from the extension into a BridgeError', async () => {
    const bridge = await startBridge();
    const ext = await FakeExtension.paired(bridge.port!);
    ext.serve(() => {
      throw new Error("Formhand can't read this page");
    });
    const call = bridge.request('get_form', {});
    await expect(call).rejects.toBeInstanceOf(BridgeError);
    await expect(call).rejects.toThrow("Formhand can't read this page");
  });

  it('waits for a browser that connects shortly after the call', async () => {
    const bridge = await startBridge({ connectWaitMs: 2000 });
    const call = bridge.request('undo_fill', {});
    await FakeExtension.paired(bridge.port!, CODE, 'chrome', () => ({ restored: 2 }));
    await expect(call).resolves.toEqual({ restored: 2 });
  });

  it('says how to connect when no browser shows up', async () => {
    const bridge = await startBridge({ connectWaitMs: 50 });
    await expect(bridge.request('get_form', {})).rejects.toThrow(NOT_CONNECTED);
  });

  it('times out when the browser does not answer', async () => {
    const bridge = await startBridge({ requestTimeoutMs: 50 });
    await FakeExtension.paired(bridge.port!);
    await expect(bridge.request('get_form', {})).rejects.toThrow(/didn't answer in time/);
  });

  it('fails pending calls when the browser disconnects', async () => {
    const bridge = await startBridge({ requestTimeoutMs: 5000 });
    const ext = await FakeExtension.paired(bridge.port!);
    const call = bridge.request('get_form', {});
    await ext.next(); // the request arrived
    ext.socket.close();
    await expect(call).rejects.toThrow(/disconnected/);
  });

  it('sends requests to the browser the user focused last', async () => {
    const bridge = await startBridge();
    const chrome = await FakeExtension.paired(bridge.port!, CODE, 'chrome');
    const firefox = await FakeExtension.paired(bridge.port!, CODE, 'firefox');
    chrome.serve(() => ({ restored: 1 }));
    firefox.serve(() => ({ restored: 2 }));
    await expect(bridge.request('undo_fill', {})).resolves.toEqual({ restored: 2 });

    await new Promise((r) => setTimeout(r, 5));
    chrome.send({ type: 'focus' });
    await new Promise((r) => setTimeout(r, 20));
    await expect(bridge.request('undo_fill', {})).resolves.toEqual({ restored: 1 });
  });

  it('moves to the next port when one is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
    const taken = (blocker.address() as { port: number }).port;
    try {
      const bridge = new Bridge({ pairingCode: CODE, version: '1', ports: [taken, 0] });
      bridges.push(bridge);
      const port = await bridge.listen();
      expect(port).not.toBe(taken);
    } finally {
      blocker.close();
    }
  });

  it('reports when every port is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
    const taken = (blocker.address() as { port: number }).port;
    try {
      const bridge = new Bridge({ pairingCode: CODE, version: '1', ports: [taken] });
      bridges.push(bridge);
      await expect(bridge.listen()).rejects.toThrow(/All Formhand ports are busy/);
    } finally {
      blocker.close();
    }
  });
});
