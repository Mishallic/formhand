import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormSnapshot } from '@formhand/core';
import { browser } from 'wxt/browser';
import type { BackgroundBroadcast, BridgeStatus } from '../lib/messages';
import { loadSettings, onSettingsChanged, saveSettings, type Settings } from '../lib/settings';
import { sendToTab } from '../lib/tabs';

/**
 * `?tabId=123` pins the panel to one tab. Used when the panel is opened as a normal
 * page (end-to-end tests, screenshots) instead of beside the tab it works on.
 */
function pinnedTab(): number | undefined {
  const v = new URLSearchParams(location.search).get('tabId');
  return v ? Number(v) : undefined;
}

/** The form in the tab the panel sits beside, rescanned when the tab changes or reloads. */
export function usePage() {
  const [tabId, setTabId] = useState<number>();
  const [snapshot, setSnapshot] = useState<FormSnapshot>();
  const [error, setError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const tabRef = useRef<number | undefined>(undefined);

  const scan = useCallback(async () => {
    const id = pinnedTab() ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    const changedTab = id !== tabRef.current;
    tabRef.current = id;
    setTabId(id);
    if (id === undefined) {
      setSnapshot(undefined);
      setError('No tab is open.');
      return;
    }
    setScanning(true);
    if (changedTab) setSnapshot(undefined);
    try {
      setSnapshot(await sendToTab(id, { type: 'formhand:scan' }));
      setError(undefined);
    } catch (e) {
      setSnapshot(undefined);
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scan();
    const onActivated = () => {
      if (pinnedTab() === undefined) void scan();
    };
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id === tabRef.current && info.status === 'complete') void scan();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [scan]);

  return { tabId, snapshot, error, scanning, rescan: scan };
}

/** Settings, saved as they change. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>();
  useEffect(() => {
    void loadSettings().then(setSettings);
    return onSettingsChanged(setSettings);
  }, []);
  const update = useCallback(async (next: Settings) => {
    setSettings(next);
    await saveSettings(next);
  }, []);
  return { settings, update };
}

/** The MCP bridge status, plus a short-lived line when an AI app just used it. */
export function useBridge(onActivity?: (text: string) => void) {
  const [status, setStatus] = useState<BridgeStatus>({ state: 'off', apps: [] });
  const activity = useRef(onActivity);
  activity.current = onActivity;

  useEffect(() => {
    browser.runtime
      .sendMessage({ type: 'bridge:status' })
      .then((s) => s && setStatus(s as BridgeStatus))
      .catch(() => {});
    const listener = (message: unknown) => {
      const m = message as BackgroundBroadcast;
      if (m?.type === 'bridge:status-changed') setStatus(m.status);
      if (m?.type === 'bridge:activity') activity.current?.(`${m.clientName ?? 'An AI app'} ${m.summary}.`);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  const reconnect = useCallback(async () => {
    const s = (await browser.runtime.sendMessage({ type: 'bridge:reconnect' }).catch(() => undefined)) as BridgeStatus | undefined;
    if (s) setStatus(s);
  }, []);

  return { status, reconnect };
}
