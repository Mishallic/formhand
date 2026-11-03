import { expect, test } from './fixtures';

const PASTE = `First name: Jane
Last name: Doe
Email: jane@northwind.test
Phone: +47 912 34 567
Date of birth: 14/02/1991
Street address: Storgata 1
City: Oslo
Postcode: 0155
Country: Norway
Years of experience: 7
Newsletter: yes`;

test('reads the form, leaving out the password and the hidden trap field', async ({ openForm }) => {
  const { panel } = await openForm();
  await expect(panel.getByText('14 fields on 127.0.0.1', { exact: false })).toBeVisible();
});

test('fills the form from pasted text without AI, and undoes it', async ({ openForm }) => {
  const { form, panel } = await openForm();
  await panel.locator('#info').fill(PASTE);
  await panel.getByRole('button', { name: 'Match fields' }).click();
  await expect(panel.getByText('12 of 14 fields ready')).toBeVisible();

  // Edit one value and leave one out before filling.
  await panel.getByLabel('Value for City').fill('Bergen');
  await panel.getByLabel('Fill Send me news about open roles').uncheck();
  await panel.getByRole('button', { name: 'Fill 11 fields' }).click();
  await expect(panel.getByText('Filled 11 fields. Check them on the page, then submit.')).toBeVisible();

  expect(await form.inputValue('[name=first_name]')).toBe('Jane');
  expect(await form.inputValue('[name=last_name]')).toBe('Doe');
  expect(await form.inputValue('[name=email]')).toBe('jane@northwind.test');
  expect(await form.inputValue('[name=email_confirm]')).toBe('jane@northwind.test');
  expect(await form.inputValue('[name=dob]')).toBe('1991-02-14');
  expect(await form.inputValue('[name=city]')).toBe('Bergen');
  expect(await form.inputValue('[name=country]')).toBe('no');
  expect(await form.inputValue('[name=years]')).toBe('7');
  expect(await form.isChecked('[name=newsletter]')).toBe(false);
  // Never touched:
  expect(await form.inputValue('[name=password]')).toBe('');
  expect(await form.inputValue('[name=website_hp]')).toBe('');
  expect(await form.evaluate(() => (window as { __submitted?: boolean }).__submitted)).toBeUndefined();
  // Page scripts saw the change, and the field is outlined.
  const events = (await form.evaluate(() => (window as unknown as { __events: string[][] }).__events)) as string[][];
  expect(events).toContainEqual(['input', 'first_name']);
  expect(events).toContainEqual(['change', 'country']);
  expect(await form.getAttribute('[name=first_name]', 'data-formhand-filled')).toBe('');

  await panel.getByRole('button', { name: 'Undo fill' }).click();
  await expect(panel.getByText('Put back the previous values in 11 fields.')).toBeVisible();
  expect(await form.inputValue('[name=first_name]')).toBe('');
  expect(await form.inputValue('[name=country]')).toBe('');
  expect(await form.getAttribute('[name=first_name]', 'data-formhand-filled')).toBeNull();
});

test('fills the form with an AI provider', async ({ openForm, setSettings, server }) => {
  await setSettings({
    provider: 'custom',
    providers: { custom: { baseUrl: `${server.url}/v1`, model: 'fake-model' } },
    bridge: { enabled: false, pairingCode: '' },
  });
  const { form, panel } = await openForm();
  await panel.locator('#info').fill('Jane Doe, product designer in Oslo. jane@northwind.test');
  await panel.getByRole('button', { name: 'Fill with AI' }).click();
  await expect(panel.getByText('7 of 14 fields ready')).toBeVisible();
  await expect(panel.getByText('Add your phone number yourself.')).toBeVisible();
  await panel.getByRole('button', { name: 'Fill 7 fields' }).click();
  await expect(panel.getByText('Filled 7 fields.', { exact: false })).toBeVisible();

  expect(await form.isChecked('[value=designer]')).toBe(true);
  expect(await form.inputValue('[name=country]')).toBe('no');
  expect(await form.inputValue('[name=why]')).toMatch(/^I design calm tools/);

  const request = server.aiRequests.at(-1)!;
  expect(request.model).toBe('fake-model');
  expect(request.response_format).toMatchObject({ type: 'json_schema' });
  const prompt = request.messages.find((m) => m.role === 'user')!.content;
  expect(prompt).toContain('Jane Doe, product designer in Oslo.');
  expect(prompt).toContain('"label":"Position applied for","options":["Product designer","Frontend engineer","Product manager"]');
  expect(prompt).not.toMatch(/password|Leave this empty/i);
});

test('fills the form from a chat app reply', async ({ openForm }) => {
  const { form, panel } = await openForm();
  await panel.evaluate(() => {
    navigator.clipboard.writeText = async (text: string) => {
      (window as { __copied?: string }).__copied = text;
    };
  });
  await panel.locator('#info').fill('Name: Jane Doe');
  await panel.getByRole('button', { name: /Copy a prompt/ }).click();
  await expect(panel.getByText('Prompt copied.', { exact: false })).toBeVisible();
  const prompt = (await panel.evaluate(() => (window as { __copied?: string }).__copied)) ?? '';
  expect(prompt).toContain('Reply with only the JSON object');
  expect(prompt).toContain('Name: Jane Doe');

  await panel.locator('#reply').fill('Here you go:\n```json\n{"fills":[{"id":"f1","value":"Jane"},{"id":"f11","value":"Frontend engineer"}],"notes":""}\n```');
  await panel.getByRole('button', { name: 'Use this reply' }).click();
  await expect(panel.getByText('2 of 14 fields ready')).toBeVisible();
  await panel.getByRole('button', { name: 'Fill 2 fields' }).click();
  await expect(panel.getByText('Filled 2 fields.', { exact: false })).toBeVisible();
  expect(await form.inputValue('[name=first_name]')).toBe('Jane');
  expect(await form.isChecked('[value=engineer]')).toBe(true);
});

test('says when the page has no form', async ({ context, server, serviceWorker, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`${server.url}/missing`);
  const tabId = await serviceWorker.evaluate(async (url: string) => {
    // @ts-expect-error chrome is the extension API inside the worker
    return (await chrome.tabs.query({})).find((t: { url?: string }) => t.url === url)?.id;
  }, page.url());
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
  await expect(panel.getByText('No form fields on this page.', { exact: false })).toBeVisible();
});
