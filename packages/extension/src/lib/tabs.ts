import { browser } from 'wxt/browser';
import type { PageRequest, PageResults, Reply } from './messages';

export const RESTRICTED_PAGE =
  "Formhand can't work on this page. Browsers keep extensions out of their own pages (settings, new tab, extension stores) and PDF viewers.";

/** The tab the user is looking at in the browser window they used last. */
export async function activeTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
  if (tab?.id === undefined) throw new Error('No browser tab is open.');
  return tab.id;
}

async function ask<T>(tabId: number, request: PageRequest): Promise<Reply<T> | undefined> {
  return (await browser.tabs.sendMessage(tabId, request, { frameId: 0 })) as Reply<T> | undefined;
}

/**
 * Sends a request to the content script of a tab. Tabs opened before Formhand was
 * installed (or updated) have no content script yet, so it is injected and the
 * request sent again.
 */
export async function sendToTab<K extends PageRequest['type']>(tabId: number, request: Extract<PageRequest, { type: K }>): Promise<PageResults[K]> {
  let reply: Reply<PageResults[K]> | undefined;
  try {
    reply = await ask(tabId, request);
  } catch {
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/content.js'] });
      reply = await ask(tabId, request);
    } catch {
      throw new Error(RESTRICTED_PAGE);
    }
  }
  if (!reply) throw new Error(RESTRICTED_PAGE);
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
