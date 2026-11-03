import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_BAD_TOKEN, type HelperToExtension } from '@formhand/core';
import { BridgeClient } from '../src/lib/bridge-client';
import type { BridgeStatus } from '../src/lib/messages';

/** Enough of WebSocket for BridgeClient, driven by the test. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // Test controls
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: HelperToExtension) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function socketFor(port: number): FakeSocket {
  return FakeSocket.all.filter((s) => s.url === `ws://127.0.0.1:${port}`).at(-1)!;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let statuses: BridgeStatus[];
let handle: ReturnType<typeof vi.fn>;

function client(): BridgeClient {
  return new BridgeClient({
    browserName: 'chrome',
    version: '0.1.0',
    ports: [1001, 1002],
    handle: handle as never,
    onStatus: (s) => statuses.push(s),
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    heartbeatMs: 1000,
  });
}

beforeEach(() => {
  FakeSocket.all = [];
  statuses = [];
  handle = vi.fn(async () => ({ ok: 1 }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BridgeClient', () => {
  it('stays off without a pairing code', () => {
    const c = client();
    c.configure(true, '   ');
    expect(FakeSocket.all).toEqual([]);
    expect(c.status()).toEqual({ state: 'off', apps: [] });
  });

  it('opens one socket per port and says hello with the code', () => {
    const c = client();
    c.configure(true, 'ABCDE-FGHJK');
    expect(FakeSocket.all.map((s) => s.url)).toEqual(['ws://127.0.0.1:1001', 'ws://127.0.0.1:1002']);
    socketFor(1001).open();
    expect(socketFor(1001).sent).toEqual([{ type: 'hello', token: 'ABCDE-FGHJK', browser: 'chrome', version: '0.1.0' }]);
    expect(c.status().state).toBe('searching');
  });

  it('is connected once a helper welcomes it, and names the AI app', () => {
    const c = client();
    c.configure(true, 'CODE');
    socketFor(1002).open();
    socketFor(1002).receive({ type: 'welcome', helperVersion: '0.1.0', clientName: 'Claude Desktop' });
    expect(c.status()).toEqual({ state: 'connected', apps: [{ port: 1002, clientName: 'Claude Desktop' }] });
    expect(statuses.at(-1)?.state).toBe('connected');
  });

  it('answers tool calls with the handler result or its error', async () => {
    const c = client();
    c.configure(true, 'CODE');
    const s = socketFor(1001);
    s.open();
    s.receive({ type: 'welcome', helperVersion: '0.1.0' });
    s.receive({ type: 'request', requestId: 'r1', method: 'get_form', params: {} });
    await flush();
    expect(handle).toHaveBeenCalledWith('get_form', {});
    expect(s.sent.at(-1)).toEqual({ type: 'result', requestId: 'r1', ok: true, data: { ok: 1 } });

    handle.mockRejectedValueOnce(new Error("Formhand can't work on this page."));
    s.receive({ type: 'request', requestId: 'r2', method: 'fill_form', params: { fills: [] } });
    await flush();
    expect(s.sent.at(-1)).toEqual({ type: 'result', requestId: 'r2', ok: false, error: "Formhand can't work on this page." });
  });

  it('reconnects dropped ports on connect()', () => {
    const c = client();
    c.configure(true, 'CODE');
    socketFor(1001).drop();
    expect(FakeSocket.all).toHaveLength(2);
    c.connect();
    expect(FakeSocket.all).toHaveLength(3);
    expect(FakeSocket.all[2]!.url).toBe('ws://127.0.0.1:1001');
  });

  it('stops trying after a wrong code, until retry or a new code', () => {
    const c = client();
    c.configure(true, 'WRONG');
    socketFor(1001).open();
    socketFor(1001).drop(CLOSE_BAD_TOKEN);
    expect(c.status().state).toBe('bad-code');
    c.connect();
    expect(FakeSocket.all).toHaveLength(2);

    c.retry();
    expect(FakeSocket.all).toHaveLength(3);
    socketFor(1001).drop(CLOSE_BAD_TOKEN);
    c.configure(true, 'RIGHT');
    expect(c.status().state).toBe('searching');
    expect(FakeSocket.all.length).toBeGreaterThan(3);
  });

  it('closes everything when turned off', () => {
    const c = client();
    c.configure(true, 'CODE');
    c.configure(false, 'CODE');
    expect(FakeSocket.all.every((s) => s.closed)).toBe(true);
    expect(c.status().state).toBe('off');
  });

  it('pings paired helpers to stay alive, and reports focus', () => {
    vi.useFakeTimers();
    const c = client();
    c.configure(true, 'CODE');
    const paired = socketFor(1001);
    paired.open();
    paired.receive({ type: 'welcome', helperVersion: '0.1.0' });
    socketFor(1002).open(); // open but never welcomed
    vi.advanceTimersByTime(1000);
    expect(paired.sent.at(-1)).toEqual({ type: 'ping' });
    c.focus();
    expect(paired.sent.at(-1)).toEqual({ type: 'focus' });
    expect(socketFor(1002).sent).toEqual([{ type: 'hello', token: 'CODE', browser: 'chrome', version: '0.1.0' }]);
  });
});
