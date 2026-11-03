import { beforeEach, describe, expect, it } from 'vitest';
import { FieldIds, scanDocument } from '../src/lib/dom/scan';

function scan(html: string) {
  document.body.innerHTML = html;
  return scanDocument(document, new FieldIds(), { checkLayout: false });
}

function fields(html: string) {
  return scan(html).snapshot.fields;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = 'Test form';
});

describe('scanDocument: labels', () => {
  it('reads <label for>, wrapping labels, aria-label and aria-labelledby', () => {
    const f = fields(`
      <label for="a">First name *</label><input id="a" name="first" required>
      <label>Email: <input type="email" name="email"></label>
      <input aria-label="Phone number" type="tel">
      <span id="z">Postal code</span><input aria-labelledby="z">
    `);
    expect(f.map((x) => [x.id, x.kind, x.label])).toEqual([
      ['f1', 'text', 'First name'],
      ['f2', 'email', 'Email'],
      ['f3', 'tel', 'Phone number'],
      ['f4', 'text', 'Postal code'],
    ]);
    expect(f[0]).toMatchObject({ name: 'first', htmlId: 'a', required: true });
  });

  it('falls back to the text placed before the field, and to table cells', () => {
    const f = fields(`
      <div><div class="lbl">Company</div><div><input name="c"></div></div>
      <table><tr><td>City</td><td><input name="city"></td></tr></table>
    `);
    expect(f.map((x) => x.label)).toEqual(['Company', 'City']);
  });

  it('keeps the placeholder and autocomplete hints', () => {
    const [f] = fields('<input placeholder="you@example.com" autocomplete="email" maxlength="80">');
    expect(f).toMatchObject({ label: '', placeholder: 'you@example.com', autocomplete: 'email', maxLength: 80 });
  });

  it('records the fieldset legend or heading as the section', () => {
    const f = fields(`
      <form>
        <h3>Shipping</h3><label>City <input name="s_city"></label>
        <fieldset><legend>Billing</legend><label>City <input name="b_city"></label></fieldset>
      </form>
    `);
    expect(f.map((x) => x.section)).toEqual(['Shipping', 'Billing']);
  });
});

describe('scanDocument: controls', () => {
  it('lists select options without the "Choose..." placeholder and reports the selection', () => {
    const [f] = fields(`
      <label>Country <select name="country">
        <option value="">Choose…</option><option value="no">Norway</option><option value="se" selected>Sweden</option>
        <option value="xx" disabled>Nowhere</option>
      </select></label>
    `);
    expect(f).toMatchObject({
      kind: 'select',
      label: 'Country',
      options: [
        { value: 'no', label: 'Norway' },
        { value: 'se', label: 'Sweden' },
      ],
      value: 'Sweden',
    });
  });

  it('turns a radio group into one field with its options', () => {
    const f = fields(`
      <fieldset><legend>Preferred contact</legend>
        <label><input type="radio" name="pc" value="e"> Email</label>
        <label><input type="radio" name="pc" value="p" checked> Phone</label>
      </fieldset>
      <label><input type="checkbox" name="tos"> I agree to the terms</label>
    `);
    expect(f).toEqual([
      {
        id: 'f1',
        kind: 'radio',
        label: 'Preferred contact',
        name: 'pc',
        options: [
          { value: 'e', label: 'Email' },
          { value: 'p', label: 'Phone' },
        ],
        value: 'Phone',
      },
      { id: 'f2', kind: 'checkbox', label: 'I agree to the terms', name: 'tos', value: 'false' },
    ]);
  });

  it('never lists passwords, card numbers, CVCs or one-time codes', () => {
    const f = fields(`
      <input type="password" name="pw">
      <input name="cardnumber" autocomplete="cc-number">
      <input name="cvc">
      <input name="code" autocomplete="one-time-code">
      <input name="otp">
      <input name="ok">
    `);
    expect(f.map((x) => x.name)).toEqual(['ok']);
  });

  it('skips hidden, disabled, read-only, button and file inputs', () => {
    const f = fields(`
      <input type="hidden" name="h"><input name="d" disabled><input name="r" readonly>
      <div style="display:none"><input name="nested"></div><input name="v" style="visibility:hidden">
      <div hidden><input name="hidden-attr"></div>
      <input type="submit"><input type="file" name="cv"><select multiple name="m"><option>a</option></select>
      <input name="shown">
    `);
    expect(f.map((x) => x.name)).toEqual(['shown']);
  });

  it('finds fields inside open shadow roots', () => {
    document.body.innerHTML = '<my-field></my-field>';
    const host = document.querySelector('my-field')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<label>Nickname <input name="nick"></label>';
    const { snapshot } = scanDocument(document, new FieldIds(), { checkLayout: false });
    expect(snapshot.fields.map((x) => x.label)).toEqual(['Nickname']);
  });

  it('keeps ids stable when the page adds fields', () => {
    const ids = new FieldIds();
    document.body.innerHTML = '<input name="a"><input name="b">';
    const first = scanDocument(document, ids, { checkLayout: false }).snapshot.fields;
    document.body.insertAdjacentHTML('afterbegin', '<input name="new">');
    const second = scanDocument(document, ids, { checkLayout: false }).snapshot.fields;
    expect(first.map((f) => `${f.id}=${f.name}`)).toEqual(['f1=a', 'f2=b']);
    expect(second.map((f) => `${f.id}=${f.name}`)).toEqual(['f3=new', 'f1=a', 'f2=b']);
  });

  it('includes the page url and title', () => {
    const { snapshot } = scan('<input name="x">');
    expect(snapshot.title).toBe('Test form');
    expect(snapshot.url).toMatch(/^http/);
  });
});
