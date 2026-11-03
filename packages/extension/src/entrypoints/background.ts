import type { Fill } from '@formhand/core';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { BridgeClient } from '../lib/bridge-client';
import type { BackgroundBroadcast, BackgroundRequest, BridgeStatus } from '../lib/messages';
import { loadSettings, onSettingsChanged } from '../lib/settings';
import { activeTabId, sendToTab } from '../lib/tabs';

function validFills(params: unknown): Fill[] {
  const fills = (params as { fills?: unknown } | null)?.fills;
  if (!Array.isArray(fills)) throw new Error('fill_form needs a list of { id, value }.');
  return fills.filter((f): f is Fill => typeof f?.id === 'string' && typeof f?.value === 'string');
}

function broadcast(message: BackgroundBroadcast): void {
  // Rejects when no side panel is open to listen; that's fine.
  browser.runtime.sendMessage(message).catch(() => {});
}

export default defineBackground({
  // Firefox (MV2): keep the background page, and with it the bridge sockets, alive.
  persistent: true,
  main() {
    const sidePanel = (browser as { sidePanel?: { setPanelBehavior(o: { openPanelOnActionClick: boolean }): Promise<void> } }).sidePanel;
    if (sidePanel) {
      void sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } else {
      // Firefox: the toolbar button toggles the sidebar.
      const firefox = browser as unknown as { browserAction?: typeof browser.action; sidebarAction?: { toggle(): Promise<void> } };
      (firefox.browserAction ?? browser.action)?.onClicked.addListener(() => void firefox.sidebarAction?.toggle());
    }

    let lastClient: string | undefined;
    const bridge = new BridgeClient({
      browserName: import.meta.env.BROWSER,
      version: browser.runtime.getManifest().version,
      onStatus: (status) => {
        lastClient = status.apps.find((a) => a.clientName)?.clientName;
        broadcast({ type: 'bridge:status-changed', status });
      },
      handle: async (method, params) => {
        const tabId = await activeTabId();
        switch (method) {
          case 'get_form': {
            const snapshot = await sendToTab(tabId, { type: 'formhand:scan' });
            broadcast({ type: 'bridge:activity', method, clientName: lastClient, summary: `read ${snapshot.fields.length} fields` });
            return snapshot;
          }
          case 'fill_form': {
            const result = await sendToTab(tabId, { type: 'formhand:fill', fills: validFills(params) });
            broadcast({ type: 'bridge:activity', method, clientName: lastClient, summary: `filled ${result.filled.length} fields` });
            return result;
          }
          case 'undo_fill': {
            const result = await sendToTab(tabId, { type: 'formhand:undo' });
            broadcast({ type: 'bridge:activity', method, clientName: lastClient, summary: `undid a fill (${result.restored} fields)` });
            return result;
          }
          default:
            throw new Error(`Unknown request: ${String(method)}`);
        }
      },
    });

    void loadSettings().then((s) => bridge.configure(s.bridge.enabled, s.bridge.pairingCode, s.bridge.ports));
    onSettingsChanged((s) => bridge.configure(s.bridge.enabled, s.bridge.pairingCode, s.bridge.ports));

    // Look for helpers that started after us (an AI app opened later). Chrome wakes the
    // service worker for alarms at most every 30 seconds.
    void browser.alarms.create('formhand-bridge', { periodInMinutes: 0.5 });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'formhand-bridge') bridge.connect();
    });

    browser.windows?.onFocusChanged.addListener((windowId) => {
      if (windowId !== browser.windows.WINDOW_ID_NONE) bridge.focus();
    });

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (status: BridgeStatus) => void) => {
      const type = (message as BackgroundRequest | null)?.type;
      if (type === 'bridge:reconnect') bridge.retry();
      else if (type === 'bridge:status') bridge.connect();
      else return;
      sendResponse(bridge.status());
    });
  },
});
