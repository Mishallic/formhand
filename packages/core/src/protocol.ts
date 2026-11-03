import type { Fill, FillResult, FormSnapshot } from './types';

/**
 * Messages between the MCP helper (a WebSocket server on 127.0.0.1) and the
 * extension's background script (the WebSocket client). The extension sends `hello`
 * with the pairing token first; the helper closes the socket if the token is wrong.
 */

export const DEFAULT_PORTS = [17345, 17346, 17347, 17348, 17349];

/** WebSocket close code the helper uses for a wrong or missing pairing token. */
export const CLOSE_BAD_TOKEN = 4001;
/** Close code for a connection from a web page rather than an extension. */
export const CLOSE_BAD_ORIGIN = 4003;

export interface BridgeMethods {
  get_form: { params: Record<string, never>; result: FormSnapshot };
  fill_form: { params: { fills: Fill[] }; result: FillResult };
  undo_fill: { params: Record<string, never>; result: { restored: number } };
}

export type BridgeMethod = keyof BridgeMethods;

export type ExtensionToHelper =
  | { type: 'hello'; token: string; browser: string; version: string }
  | { type: 'focus' }
  | { type: 'ping' }
  | { type: 'result'; requestId: string; ok: true; data: unknown }
  | { type: 'result'; requestId: string; ok: false; error: string };

export type HelperToExtension =
  | { type: 'welcome'; helperVersion: string; clientName?: string }
  | { type: 'pong' }
  | { type: 'request'; requestId: string; method: BridgeMethod; params: unknown };
