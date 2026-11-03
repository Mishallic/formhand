import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageController } from '../src/lib/dom/page';
import { HIGHLIGHT_ATTR } from '../src/lib/dom/highlight';

// Lets React's act() run synchronously in tests.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FORM = `
  <form>
    <label>Name <input name="name"></label>
    <label>Birthday <input type="date" name="dob"></label>
    <label>Age <input type="number" name="age"></label>
    <label>Bio <textarea name="bio" maxlength="10"></textarea></label>
    <label>Country <select name="country"><option value="">Pick</option><option value="no">Norway</option><option value="us">United States</option></select></label>
    <fieldset><legend>Plan</legend>
      <label><input type="radio" name="plan" value="free" checked> Free</label>
      <label><input type="radio" name="plan" value="pro"> Pro</label>
    </fieldset>
    <label><input type="checkbox" name="news"> Newsletter</label>
  </form>`;

function q<T extends Element>(selector: string): T {
  return document.querySelector(selector) as T;
}

function controller(html = FORM): PageController {
  document.body.innerHTML = html;
  const page = new PageController(document, { checkLayout: false });
  page.scan();
  return page;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('PageController.fill', () => {
  it('fills every kind of control and reports what it did', () => {
    const page = controller();
    const result = page.fill([
      { id: 'f1', value: 'Jane Doe' },
      { id: 'f2', value: '31/01/1990' },
      { id: 'f3', value: '34' },
      { id: 'f4', value: 'Designer from Oslo' },
      { id: 'f5', value: 'USA' },
      { id: 'f6', value: 'Pro' },
      { id: 'f7', value: 'yes' },
    ]);
    expect(result).toEqual({ filled: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'], skipped: [] });
    expect(q<HTMLInputElement>('[name=name]').value).toBe('Jane Doe');
    expect(q<HTMLInputElement>('[name=dob]').value).toBe('1990-01-31');
    expect(q<HTMLInputElement>('[name=age]').value).toBe('34');
    expect(q<HTMLTextAreaElement>('[name=bio]').value).toBe('Designer f');
    expect(q<HTMLSelectElement>('[name=country]').value).toBe('us');
    expect(q<HTMLInputElement>('[value=pro]').checked).toBe(true);
    expect(q<HTMLInputElement>('[value=free]').checked).toBe(false);
    expect(q<HTMLInputElement>('[name=news]').checked).toBe(true);
  });

  it('fires input and change events so page scripts notice', () => {
    const page = controller();
    const seen: string[] = [];
    const input = q<HTMLInputElement>('[name=name]');
    input.addEventListener('input', () => seen.push('input'));
    input.addEventListener('change', () => seen.push('change'));
    page.fill([{ id: 'f1', value: 'Jane' }]);
    expect(seen).toEqual(['input', 'change']);
  });

  it('skips values that cannot go in the field and says why', () => {
    const page = controller();
    const result = page.fill([
      { id: 'f2', value: 'next week' },
      { id: 'f3', value: 'thirty' },
      { id: 'f5', value: 'Mars' },
      { id: 'f7', value: 'maybe' },
      { id: 'f99', value: 'x' },
    ]);
    expect(result.filled).toEqual([]);
    expect(result.skipped).toEqual([
      { id: 'f2', reason: '"next week" is not a date' },
      { id: 'f3', reason: 'the page rejected "thirty" for this number field' },
      { id: 'f5', reason: 'no option "Mars" (options: Norway, United States)' },
      { id: 'f7', reason: '"maybe" is not true or false' },
      { id: 'f99', reason: 'no field with this id; read the form again' },
    ]);
  });

  it('highlights filled fields until the person edits them', () => {
    const page = controller();
    page.fill([{ id: 'f1', value: 'Jane' }]);
    const input = q<HTMLInputElement>('[name=name]');
    expect(input.hasAttribute(HIGHLIGHT_ATTR)).toBe(true);
    // Formhand's own events are untrusted and leave the outline alone.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.hasAttribute(HIGHLIGHT_ATTR)).toBe(true);
    expect(document.getElementById('formhand-highlight-style')).not.toBeNull();
  });

  it('finds fields that appeared after the last scan', () => {
    const page = controller('<input name="a">');
    document.body.insertAdjacentHTML('beforeend', '<label>Company <input name="company"></label>');
    expect(page.fill([{ id: 'f2', value: 'Acme' }]).filled).toEqual(['f2']);
    expect(q<HTMLInputElement>('[name=company]').value).toBe('Acme');
  });

  it('reports a field that was removed from the page', () => {
    const page = controller('<div id="step"><input name="a"></div>');
    q('#step').remove();
    expect(page.fill([{ id: 'f1', value: 'x' }]).skipped[0]!.reason).toMatch(/no longer on the page/);
  });

  it('keeps going when a page script throws', () => {
    const page = controller('<input name="a"><input name="b">');
    q('[name=a]').addEventListener('input', () => {
      throw new Error('boom');
    });
    const onError = vi.fn((e: ErrorEvent) => e.preventDefault());
    window.addEventListener('error', onError);
    const result = page.fill([
      { id: 'f1', value: 'x' },
      { id: 'f2', value: 'y' },
    ]);
    window.removeEventListener('error', onError);
    // Listener errors are reported, not thrown, so both fields fill.
    expect(result.filled).toEqual(['f1', 'f2']);
  });
});

describe('PageController.undo', () => {
  it('puts the previous values back, one fill at a time', () => {
    const page = controller();
    q<HTMLInputElement>('[name=name]').value = 'Old';
    page.fill([{ id: 'f1', value: 'First' }, { id: 'f6', value: 'Pro' }, { id: 'f7', value: 'true' }]);
    page.fill([{ id: 'f1', value: 'Second' }]);

    expect(page.undo()).toBe(1);
    expect(q<HTMLInputElement>('[name=name]').value).toBe('First');

    expect(page.undo()).toBe(3);
    expect(q<HTMLInputElement>('[name=name]').value).toBe('Old');
    expect(q<HTMLInputElement>('[value=free]').checked).toBe(true);
    expect(q<HTMLInputElement>('[name=news]').checked).toBe(false);
    expect(q('[name=name]').hasAttribute(HIGHLIGHT_ATTR)).toBe(false);

    expect(page.undo()).toBe(0);
  });
});

describe('React-controlled forms', () => {
  function SignupForm({ onState }: { onState: (s: { email: string; plan: string; agree: boolean; role: string }) => void }) {
    const [email, setEmail] = useState('');
    const [plan, setPlan] = useState('free');
    const [agree, setAgree] = useState(false);
    const [role, setRole] = useState('');
    onState({ email, plan, agree, role });
    return (
      <form>
        <label>
          Email <input name="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Role
          <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Pick one</option>
            <option value="dev">Developer</option>
            <option value="pm">Product manager</option>
          </select>
        </label>
        <label>
          <input type="radio" name="plan" value="free" checked={plan === 'free'} onChange={() => setPlan('free')} /> Free
        </label>
        <label>
          <input type="radio" name="plan" value="pro" checked={plan === 'pro'} onChange={() => setPlan('pro')} /> Pro
        </label>
        <label>
          <input type="checkbox" name="agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree
        </label>
      </form>
    );
  }

  it('updates React state, not just the DOM', () => {
    document.body.innerHTML = '<div id="app"></div>';
    let state = { email: '', plan: '', agree: false, role: '' };
    const root = createRoot(q('#app'));
    act(() => root.render(<SignupForm onState={(s) => (state = s)} />));

    const page = new PageController(document, { checkLayout: false });
    const fields = page.scan().fields;
    expect(fields.map((f) => f.label)).toEqual(['Email', 'Role', '', 'I agree']);

    act(() => {
      page.fill([
        { id: fields[0]!.id, value: 'jane@x.io' },
        { id: fields[1]!.id, value: 'Product manager' },
        { id: fields[2]!.id, value: 'Pro' },
        { id: fields[3]!.id, value: 'true' },
      ]);
    });
    expect(state).toEqual({ email: 'jane@x.io', plan: 'pro', agree: true, role: 'pm' });
    act(() => root.unmount());
  });
});
