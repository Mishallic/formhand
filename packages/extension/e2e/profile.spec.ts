import { PASTE } from './data';
import { expect, test } from './fixtures';
import { RESUME_LINES, resumePdfFile } from './resume-pdf';

const AI = (url: string) => ({
  provider: 'custom',
  providers: { custom: { baseUrl: `${url}/v1`, model: 'fake-model' } },
  bridge: { enabled: false, pairingCode: '' },
});

test('makes a profile from a PDF resume, then fills the form from it', async ({ openForm, setSettings, server }) => {
  await setSettings(AI(server.url));
  const { form, panel } = await openForm();
  await panel.locator('main:not([hidden]) input[type=file]').setInputFiles(resumePdfFile());
  await expect(panel.getByText('Made the profile “Jane Doe” from resume.pdf.', { exact: false })).toBeVisible();

  // pdf.js read the text in the browser, and the AI got it as data.
  const request = server.aiRequests.at(-1)!;
  expect(request.messages[0]!.content).toMatch(/^You read a person's resume/);
  expect(request.messages[1]!.content).toBe(`Resume:\n<<<\n${RESUME_LINES.join('\n')}\n>>>`);
  const info = await panel.locator('#info').inputValue();
  expect(info).toMatch(/^First name: Jane\nLast name: Doe\nEmail: jane@northwind\.test\n/);
  expect(info).toContain(`Resume:\n${RESUME_LINES[0]}`);

  // The picked-out details work without AI.
  await panel.getByRole('button', { name: 'Match fields' }).click();
  await panel.getByRole('button', { name: /^Fill \d+ fields$/ }).click();
  await expect(panel.getByText('Check them on the page, then submit.', { exact: false })).toBeVisible();
  expect(await form.inputValue('[name=first_name]')).toBe('Jane');
  expect(await form.inputValue('[name=email]')).toBe('jane@northwind.test');
  expect(await form.inputValue('[name=city]')).toBe('Oslo');
  expect(await form.inputValue('[name=country]')).toBe('no');

  await panel.getByRole('tab', { name: 'Profiles' }).click();
  await expect(panel.locator('.profile-name', { hasText: 'Jane Doe' })).toContainText('In use');
});

test('remembers an answer typed into the preview and fills it on the next form', async ({ openForm }) => {
  const { form, panel } = await openForm();
  await panel.locator('#info').fill(PASTE);
  await panel.getByRole('button', { name: 'Match fields' }).click();
  await panel.getByLabel('Value for Years of experience').fill('9');
  await panel.getByRole('button', { name: 'Fill 12 fields' }).click();
  await expect(panel.getByText('Formhand will remember 1 answer for later forms.', { exact: false })).toBeVisible();

  // A fresh copy of the form, and nothing in the info box: the answer comes from memory.
  await form.reload();
  await expect(panel.getByText('14 fields on 127.0.0.1', { exact: false })).toBeVisible();
  await panel.locator('#info').fill('');
  await panel.getByRole('button', { name: 'Match fields' }).click();
  await expect(panel.getByText('1 of 14 fields ready')).toBeVisible();
  await expect(panel.locator('.entry .source')).toHaveText('remembered');
  await panel.getByRole('button', { name: 'Fill 1 field' }).click();
  await expect(panel.getByText('Filled 1 field.', { exact: false })).toBeVisible();
  expect(await form.inputValue('[name=years]')).toBe('9');

  await panel.getByRole('tab', { name: 'Profiles' }).click();
  const remembered = panel.getByRole('region', { name: 'Remembered answers' });
  await expect(remembered).toContainText('Years of experience');
  await remembered.getByRole('button', { name: 'Forget Years of experience' }).click();
  await expect(remembered).toContainText('Nothing remembered yet.');
});

test('undoing a fill forgets the answers it added', async ({ openForm }) => {
  const { panel } = await openForm();
  await panel.locator('#info').fill(PASTE);
  await panel.getByRole('button', { name: 'Match fields' }).click();
  await panel.getByLabel('Value for City').fill('Bergen');
  await panel.getByRole('button', { name: 'Fill 12 fields' }).click();
  await expect(panel.getByText('Formhand will remember 1 answer', { exact: false })).toBeVisible();
  await panel.getByRole('tab', { name: 'Profiles' }).click();
  await expect(panel.getByRole('region', { name: 'Remembered answers' })).toContainText('Bergen');

  await panel.getByRole('tab', { name: 'Fill' }).click();
  await panel.getByRole('button', { name: 'Undo fill' }).click();
  await panel.getByRole('tab', { name: 'Profiles' }).click();
  await expect(panel.getByRole('region', { name: 'Remembered answers' })).toContainText('Nothing remembered yet.');
});
