import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { PageController } from '../lib/dom/page';
import { isPageRequest, type PageRequest, type Reply } from '../lib/messages';

declare global {
  interface Window {
    __formhand?: PageController;
  }
}

function handle(page: PageController, message: PageRequest): unknown {
  switch (message.type) {
    case 'formhand:scan':
      return page.scan();
    case 'formhand:fill':
      return page.fill(message.fills);
    case 'formhand:undo':
      return { restored: page.undo() };
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // The background injects this script again into tabs opened before install; run once.
    if (window.__formhand) return;
    const page = new PageController(document, { locale: navigator.language });
    window.__formhand = page;

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (reply: Reply<unknown>) => void) => {
      if (!isPageRequest(message)) return;
      try {
        sendResponse({ ok: true, data: handle(page, message) });
      } catch (error) {
        sendResponse({ ok: false, error: (error as Error).message });
      }
    });
  },
});
