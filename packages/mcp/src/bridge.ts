import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CLOSE_BAD_TOKEN,
  DEFAULT_PORTS,
  type BridgeMethod,
  type BridgeMethods,
  type ExtensionToHelper,
  type HelperToExtension,
} from '@formhand/core';
import { codesMatch } from './pairing';

export interface BridgeOptions {
  pairingCode: string;
  version: string;
  ports?: number[];
  host?: string;
  /** How long a tool call waits for the extension to answer. */
  requestTimeoutMs?: number;
  /** How long a tool call waits for an extension to connect when none is. */
  connectWaitMs?: number;
  /** How long a new socket has to send its hello. */
  helloTimeoutMs?: number;
  log?: (message: string) => void;
}

/** A tool-call failure worth showing to the AI as-is. */
export class BridgeError extends Error {}

interface Connection {
  socket: WebSocket;
  browser: string;
  /**
   * When the browser last connected or was focused, as a count: higher is more recent.
   * Not a clock time, because two browsers can connect within the same millisecond.
   */
  lastActive: number;
}

interface Pending {
  connection: Connection;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension|extension):\/\//;

export const NOT_CONNECTED =
  "The Formhand browser extension isn't connected. Ask the user to open their browser, check that Formhand is installed, " +
  'and that the pairing code from `formhand-mcp setup` is saved in Formhand > Settings > AI apps (MCP).';

/**
 * WebSocket server on 127.0.0.1 that the extension's background script connects to.
 * Web pages can't use it: the handshake is refused unless the Origin is an extension
 * (or absent, as for local programs), and the first message must carry the pairing code.
 */
export class Bridge {
  private wss?: WebSocketServer;
  private readonly connections = new Set<Connection>();
  /** Counts connects and focus events, to order browsers by most recent use. */
  private activity = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly events = new EventEmitter();
  private clientName?: string;
  port?: number;

  constructor(private readonly options: BridgeOptions) {}

  private log(message: string): void {
    this.options.log?.(message);
  }

  /** Binds the first free port of the range and returns it. */
  async listen(): Promise<number> {
    const host = this.options.host ?? '127.0.0.1';
    for (const port of this.options.ports ?? DEFAULT_PORTS) {
      try {
        const wss = await new Promise<WebSocketServer>((resolve, reject) => {
          const server = new WebSocketServer({
            host,
            port,
            maxPayload: 8 * 1024 * 1024,
            verifyClient: ({ origin }: { origin?: string }, done: (ok: boolean, code?: number, reason?: string) => void) =>
              !origin || EXTENSION_ORIGIN.test(origin) ? done(true) : done(false, 403, 'Only the Formhand extension can connect'),
          });
          server.once('listening', () => resolve(server));
          server.once('error', reject);
        });
        this.wss = wss;
        const address = wss.address();
        this.port = typeof address === 'object' && address ? address.port : port;
        wss.on('connection', (socket, req) => this.accept(socket, req));
        this.log(`listening on ws://${host}:${this.port}`);
        return this.port;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
        this.log(`port ${port} is busy, trying the next one`);
      }
    }
    throw new BridgeError(`All Formhand ports are busy (${(this.options.ports ?? DEFAULT_PORTS).join(', ')}).`);
  }

  /** Tells connected browsers which AI app this helper serves, for the side panel status. */
  setClientName(name: string | undefined): void {
    this.clientName = name;
    for (const c of this.connections) this.send(c.socket, this.welcome());
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  private welcome(): HelperToExtension {
    return { type: 'welcome', helperVersion: this.options.version, clientName: this.clientName };
  }

  private send(socket: WebSocket, message: HelperToExtension): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private accept(socket: WebSocket, req: IncomingMessage): void {
    let connection: Connection | undefined;
    const helloTimer = setTimeout(() => socket.close(CLOSE_BAD_TOKEN, 'no hello'), this.options.helloTimeoutMs ?? 5000);

    socket.on('message', (raw) => {
      let message: ExtensionToHelper;
      try {
        message = JSON.parse(raw.toString()) as ExtensionToHelper;
      } catch {
        return;
      }
      if (!connection) {
        clearTimeout(helloTimer);
        if (message.type !== 'hello' || typeof message.token !== 'string' || !codesMatch(message.token, this.options.pairingCode)) {
          this.log(`refused a connection from ${req.headers.origin ?? 'a local program'}: wrong pairing code`);
          socket.close(CLOSE_BAD_TOKEN, 'wrong pairing code');
          return;
        }
        connection = { socket, browser: message.browser, lastActive: ++this.activity };
        this.connections.add(connection);
        this.log(`${message.browser} connected`);
        this.send(socket, this.welcome());
        this.events.emit('connected');
        return;
      }
      this.handle(connection, message);
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (!connection) return;
      this.connections.delete(connection);
      this.log(`${connection.browser} disconnected`);
      for (const [id, p] of this.pending) {
        if (p.connection !== connection) continue;
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(new BridgeError('The browser disconnected before answering.'));
      }
    });
    socket.on('error', () => socket.terminate());
  }

  private handle(connection: Connection, message: ExtensionToHelper): void {
    switch (message.type) {
      case 'ping':
        this.send(connection.socket, { type: 'pong' });
        return;
      case 'focus':
        connection.lastActive = ++this.activity;
        return;
      case 'result': {
        const p = this.pending.get(message.requestId);
        if (!p || p.connection !== connection) return;
        clearTimeout(p.timer);
        this.pending.delete(message.requestId);
        if (message.ok) p.resolve(message.data);
        else p.reject(new BridgeError(message.error));
        return;
      }
    }
  }

  /** The browser the user used last, waiting a little for one to connect if none has. */
  private async pickConnection(): Promise<Connection> {
    const pick = () => [...this.connections].sort((a, b) => b.lastActive - a.lastActive)[0];
    const now = pick();
    if (now) return now;
    const wait = this.options.connectWaitMs ?? 30_000;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.events.off('connected', onConnected);
        reject(new BridgeError(NOT_CONNECTED));
      }, wait);
      const onConnected = () => {
        clearTimeout(timer);
        resolve();
      };
      this.events.once('connected', onConnected);
    });
    return pick()!;
  }

  async request<M extends BridgeMethod>(method: M, params: BridgeMethods[M]['params']): Promise<BridgeMethods[M]['result']> {
    if (!this.wss) throw new BridgeError(NOT_CONNECTED);
    const connection = await this.pickConnection();
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new BridgeError("The browser didn't answer in time. The page may be busy; ask the user to try again."));
      }, this.options.requestTimeoutMs ?? 20_000);
      this.pending.set(requestId, {
        connection,
        resolve: resolve as (data: unknown) => void,
        reject,
        timer,
      });
      this.send(connection.socket, { type: 'request', requestId, method, params });
    });
  }

  async close(): Promise<void> {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    for (const c of this.connections) c.socket.terminate();
    this.connections.clear();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
    this.wss = undefined;
  }
}
