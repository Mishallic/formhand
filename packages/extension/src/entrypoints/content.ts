import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { PageController } from '../lib/dom/page';
import { isPageRequest, type PageRequest, type Reply } from '../lib/messages';

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
  main(ctx) {
    const page = new PageController(document, { locale: navigator.language });

    const listener = (message: unknown, _sender: unknown, sendResponse: (reply: Reply<unknown>) => void) => {
      if (!isPageRequest(message)) return;
      try {
        sendResponse({ ok: true, data: handle(page, message) });
      } catch (error) {
        sendResponse({ ok: false, error: (error as Error).message });
      }
    };
    browser.runtime.onMessage.addListener(listener);
    // A newer copy (after an extension update, or injected by the background) takes over;
    // this one stops answering so a request is never handled twice.
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(listener));
  },
});
