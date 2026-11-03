import { join } from 'node:path';
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { startServer, type TestServer } from './server';

// The extension's own APIs, as seen from inside its service worker.
declare const chrome: any;

export const EXTENSION_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3');

interface Fixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  /** Opens the test form (or another test page), then the side panel page pinned to that tab. */
  openForm: (path?: string) => Promise<{ form: Page; panel: Page; tabId: number }>;
  /** Writes extension settings straight into storage, as the Settings tab would. */
  setSettings: (settings: unknown) => Promise<void>;
}

export const test = base.extend<Fixtures, { server: TestServer }>({
  server: [
    async ({}, use) => {
      const server = await startServer();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
      viewport: { width: 1100, height: 900 },
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    const [worker] = context.serviceWorkers();
    await use(worker ?? (await context.waitForEvent('serviceworker')));
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  setSettings: async ({ serviceWorker }, use) => {
    await use(async (settings) => {
      await serviceWorker.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
    });
  },

  openForm: async ({ context, server, serviceWorker, extensionId }, use) => {
    await use(async (path = '/apply.html') => {
      const form = await context.newPage();
      await form.goto(`${server.url}${path}`);
      const tabId = (await serviceWorker.evaluate(
        async (url: string) => (await chrome.tabs.query({})).find((t: { url?: string }) => t.url === url)?.id,
        form.url(),
      )) as number;
      const panel = await context.newPage();
      await panel.setViewportSize({ width: 400, height: 860 });
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
      return { form, panel, tabId };
    });
  },
});

export { expect } from '@playwright/test';
