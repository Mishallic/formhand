/** The kinds of control Formhand can read and fill. */
export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'datetime-local'
  | 'time'
  | 'month'
  | 'search'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio';

export interface FieldOption {
  value: string;
  label: string;
}

/**
 * One fillable control on the page, described the way a person (or a model) would
 * need to see it. `id` is assigned by Formhand per scan ("f1", "f2", ...) and is the
 * only handle used to fill the field back.
 */
export interface FormField {
  id: string;
  kind: FieldKind;
  label: string;
  name?: string;
  htmlId?: string;
  placeholder?: string;
  autocomplete?: string;
  /** Nearest fieldset legend or heading, to tell "Billing > City" from "Shipping > City". */
  section?: string;
  required?: boolean;
  /** Choices for selects and radio groups. */
  options?: FieldOption[];
  /** Current value; "true"/"false" for checkboxes. */
  value?: string;
  maxLength?: number;
}

export interface FormSnapshot {
  url: string;
  title: string;
  fields: FormField[];
}

/** A value to put in a field. All values are strings; checkboxes take "true"/"false". */
export interface Fill {
  id: string;
  value: string;
}

export interface FillResult {
  filled: string[];
  skipped: { id: string; reason: string }[];
}

/** A labelled piece of the user's information, e.g. { key: "Email", value: "jane@x.com" }. */
export interface Pair {
  key: string;
  value: string;
  /** Set on pairs Formhand made itself, such as a first name split from a full name. */
  derived?: boolean;
}

/** A proposed value for one field, shown to the user before anything is filled. */
export interface Proposal {
  fieldId: string;
  value: string;
  /** Where the value came from: the pasted key, or "AI". */
  source: string;
  /** 0..1; 1 for AI and exact matches. */
  confidence: number;
}
