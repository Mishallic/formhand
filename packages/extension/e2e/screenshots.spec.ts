import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from './fixtures';

// SCREENSHOTS=../../docs npx playwright test screenshots
const OUT = process.env.SCREENSHOTS;
test.skip(!OUT, 'Set SCREENSHOTS to a folder to write the README screenshots.');

const PROFILE = `Name: Jane Doe
Email: jane@northwind.test
Phone: +47 912 34 567
Date of birth: 14/02/1991
Street address: Storgata 1
City: Oslo
Postcode: 0155
Country: Norway
Years of experience: 7`;

test('README screenshots', async ({ openForm, setSettings, serviceWorker }) => {
  mkdirSync(OUT!, { recursive: true });
  const shot = (name: string) => join(OUT!, name);

  const code = 'SHOTS-ABCDE-FGHJK-MNPQR';
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(import.meta.dirname, '..', '..', 'mcp', 'dist', 'formhand-mcp.js')],
    env: { ...process.env, FORMHAND_PAIRING_CODE: code, FORMHAND_PORTS: '17399', FORMHAND_HOME: mkdtempSync(join(tmpdir(), 'formhand-shots-')) } as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'claude-desktop', title: 'Claude Desktop', version: '1.0.0' });
  await client.connect(transport);

  try {
    await setSettings({ provider: 'anthropic', providers: { anthropic: { apiKey: 'sk-ant-xxxxxxxxxxxxxxxx' } }, bridge: { enabled: true, pairingCode: code, ports: [17399] } });
    await serviceWorker.evaluate((text) => {
      // @ts-expect-error chrome is the extension API inside the worker
      return chrome.storage.local.set({ profiles: [{ id: 'p1', name: 'Me', text }, { id: 'p2', name: 'Work', text: 'Company: Northwind\nJob title: Product designer' }], activeProfile: 'p1', draft: text });
    }, PROFILE);

    const { form, panel } = await openForm();
    await expect(panel.getByRole('button', { name: 'Claude Desktop connected' })).toBeVisible();
    await panel.getByRole('button', { name: 'Match fields' }).click();
    await expect(panel.getByText('fields ready')).toBeVisible();
    await panel.screenshot({ path: shot('panel-match.png') });

    await panel.emulateMedia({ colorScheme: 'dark' });
    await panel.screenshot({ path: shot('panel-match-dark.png') });
    await panel.emulateMedia({ colorScheme: 'light' });

    await panel.getByRole('button', { name: /^Fill \d+ fields$/ }).click();
    await expect(panel.getByText('Check them on the page')).toBeVisible();
    await form.bringToFront();
    await form.locator('main').screenshot({ path: shot('form-filled.png') });

    await panel.getByRole('tab', { name: 'Settings' }).click();
    await panel.screenshot({ path: shot('panel-settings.png'), fullPage: true });
    await panel.getByRole('tab', { name: 'Profiles' }).click();
    await panel.screenshot({ path: shot('panel-profiles.png') });
  } finally {
    await client.close();
  }
});
