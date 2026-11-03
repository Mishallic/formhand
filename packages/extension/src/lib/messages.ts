import type { BridgeMethod, Fill, FillResult, FormSnapshot } from '@formhand/core';

/** Requests the side panel and the background send to the content script in a tab. */
export type PageRequest = { type: 'formhand:scan' } | { type: 'formhand:fill'; fills: Fill[] } | { type: 'formhand:undo' };

export interface PageResults {
  'formhand:scan': FormSnapshot;
  'formhand:fill': FillResult;
  'formhand:undo': { restored: number };
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

/** Requests the side panel sends to the background script. */
export type BackgroundRequest = { type: 'bridge:status' } | { type: 'bridge:reconnect' };

export interface BridgeApp {
  port: number;
  clientName?: string;
}

export interface BridgeStatus {
  /** off: turned off or no code; searching: no helper answered yet; connected: at least one AI app. */
  state: 'off' | 'searching' | 'connected' | 'bad-code';
  apps: BridgeApp[];
}

/** What the background tells open side panels, unasked. */
export type BackgroundBroadcast =
  | { type: 'bridge:status-changed'; status: BridgeStatus }
  /** An AI app used the bridge on the active tab ("filled 5 fields"). */
  | { type: 'bridge:activity'; method: BridgeMethod; clientName?: string; summary: string };

export function isPageRequest(message: unknown): message is PageRequest {
  const type = (message as { type?: unknown } | null)?.type;
  return type === 'formhand:scan' || type === 'formhand:fill' || type === 'formhand:undo';
}
