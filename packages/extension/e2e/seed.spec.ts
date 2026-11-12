import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The four values of the entry shown under a heading ("Next entry"), in the order the panel lists them. */
async function entryIn(panel: Page, region: string) {
  const [username, password, firstName, lastName] = await panel.getByRole('region', { name: region }).locator('code').allTextContents();
  return { username, password, firstName, lastName };
}

const values = (form: Page) =>
  form.evaluate(() => Object.fromEntries([...document.querySelectorAll('input')].map((i) => [i.name, i.value])) as Record<string, string>);

test('detects the sign-up fields, then fills them all from one new entry', async ({ openForm }) => {
  const { form, panel } = await openForm('/signup.html');
  await panel.getByRole('tab', { name: 'Seed' }).click();
  const first = await entryIn(panel, 'Next entry');
  expect(first.username).toMatch(/^[a-z]+[a-z0-9]{4}$/);
  expect(first.password).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9]{15}$/);

  await panel.getByRole('button', { name: 'Detect', exact: true }).click();
  const detected = panel.getByRole('region', { name: 'Detected fields' });
  await expect(detected).toContainText('5 fields detected');
  // The page is untouched by Detect.
  expect(Object.values(await values(form)).join('')).toBe('');

  await panel.getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(panel.getByText(`Filled 5 fields as ${first.username}.`, { exact: false })).toBeVisible();
  expect(await values(form)).toEqual({
    first_name: first.firstName,
    last_name: first.lastName,
    email: '',
    username: first.username,
    password: first.password,
    password_confirm: first.password,
    card_number: '',
  });
  expect(await form.evaluate(() => (window as { __submitted?: boolean }).__submitted)).toBeUndefined();

  // The used entry is kept, and the next fill gets a different one.
  expect(await entryIn(panel, 'Recent entries')).toEqual(first);
  const second = await entryIn(panel, 'Next entry');
  expect(second.username).not.toBe(first.username);
  expect(second.password).not.toBe(first.password);
  await panel.getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(panel.getByText(`Filled 5 fields as ${second.username}.`, { exact: false })).toBeVisible();
  expect((await values(form)).password_confirm).toBe(second.password);

  await panel.getByRole('button', { name: 'Undo fill' }).click();
  expect((await values(form)).username).toBe(first.username);
});

test('the Fill tab still never sees or fills the password boxes', async ({ openForm }) => {
  const { form, panel } = await openForm('/signup.html');
  // Ordinary scan: first name, last name, email, username. No passwords, no card.
  await expect(panel.getByText('4 fields on 127.0.0.1', { exact: false })).toBeVisible();
  await panel.getByRole('tab', { name: 'Seed' }).click();
  await panel.getByRole('button', { name: 'Detect', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Detected fields' })).toContainText('5 fields detected');

  // After the seeder has looked, an ordinary fill still can't write a password.
  await panel.getByRole('tab', { name: 'Fill' }).click();
  await panel.locator('#info').fill('{"fills":[{"id":"f5","value":"guess"},{"id":"f4","value":"jane"}]}');
  await panel.getByRole('button', { name: 'Match fields' }).click();
  await panel.getByRole('button', { name: 'Fill 1 field' }).click();
  await expect(panel.getByText('Filled 1 field.', { exact: false })).toBeVisible();
  expect(await values(form)).toMatchObject({ username: 'jane', password: '' });
});
