import { join } from 'node:path';
import { test as base } from '@playwright/test';
import { Builder, By, Key, type WebDriver, type WebElement } from 'selenium-webdriver';
import { Context, Driver as FirefoxDriver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { startServer, type TestServer } from '../server';

// Added in selenium-webdriver 4.x after the last @types/selenium-webdriver release.
declare module 'selenium-webdriver/firefox.js' {
  interface Driver {
    installWebExtension(extension: string, options?: { permanent?: boolean; allowPrivateBrowsing?: boolean }): Promise<unknown>;
  }
}

// Playwright can't load extensions into Firefox, so these tests drive a real Firefox
// through geckodriver (Selenium Manager fetches it), and use Playwright only as the runner.
// Run `npm run build -w @formhand/extension -- -b firefox` first.
export const EXTENSION_PATH = join(import.meta.dirname, '..', '..', '.output', 'firefox-mv2');
const EXTENSION_ID = 'formhand@mishallic.dev';
// Firefox gives each install a random moz-extension:// host; this pins it so the tests can open the panel.
const EXTENSION_HOST = '0f4d6a1e-3c2b-4e8f-9a7d-5b1c2e3f4a5b';
export const PANEL_URL = `moz-extension://${EXTENSION_HOST}/sidepanel.html`;
const WAIT = 10_000;

/** One browser tab. Selenium talks to one tab at a time, so every call switches to it first. */
export class Tab {
  constructor(
    readonly driver: WebDriver,
    readonly handle: string,
  ) {}

  async focus(): Promise<void> {
    if ((await this.driver.getWindowHandle()) !== this.handle) await this.driver.switchTo().window(this.handle);
  }

  /** Runs a script in the page; `arguments[0]`… are the args. */
  async run<T>(script: string, ...args: unknown[]): Promise<T> {
    await this.focus();
    return (await this.driver.executeScript(script, ...args)) as T;
  }

  /** Runs a script that ends by calling `done(result)`. */
  async runAsync<T>(script: string, ...args: unknown[]): Promise<T> {
    await this.focus();
    return (await this.driver.executeAsyncScript(`const done = arguments[arguments.length - 1];\n${script}`, ...args)) as T;
  }

  value(selector: string): Promise<string> {
    return this.run('return document.querySelector(arguments[0]).value', selector);
  }

  checked(selector: string): Promise<boolean> {
    return this.run('return document.querySelector(arguments[0]).checked', selector);
  }

  attribute(selector: string, name: string): Promise<string | null> {
    return this.run('return document.querySelector(arguments[0]).getAttribute(arguments[1])', selector, name);
  }

  async find(selector: string): Promise<WebElement> {
    await this.focus();
    return this.driver.findElement(By.css(selector));
  }

  /** A button by its visible text or aria-label; a RegExp source matches part of it. */
  async button(name: string | RegExp): Promise<WebElement> {
    await this.focus();
    const [source, flags] = typeof name === 'string' ? [name, null] : [name.source, name.flags];
    // One round trip per try, rather than one per button.
    const find = () =>
      this.driver.executeScript<WebElement | null>(
        `const [source, flags] = arguments;
        const matches = (label) => (flags === null ? label === source : new RegExp(source, flags).test(label));
        return [...document.querySelectorAll('button')].find((b) => matches((b.getAttribute('aria-label') || b.innerText).trim())) ?? null;`,
        source,
        flags,
      );
    return (await this.driver.wait(find, WAIT, `No button named ${String(name)}`)) as WebElement;
  }

  async click(name: string | RegExp): Promise<void> {
    await this.clickOn(await this.button(name));
  }

  /**
   * Clicks an element after scrolling it to the middle of the view. WebDriver only scrolls
   * it to the edge, where the panel's sticky action bar can cover it.
   */
  async clickOn(target: string | WebElement): Promise<void> {
    const el = typeof target === 'string' ? await this.find(target) : target;
    await this.driver.executeScript('arguments[0].scrollIntoView({ block: "center" })', el);
    await el.click();
  }

  /** Replaces a field's text the way a person would: select all, then type. */
  async type(selector: string, text: string): Promise<void> {
    const el = await this.find(selector);
    await el.sendKeys(Key.chord(Key.CONTROL, 'a'), Key.BACK_SPACE);
    await el.sendKeys(text);
  }

  async text(): Promise<string> {
    return this.run('return document.body.innerText');
  }

  async waitForText(text: string): Promise<void> {
    await this.focus();
    let last = '';
    try {
      await this.driver.wait(async () => (last = await this.text()).includes(text), WAIT);
    } catch {
      throw new Error(`Timed out waiting for "${text}". The page says:\n${last}`);
    }
  }
}

/**
 * Opens an extension page in a new tab and switches to it. WebDriver may not navigate to
 * moz-extension:// itself, so the tab is opened from Firefox's own (chrome) scripting context.
 */
async function openExtensionTab(driver: FirefoxDriver, url: string): Promise<Tab> {
  const before = new Set(await driver.getAllWindowHandles());
  await driver.setContext(Context.CHROME);
  try {
    await driver.executeScript(
      'gBrowser.selectedTab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });',
      url,
    );
  } finally {
    await driver.setContext(Context.CONTENT);
  }
  const handle = (await driver.wait(async () => (await driver.getAllWindowHandles()).find((h) => !before.has(h)), WAIT, `${url} did not open`)) as string;
  const tab = new Tab(driver, handle);
  await tab.focus();
  await driver.wait(async () => (await tab.run<string>('return document.readyState')) === 'complete' && (await driver.getCurrentUrl()).startsWith(url), WAIT);
  return tab;
}

interface Fixtures {
  driver: FirefoxDriver;
  /** Opens the test form (or another test page), then the panel pinned to that tab. */
  openForm: (path?: string) => Promise<{ form: Tab; panel: Tab; tabId: number }>;
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

  driver: async ({}, use) => {
    const options = new Options()
      .setPreference('extensions.webextensions.uuids', JSON.stringify({ [EXTENSION_ID]: EXTENSION_HOST }))
      .windowSize({ width: 1100, height: 900 });
    if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
    if (!process.env.HEADED) options.addArguments('-headless');
    // Lets openExtensionTab use the chrome context.
    const service = new ServiceBuilder().addArguments('--allow-system-access');
    const driver = (await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build()) as FirefoxDriver;
    await driver.installWebExtension(EXTENSION_PATH, { permanent: false });
    await use(driver);
    await driver.quit();
  },

  setSettings: async ({ driver }, use) => {
    await use(async (settings) => {
      const home = await driver.getWindowHandle();
      const tab = await openExtensionTab(driver, PANEL_URL);
      const error = await tab.runAsync<string | null>('browser.storage.local.set({ settings: arguments[0] }).then(() => done(null), (e) => done(String(e)))', settings);
      if (error) throw new Error(error);
      await driver.close();
      await driver.switchTo().window(home);
    });
  },

  openForm: async ({ driver, server }, use) => {
    await use(async (path = '/apply.html') => {
      const form = new Tab(driver, await driver.getWindowHandle());
      await driver.get(`${server.url}${path}`);
      // Load the panel once to reach the extension's APIs, find the form's tab, then pin the panel to it.
      const panel = await openExtensionTab(driver, PANEL_URL);
      const tabId = await panel.runAsync<number>(
        'browser.tabs.query({}).then((tabs) => done(tabs.find((t) => t.url === arguments[0])?.id))',
        `${server.url}${path}`,
      );
      if (typeof tabId !== 'number') throw new Error(`No tab found for ${path}`);
      await panel.run('location.search = arguments[0]', `?tabId=${tabId}`);
      await driver.wait(async () => (await driver.getCurrentUrl()).endsWith(`?tabId=${tabId}`) && (await panel.run<string>('return document.readyState')) === 'complete', WAIT);
      return { form, panel, tabId };
    });
  },
});

export { expect } from '@playwright/test';
