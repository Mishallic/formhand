import {
  CLOSE_BAD_TOKEN,
  DEFAULT_PORTS,
  type BridgeMethod,
  type ExtensionToHelper,
  type HelperToExtension,
} from '@formhand/core';
import type { BridgeStatus } from './messages';

export interface BridgeClientOptions {
  browserName: string;
  version: string;
  /** Runs a tool call from an AI app against the active tab. */
  handle: (method: BridgeMethod, params: unknown) => Promise<unknown>;
  onStatus?: (status: BridgeStatus) => void;
  ports?: number[];
  host?: string;
  /** Pings keep the socket, and Chrome's service worker, alive (Chrome 116+ counts socket traffic as activity). */
  heartbeatMs?: number;
  WebSocketImpl?: typeof WebSocket;
}

interface Link {
  socket: WebSocket;
  port: number;
  paired: boolean;
  clientName?: string;
}

/**
 * The extension's end of the MCP bridge: keeps a WebSocket to every Formhand helper
 * running on this computer (one per AI app, each on its own port) and answers their
 * tool calls. Connecting is cheap and silent, so it simply retries missing ports
 * whenever `connect()` is called (on a timer, and when the side panel opens).
 */
export class BridgeClient {
  private enabled = false;
  private code = '';
  private badCode = false;
  private readonly links = new Map<number, Link>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private ports: number[];

  constructor(private readonly options: BridgeClientOptions) {
    this.ports = options.ports ?? DEFAULT_PORTS;
  }

  configure(enabled: boolean, pairingCode: string, ports?: number[]): void {
    const code = pairingCode.trim();
    const nextPorts = ports?.length ? ports : (this.options.ports ?? DEFAULT_PORTS);
    if (code !== this.code || nextPorts.join() !== this.ports.join()) {
      this.code = code;
      this.ports = nextPorts;
      this.badCode = false;
      this.closeAll();
    }
    this.enabled = enabled && !!code;
    if (this.enabled) {
      this.startHeartbeat();
      this.connect();
    } else {
      this.closeAll();
      this.stopHeartbeat();
    }
    this.emit();
  }

  /** Opens sockets to ports that have none. A wrong pairing code stops this until the code changes or `retry()`. */
  connect(): void {
    if (!this.enabled || this.badCode) return;
    for (const port of this.ports) if (!this.links.has(port)) this.open(port);
  }

  retry(): void {
    this.badCode = false;
    this.connect();
    this.emit();
  }

  /** Tells the helpers this browser is the one in use, so their tool calls come here. */
  focus(): void {
    for (const link of this.links.values()) if (link.paired) this.send(link.socket, { type: 'focus' });
  }

  status(): BridgeStatus {
    if (!this.enabled) return { state: 'off', apps: [] };
    if (this.badCode) return { state: 'bad-code', apps: [] };
    const apps = [...this.links.values()].filter((l) => l.paired).map((l) => ({ port: l.port, clientName: l.clientName }));
    return { state: apps.length ? 'connected' : 'searching', apps };
  }

  private emit(): void {
    this.options.onStatus?.(this.status());
  }

  private send(socket: WebSocket, message: ExtensionToHelper): void {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  private open(port: number): void {
    const WS = this.options.WebSocketImpl ?? WebSocket;
    let socket: WebSocket;
    try {
      socket = new WS(`ws://${this.options.host ?? '127.0.0.1'}:${port}`);
    } catch {
      return;
    }
    const link: Link = { socket, port, paired: false };
    this.links.set(port, link);
    socket.onopen = () => this.send(socket, { type: 'hello', token: this.code, browser: this.options.browserName, version: this.options.version });
    socket.onmessage = (event: MessageEvent) => void this.receive(link, String(event.data));
    socket.onerror = () => {
      // A close event follows; nothing is listening on most ports most of the time.
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.links.get(port) === link) this.links.delete(port);
      if (event.code === CLOSE_BAD_TOKEN) this.badCode = true;
      if (link.paired || event.code === CLOSE_BAD_TOKEN) this.emit();
    };
  }

  private async receive(link: Link, raw: string): Promise<void> {
    let message: HelperToExtension;
    try {
      message = JSON.parse(raw) as HelperToExtension;
    } catch {
      return;
    }
    if (message.type === 'welcome') {
      link.paired = true;
      link.clientName = message.clientName;
      this.emit();
      return;
    }
    if (message.type !== 'request') return;
    try {
      const data = await this.options.handle(message.method, message.params);
      this.send(link.socket, { type: 'result', requestId: message.requestId, ok: true, data });
    } catch (error) {
      this.send(link.socket, { type: 'result', requestId: message.requestId, ok: false, error: (error as Error).message });
    }
  }

  private closeAll(): void {
    for (const link of this.links.values()) {
      link.socket.onclose = null;
      link.socket.close();
    }
    this.links.clear();
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const link of this.links.values()) if (link.paired) this.send(link.socket, { type: 'ping' });
    }, this.options.heartbeatMs ?? 20_000);
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}
