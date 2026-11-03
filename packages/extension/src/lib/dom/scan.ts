import type { FieldKind, FieldOption, FormField, FormSnapshot } from '@formhand/core';

export type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** What a field id points at: one control, or every radio button of a group. */
export type FieldTarget = { type: 'control'; el: Control } | { type: 'radio'; els: HTMLInputElement[] };

export interface ScanOptions {
  /**
   * Skip controls with no size or placed off-screen (honeypot fields that trip bot
   * detection). Needs real layout, so tests on jsdom turn it off.
   */
  checkLayout?: boolean;
}

const SKIP_TYPES = new Set(['hidden', 'password', 'submit', 'button', 'reset', 'image', 'file', 'range', 'color']);
const SENSITIVE_AUTOCOMPLETE = /\b(cc-\w+|current-password|new-password|one-time-code)\b/i;
const SENSITIVE_NAME = /card.?num|cc.?num|credit.?card|cvv|cvc|csc|security.?code|card.?code|one.?time|otp\b|passw/i;

const INPUT_KINDS: Record<string, FieldKind> = {
  text: 'text',
  search: 'search',
  email: 'email',
  tel: 'tel',
  url: 'url',
  number: 'number',
  date: 'date',
  'datetime-local': 'datetime-local',
  time: 'time',
  month: 'month',
  checkbox: 'checkbox',
  radio: 'radio',
};

function clean(text: string | null | undefined, max = 160): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim().replace(/\s*[:*]+$/, '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Text of a node, skipping form controls and option lists inside it. */
function textOf(node: Node): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
    else if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element;
      if (el.matches('input, select, textarea, button, option, script, style, [aria-hidden="true"]')) return;
      el.childNodes.forEach(walk);
    }
  };
  walk(node);
  return out;
}

function rootOf(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : el.ownerDocument;
}

function byIdRefs(el: Element, attr: string): string {
  const ids = el.getAttribute(attr)?.split(/\s+/).filter(Boolean) ?? [];
  const root = rootOf(el);
  return ids
    .map((id) => root.getElementById?.(id) ?? el.ownerDocument.getElementById(id))
    .filter((n): n is HTMLElement => !!n)
    .map(textOf)
    .join(' ');
}

/** Closest text before `el` that isn't part of a control: a "label" div, a table header cell. */
function nearbyText(el: Element): string {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 3; depth++) {
    let sib: Node | null = node.previousSibling;
    while (sib) {
      const isEl = sib.nodeType === Node.ELEMENT_NODE;
      if (isEl && (sib as Element).matches('input, select, textarea')) break;
      if (isEl && (sib as Element).querySelector('input, select, textarea')) break;
      const t = clean(isEl ? textOf(sib) : sib.textContent);
      if (t) return t;
      sib = sib.previousSibling;
    }
    // In a table, the cell to the left or the column header.
    if (node instanceof HTMLTableCellElement) {
      const prev = node.previousElementSibling;
      if (prev) {
        const t = clean(textOf(prev));
        if (t) return t;
      }
    }
    node = node.parentElement;
    if (node?.matches('form, fieldset, body')) break;
  }
  return '';
}

export function labelOf(el: Control): string {
  const labelledBy = clean(byIdRefs(el, 'aria-labelledby'));
  if (labelledBy) return labelledBy;
  const labels = el.labels ? Array.from(el.labels).map((l) => clean(textOf(l))).filter(Boolean) : [];
  if (labels.length) return labels.join(' ');
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const title = clean(el.getAttribute('title'));
  if (title) return title;
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    // "<input type=checkbox> I agree" with the text after the box.
    let sib = el.nextSibling;
    while (sib && !clean(sib.textContent)) sib = sib.nextSibling;
    if (sib && !(sib instanceof Element && sib.matches('input, select, textarea'))) return clean(textOf(sib));
  }
  return nearbyText(el);
}

/** The fieldset legend, labelled group, or heading this control sits under. */
function sectionOf(el: Element): string | undefined {
  const fieldset = el.closest('fieldset');
  const legend = fieldset?.querySelector(':scope > legend');
  if (legend) return clean(textOf(legend), 80) || undefined;
  const group = el.closest('[role="group"][aria-label], [role="region"][aria-label], [role="group"][aria-labelledby]');
  if (group) {
    const t = clean(group.getAttribute('aria-label') || byIdRefs(group, 'aria-labelledby'), 80);
    if (t) return t;
  }
  const scope = el.closest('form') ?? el.ownerDocument.body;
  if (!scope) return undefined;
  let last: Element | undefined;
  for (const h of scope.querySelectorAll('h2, h3, h4, h5, h6, [role="heading"]')) {
    if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) last = h;
    else break;
  }
  return last ? clean(textOf(last), 80) || undefined : undefined;
}

function isSensitive(el: Control): boolean {
  if (el instanceof HTMLInputElement && el.type === 'password') return true;
  const ac = el.getAttribute('autocomplete') ?? '';
  if (SENSITIVE_AUTOCOMPLETE.test(ac)) return true;
  return SENSITIVE_NAME.test(`${el.name} ${el.id}`);
}

