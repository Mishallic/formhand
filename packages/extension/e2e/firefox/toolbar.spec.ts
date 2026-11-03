import { Context, type Driver } from 'selenium-webdriver/firefox.js';
import { expect, test } from './fixtures';

// Firefox has no side panel API: the toolbar button toggles a sidebar (background.ts),
// and Alt+Shift+F is the sidebar's own command. These run in Firefox's chrome context.
const SIDEBAR = 'formhand_mishallic_dev-sidebar-action';

async function inChrome<T>(driver: Driver, script: string): Promise<T> {
  await driver.setContext(Context.CHROME);
  try {
    return (await driver.executeScript(script)) as T;
  } finally {
    await driver.setContext(Context.CONTENT);
  }
}

const sidebar = (driver: Driver) => inChrome<string>(driver, 'return SidebarController.isOpen ? SidebarController.currentID : ""');

/** Clicks Formhand's button in the toolbar's Extensions menu, as a person would. */
async function clickToolbarButton(driver: Driver): Promise<void> {
  await inChrome(driver, 'gUnifiedExtensions.togglePanel()');
  await driver.wait(() => inChrome(driver, 'return !!document.getElementById("formhand_mishallic_dev-BAP")?.checkVisibility()'), 10_000, 'The Extensions menu did not show Formhand');
  await inChrome(driver, 'document.getElementById("formhand_mishallic_dev-BAP").click()');
}

test('the toolbar button opens and closes the Formhand sidebar', async ({ driver, server }) => {
  await driver.get(`${server.url}/apply.html`);
  // Firefox opens the sidebar once, right after install.
  await driver.wait(async () => (await sidebar(driver)) === SIDEBAR, 10_000, 'The sidebar did not open at install');

  await clickToolbarButton(driver);
  await driver.wait(async () => (await sidebar(driver)) === '', 10_000, 'The toolbar button did not close the sidebar');
  await clickToolbarButton(driver);
  await driver.wait(async () => (await sidebar(driver)) === SIDEBAR, 10_000, 'The toolbar button did not open the sidebar');
  expect(await inChrome(driver, 'return SidebarController.browser.contentDocument.getElementById("webext-panels-browser").currentURI.spec')).toMatch(/\/sidepanel\.html$/);
});

test('Alt+Shift+F is the shortcut, and its command toggles the sidebar', async ({ driver, server }) => {
  await driver.get(`${server.url}/apply.html`);
  const key = await inChrome<{ key: string; modifiers: string }>(
    driver,
    `const k = document.getElementById('ext-key-id-${SIDEBAR}'); return { key: k.getAttribute('key'), modifiers: k.getAttribute('modifiers') }`,
  );
  expect(key).toEqual({ key: 'F', modifiers: 'alt,shift' });
  await driver.wait(async () => (await sidebar(driver)) === SIDEBAR, 10_000);
  await inChrome(driver, `document.getElementById('ext-key-id-${SIDEBAR}').doCommand()`);
  await driver.wait(async () => (await sidebar(driver)) === '', 10_000, 'The shortcut did not close the sidebar');
});
