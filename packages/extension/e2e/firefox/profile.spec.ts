import { PASTE } from '../data';
import { RESUME_LINES, resumePdfFile } from '../resume-pdf';
import { expect, test } from './fixtures';

const AI = (url: string) => ({
  provider: 'custom',
  providers: { custom: { baseUrl: `${url}/v1`, model: 'fake-model' } },
  bridge: { enabled: false, pairingCode: '' },
});

test('makes a profile from a PDF resume, then fills the form from it', async ({ openForm, setSettings, server }) => {
  await setSettings(AI(server.url));
  const { form, panel } = await openForm();
  // pdf.js runs its worker inside the extension; this is the Firefox check that it can.
  await (await panel.find('main:not([hidden]) input[type=file]')).sendKeys(resumePdfFile());
  await panel.waitForText('Made the profile “Jane Doe” from resume.pdf.');
  expect(server.aiRequests.at(-1)!.messages[1]!.content).toBe(`Resume:\n<<<\n${RESUME_LINES.join('\n')}\n>>>`);
  expect(await panel.value('#info')).toMatch(/^First name: Jane\nLast name: Doe\n/);

  await panel.click('Match fields');
  await panel.click(/^Fill \d+ fields$/);
  await panel.waitForText('Check them on the page, then submit.');
  expect(await form.value('[name=first_name]')).toBe('Jane');
  expect(await form.value('[name=city]')).toBe('Oslo');
  expect(await form.value('[name=country]')).toBe('no');
});

test('remembers an answer typed into the preview and fills it on the next form', async ({ openForm }) => {
  const { form, panel } = await openForm();
  await panel.type('#info', PASTE);
  await panel.click('Match fields');
  await panel.type('[aria-label="Value for Years of experience"]', '9');
  await panel.click('Fill 12 fields');
  await panel.waitForText('Formhand will remember 1 answer for later forms.');

  await form.run('location.reload()');
  await panel.waitForText('14 fields on 127.0.0.1');
  await panel.type('#info', ' ');
  await panel.click('Match fields');
  await panel.waitForText('1 of 14 fields ready');
  expect(await panel.text()).toContain('remembered');
  await panel.click('Fill 1 field');
  await panel.waitForText('Filled 1 field.');
  expect(await form.value('[name=years]')).toBe('9');
});

test('undoing a fill forgets the answers it added', async ({ openForm }) => {
  const { panel } = await openForm();
  await panel.type('#info', PASTE);
  await panel.click('Match fields');
  await panel.type('[aria-label="Value for City"]', 'Bergen');
  await panel.click('Fill 12 fields');
  await panel.waitForText('Formhand will remember 1 answer');
  await panel.click('Profiles');
  await panel.waitForText('Bergen on 127.0.0.1');

  await panel.click('Fill');
  await panel.click('Undo fill');
  await panel.click('Profiles');
  await panel.waitForText('Nothing remembered yet.');
});
