import { expect, test, type Tab } from './fixtures';

/** The four values of the entry shown under a heading, in the order the panel lists them. */
async function entryIn(panel: Tab, region: string) {
  const [username, password, firstName, lastName] = await panel.run<string[]>(
    'return [...document.querySelector(`main:not([hidden]) section[aria-label="${arguments[0]}"]`).querySelectorAll("code")].slice(0, 4).map((c) => c.textContent)',
    region,
  );
  return { username, password, firstName, lastName };
}

const values = (form: Tab) => form.run<Record<string, string>>('return Object.fromEntries([...document.querySelectorAll("input")].map((i) => [i.name, i.value]))');

test('detects the sign-up fields, then fills them all from one new entry', async ({ openForm }) => {
  const { form, panel } = await openForm('/signup.html');
  await panel.click('Seed');
  const first = await entryIn(panel, 'Next entry');
  expect(first.password).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9]{15}$/);

  await panel.click('Detect');
  await panel.waitForText('5 fields detected');
  expect(Object.values(await values(form)).join('')).toBe('');

  // The tab is also called Fill, so name the Seed view's own button.
  await panel.clickOn('main:not([hidden]) button.primary');
  await panel.waitForText(`Filled 5 fields as ${first.username}.`);
  expect(await values(form)).toEqual({
    first_name: first.firstName,
    last_name: first.lastName,
    email: '',
    username: first.username,
    password: first.password,
    password_confirm: first.password,
    card_number: '',
  });

  // The used entry is kept, and the next fill gets a different one.
  expect(await entryIn(panel, 'Recent entries')).toEqual(first);
  const second = await entryIn(panel, 'Next entry');
  expect(second.username).not.toBe(first.username);
  expect(second.password).not.toBe(first.password);
});

test('the Fill tab still never sees the password boxes', async ({ openForm }) => {
  const { panel } = await openForm('/signup.html');
  await panel.waitForText('4 fields on 127.0.0.1');
});
