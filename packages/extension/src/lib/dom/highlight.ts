const ATTR = 'data-formhand-filled';
const STYLE_ID = 'formhand-highlight-style';

const CSS = `[${ATTR}] {
  outline: 2px solid #6d5ef5 !important;
  outline-offset: 1px !important;
  background-color: rgba(109, 94, 245, 0.08) !important;
  transition: outline-color 0.3s ease;
}`;

function ensureStyle(root: Document | ShadowRoot): void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (root instanceof Document ? doc.getElementById(STYLE_ID) : root.querySelector(`#${STYLE_ID}`)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (root instanceof Document ? doc.head ?? doc.documentElement : root).appendChild(style);
}

/** Outlines fields Formhand filled. The outline goes away when the person edits the field. */
export function highlight(elements: Element[]): void {
  for (const el of elements) {
    const root = el.getRootNode();
    ensureStyle(root instanceof ShadowRoot ? root : el.ownerDocument);
    el.setAttribute(ATTR, '');
    const onUserEdit = (event: Event) => {
      if (!event.isTrusted) return;
      el.removeAttribute(ATTR);
      el.removeEventListener('input', onUserEdit);
    };
    el.addEventListener('input', onUserEdit);
  }
}

export function unhighlight(elements: Element[]): void {
  for (const el of elements) el.removeAttribute(ATTR);
}

export function clearHighlights(doc: Document): void {
  doc.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
}

export const HIGHLIGHT_ATTR = ATTR;
