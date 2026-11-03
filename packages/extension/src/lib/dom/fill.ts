import { normalizeDate, parseBoolean, resolveOption, type FieldOption, type FormField } from '@formhand/core';
import type { Control, FieldTarget } from './scan';

/** What a control held before a fill, to put it back on undo. */
export type Previous = { el: Control; value: string } | { el: HTMLInputElement; checked: boolean };

export type FillOutcome = { ok: true; previous: Previous[]; touched: Element[] } | { ok: false; reason: string };

/**
 * Sets `value` through the prototype's setter rather than `el.value = ...`. React (and
 * other libraries) wrap the element's own value property to track changes; going
 * around the wrapper and then firing `input` is what makes them see the new value.
 */
function setNativeValue(el: Control, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function setNativeChecked(el: HTMLInputElement, checked: boolean): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
  if (setter) setter.call(el, checked);
  else el.checked = checked;
}

function fire(el: Element, type: 'input' | 'change'): void {
  const event =
    type === 'input' && typeof InputEvent === 'function'
      ? new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText' })
      : new Event(type, { bubbles: true, composed: true });
  el.dispatchEvent(event);
}

/** Focus, set, notify, blur: the sequence of a person typing, so validation runs. */
function typeInto(el: Control, value: string): void {
  el.focus({ preventScroll: true });
  setNativeValue(el, value);
  fire(el, 'input');
  fire(el, 'change');
  el.blur();
}

/** Ticks or unticks with a real click so page scripts react; sets the state directly if a script blocks it. */
function toggle(el: HTMLInputElement, checked: boolean): void {
  if (el.checked === checked) return;
  el.click();
  if (el.checked !== checked) {
    setNativeChecked(el, checked);
    fire(el, 'input');
    fire(el, 'change');
  }
}

function optionLabels(options: FieldOption[] | undefined): string {
  const labels = (options ?? []).map((o) => o.label);
  const shown = labels.slice(0, 8).join(', ');
  return labels.length > 8 ? `${shown}, …` : shown;
}

export function fillTarget(target: FieldTarget, field: FormField, value: string, locale?: string): FillOutcome {
  if (target.type === 'radio') {
    const option = field.options && resolveOption(value, field.options);
    if (!option) return { ok: false, reason: `no option "${value}" (options: ${optionLabels(field.options)})` };
    const radio = target.els.find((r) => r.value === option.value) ?? target.els[field.options!.indexOf(option)];
    if (!radio?.isConnected) return { ok: false, reason: 'the field is no longer on the page; read the form again' };
    const previous: Previous[] = target.els.map((r) => ({ el: r, checked: r.checked }));
    toggle(radio, true);
    return { ok: true, previous, touched: [radio] };
  }

  const { el } = target;
  if (!el.isConnected) return { ok: false, reason: 'the field is no longer on the page; read the form again' };
  if (el.disabled) return { ok: false, reason: 'the field is disabled' };

  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    const checked = parseBoolean(value);
    if (checked === undefined) return { ok: false, reason: `"${value}" is not true or false` };
    const previous: Previous[] = [{ el, checked: el.checked }];
    toggle(el, checked);
    return { ok: true, previous, touched: [el] };
  }

  if (el instanceof HTMLSelectElement) {
    const option = field.options && resolveOption(value, field.options);
    if (!option) return { ok: false, reason: `no option "${value}" (options: ${optionLabels(field.options)})` };
    const previous: Previous[] = [{ el, value: el.value }];
    el.focus({ preventScroll: true });
    setNativeValue(el, option.value);
    fire(el, 'input');
    fire(el, 'change');
    el.blur();
    return { ok: true, previous, touched: [el] };
  }

  let text = value;
  if (field.kind === 'date') {
    const iso = normalizeDate(value, locale);
    if (!iso) return { ok: false, reason: `"${value}" is not a date` };
    text = iso;
  }
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.maxLength > 0) text = text.slice(0, el.maxLength);
  const before = el.value;
  typeInto(el, text);
  // Browsers empty typed inputs (date, number) when the value is malformed.
  if (text && !el.value) {
    setNativeValue(el, before);
    return { ok: false, reason: `the page rejected "${value}" for this ${field.kind} field` };
  }
  return { ok: true, previous: [{ el, value: before }], touched: [el] };
}

export function restore(previous: Previous[]): void {
  for (const p of previous) {
    if ('checked' in p) {
      if (p.el.checked !== p.checked) {
        setNativeChecked(p.el, p.checked);
        fire(p.el, 'input');
        fire(p.el, 'change');
      }
    } else if (p.el.value !== p.value) {
      typeInto(p.el, p.value);
    }
  }
}
