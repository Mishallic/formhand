import { Key } from 'selenium-webdriver';
import { PASTE, REACT_FILLED, REACT_PASTE } from '../data';
import { expect, test } from './fixtures';

// The same journeys as e2e/fill.spec.ts, in a real Firefox. Firefox runs content scripts
// behind "Xray" wrappers and the extension as a Manifest V2 background page, so fills
// reaching page scripts (and React) here is not implied by Chromium passing.

test('reads the form, leaving out the password and the hidden trap field', async ({ openForm }) => {
  const { panel } = await openForm();
  await panel.waitForText('14 fields on 127.0.0.1');
});

test('fills the form from pasted text without AI, and undoes it', async ({ openForm }) => {
  const { form, panel } = await openForm();
  await panel.type('#info', PASTE);
  await panel.click('Match fields');
  await panel.waitForText('12 of 14 fields ready');

  await panel.type('[aria-label="Value for City"]', 'Bergen');
  await panel.clickOn('[aria-label="Fill Send me news about open roles"]');
  await panel.click('Fill 11 fields');
  await panel.waitForText('Filled 11 fields. Check them on the page, then submit.');

  expect(await form.value('[name=first_name]')).toBe('Jane');
  expect(await form.value('[name=last_name]')).toBe('Doe');
  expect(await form.value('[name=email]')).toBe('jane@northwind.test');
  expect(await form.value('[name=email_confirm]')).toBe('jane@northwind.test');
  expect(await form.value('[name=dob]')).toBe('1991-02-14');
  expect(await form.value('[name=city]')).toBe('Bergen');
  expect(await form.value('[name=country]')).toBe('no');
  expect(await form.value('[name=years]')).toBe('7');
  expect(await form.checked('[name=newsletter]')).toBe(false);
  // Never touched:
  expect(await form.value('[name=password]')).toBe('');
  expect(await form.value('[name=website_hp]')).toBe('');
  expect(await form.run('return window.__submitted')).toBeNull();
  // Page scripts saw the change, and the field is outlined.
  const events = await form.run<string[][]>('return window.__events');
  expect(events).toContainEqual(['input', 'first_name']);
  expect(events).toContainEqual(['change', 'country']);
  expect(await form.attribute('[name=first_name]', 'data-formhand-filled')).toBe('');

  await panel.click('Undo fill');
  await panel.waitForText('Put back the previous values in 11 fields.');
  expect(await form.value('[name=first_name]')).toBe('');
  expect(await form.value('[name=country]')).toBe('');
  expect(await form.attribute('[name=first_name]', 'data-formhand-filled')).toBeNull();
});

test('fills a React form so React sees the new values', async ({ openForm }) => {
  const { form, panel } = await openForm('/react.html');
  await panel.waitForText('6 fields on 127.0.0.1');
  await panel.type('#info', REACT_PASTE);
  await panel.click('Match fields');
  await panel.waitForText('6 of 6 fields ready');
  await panel.click('Fill 6 fields');
  await panel.waitForText('Filled 6 fields.');
  expect(await form.run('return window.__state')).toEqual(REACT_FILLED);
});

test('fills the form with an AI provider', async ({ openForm, setSettings, server }) => {
  await setSettings({
    provider: 'custom',
    providers: { custom: { baseUrl: `${server.url}/v1`, model: 'fake-model' } },
    bridge: { enabled: false, pairingCode: '' },
  });
  const { form, panel } = await openForm();
  await panel.type('#info', 'Jane Doe, product designer in Oslo. jane@northwind.test');
  await panel.click('Fill with AI');
  await panel.waitForText('7 of 14 fields ready');
  await panel.waitForText('Add your phone number yourself.');
  await panel.click('Fill 7 fields');
  await panel.waitForText('Filled 7 fields.');

  expect(await form.checked('[value=designer]')).toBe(true);
  expect(await form.value('[name=country]')).toBe('no');
  expect(await form.value('[name=why]')).toMatch(/^I design calm tools/);
  const request = server.aiRequests.at(-1)!;
  expect(request.model).toBe('fake-model');
  expect(request.response_format).toMatchObject({ type: 'json_schema' });
});

test('fills the form from a chat app reply, through the real clipboard', async ({ openForm }) => {
  const { form, panel } = await openForm();
  await panel.type('#info', 'Name: Jane Doe');
  await panel.click(/Copy a prompt/);
  await panel.waitForText('Prompt copied.');
  // Paste what Firefox put on the clipboard, to check the prompt really got there.
  const reply = await panel.find('#reply');
  await reply.sendKeys(Key.chord(Key.CONTROL, 'v'));
  const prompt = await panel.value('#reply');
  expect(prompt).toContain('Reply with only the JSON object');
  expect(prompt).toContain('Name: Jane Doe');

  await panel.type('#reply', 'Here you go:\n```json\n{"fills":[{"id":"f1","value":"Jane"},{"id":"f11","value":"Frontend engineer"}],"notes":""}\n```');
  await panel.click('Use this reply');
  await panel.waitForText('2 of 14 fields ready');
  await panel.click('Fill 2 fields');
  await panel.waitForText('Filled 2 fields.');
  expect(await form.value('[name=first_name]')).toBe('Jane');
  expect(await form.checked('[value=engineer]')).toBe(true);
});

test('a content script injected again takes over from the old one', async ({ openForm }) => {
  const { form, panel, tabId } = await openForm();
  // What the background does for tabs that were open before an update.
  const reply = await panel.runAsync(
    `browser.scripting.executeScript({ target: { tabId: arguments[0] }, files: ['/content-scripts/content.js'] })
      .then(() => browser.tabs.sendMessage(arguments[0], { type: 'formhand:fill', fills: [{ id: 'f1', value: 'Jane' }] }, { frameId: 0 }))
      .then(done, (e) => done(String(e)))`,
    tabId,
  );
  expect(reply).toEqual({ ok: true, data: { filled: ['f1'], skipped: [] } });
  const events = await form.run<string[][]>('return window.__events');
  // One copy answered: a second would have filled again and fired a second input event.
  expect(events.filter(([type, name]) => type === 'input' && name === 'first_name')).toHaveLength(1);
});

test('says when the page has no form', async ({ openForm }) => {
  const { panel } = await openForm('/missing');
  await panel.waitForText('No form fields on this page.');
});