function isVisible(el: Control, checkLayout: boolean): boolean {
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  for (let n: Element | null = el; n; n = n.parentElement ?? ((n.getRootNode() as ShadowRoot).host || null)) {
    const style = view.getComputedStyle(n);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  if (!checkLayout) return true;
  const rect = el.getBoundingClientRect();
  // Native radios and checkboxes are often hidden behind a styled label; keep those.
  const isToggle = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
  if (!isToggle && (rect.width < 2 || rect.height < 2)) return false;
  const doc = el.ownerDocument.documentElement;
  if (rect.right < -100 || rect.bottom < -100 || rect.left > doc.scrollWidth + 100) return false;
  return true;
}

function kindOf(el: Control): FieldKind | undefined {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLSelectElement) return el.multiple ? undefined : 'select';
  if (SKIP_TYPES.has(el.type)) return undefined;
  return INPUT_KINDS[el.type] ?? 'text';
}

/** Every input, textarea and select under `root`, including inside open shadow roots. */
export function collectControls(root: Document | ShadowRoot | Element): Control[] {
  const out: Control[] = [];
  const visit = (node: Document | ShadowRoot | Element) => {
    for (const el of node.querySelectorAll('*')) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) out.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  return out;
}

function selectOptions(select: HTMLSelectElement): FieldOption[] {
  return Array.from(select.options)
    .filter((o) => !o.disabled && o.value !== '' && !o.hidden)
    .map((o) => ({ value: o.value, label: clean(o.label || o.text, 120) || o.value }));
}

/** Radio buttons sharing a name in the same form form one group. */
function radioGroupKey(el: HTMLInputElement, index: number): string {
  if (!el.name) return `#${index}`;
  const form = el.form ? Array.from(el.ownerDocument.forms).indexOf(el.form) : -1;
  return `${form}:${el.name}`;
}

function radioGroupLabel(radios: HTMLInputElement[]): string {
  const first = radios[0]!;
  const group = first.closest('[role="radiogroup"]');
  if (group) {
    const t = clean(group.getAttribute('aria-label') || byIdRefs(group, 'aria-labelledby'));
    if (t) return t;
  }
  const legend = first.closest('fieldset')?.querySelector(':scope > legend');
  if (legend && radios.every((r) => legend.parentElement!.contains(r))) {
    const t = clean(textOf(legend));
    if (t) return t;
  }
  // The text before the smallest element holding all the radios.
  let common: Element | null = first.parentElement;
  while (common && !radios.every((r) => common!.contains(r))) common = common.parentElement;
  return common ? nearbyText(common) : '';
}

/**
 * Assigns field ids that stay stable across scans of the same page, so an id from one
 * get_form still points at the same element after the page adds more fields.
 */
export class FieldIds {
  private readonly ids = new WeakMap<Element, string>();
  private next = 1;
  idFor(el: Element): string {
    let id = this.ids.get(el);
    if (!id) {
      id = `f${this.next++}`;
      this.ids.set(el, id);
    }
    return id;
  }
}

export interface ScanResult {
  snapshot: FormSnapshot;
  targets: Map<string, FieldTarget>;
}

export function scanDocument(doc: Document, ids: FieldIds, options: ScanOptions = {}): ScanResult {
  const checkLayout = options.checkLayout ?? true;
  const fields: FormField[] = [];
  const targets = new Map<string, FieldTarget>();
  const radioGroups = new Map<string, HTMLInputElement[]>();

  const controls = collectControls(doc).filter(
    (el) => !el.disabled && !(el as HTMLInputElement).readOnly && !isSensitive(el) && kindOf(el) && isVisible(el, checkLayout),
  );

  controls.forEach((el, i) => {
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const key = radioGroupKey(el, i);
      const group = radioGroups.get(key);
      if (group) {
        group.push(el);
        return;
      }
      radioGroups.set(key, [el]);
      // Placeholder in page order; filled in below once the whole group is known.
      const id = ids.idFor(el);
      fields.push({ id, kind: 'radio', label: '' });
      targets.set(id, { type: 'radio', els: radioGroups.get(key)! });
      return;
    }
    const kind = kindOf(el)!;
    const id = ids.idFor(el);
    const field: FormField = { id, kind, label: labelOf(el) };
    if (el.name) field.name = el.name;
    if (el.id) field.htmlId = el.id;
    const placeholder = clean(el.getAttribute('placeholder'));
    if (placeholder) field.placeholder = placeholder;
    const autocomplete = el.getAttribute('autocomplete');
    if (autocomplete) field.autocomplete = autocomplete;
    const section = sectionOf(el);
    if (section && section !== field.label) field.section = section;
    if (el.required || el.getAttribute('aria-required') === 'true') field.required = true;
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.maxLength > 0) field.maxLength = el.maxLength;
    if (el instanceof HTMLSelectElement) {
      field.options = selectOptions(el);
      const selected = el.selectedOptions[0];
      if (selected && selected.value !== '') field.value = clean(selected.label || selected.text, 120);
    } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      field.value = String(el.checked);
    } else if (el.value) {
      field.value = el.value.length > 500 ? `${el.value.slice(0, 500)}…` : el.value;
    }
    fields.push(field);
    targets.set(id, { type: 'control', el });
  });

  for (const field of fields) {
    if (field.kind !== 'radio') continue;
    const target = targets.get(field.id) as Extract<FieldTarget, { type: 'radio' }>;
    const radios = target.els;
    field.label = radioGroupLabel(radios);
    field.options = radios.map((r) => ({ value: r.value, label: labelOf(r) || r.value }));
    if (radios[0]!.name) field.name = radios[0]!.name;
    const section = sectionOf(radios[0]!);
    if (section && section !== field.label) field.section = section;
    if (radios.some((r) => r.required)) field.required = true;
    const checked = radios.find((r) => r.checked);
    if (checked) field.value = labelOf(checked) || checked.value;
  }

  return { snapshot: { url: doc.location?.href ?? '', title: doc.title, fields }, targets };
}
