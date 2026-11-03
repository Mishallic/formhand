/** The Formhand mark: a ticked box on the first line of a form. */
export function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#2f44d0" />
      <rect x="4.5" y="5.5" width="6" height="6" rx="1" fill="none" stroke="#fff" strokeWidth="1.6" />
      <path d="M5.9 8.6l1.4 1.4 2.4-2.8" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 10.5h7M4.5 15.5h15M4.5 19h10" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" {...stroke}>
      <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2" />
    </svg>
  );
}

export function SparkIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" {...stroke}>
      <path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" {...stroke}>
      <rect x="6.5" y="6.5" width="10" height="10" rx="1.5" />
      <path d="M13.5 6.5V4.8a1.3 1.3 0 0 0-1.3-1.3H4.8a1.3 1.3 0 0 0-1.3 1.3v7.4a1.3 1.3 0 0 0 1.3 1.3h1.7" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" {...stroke}>
      <path d="M7.5 5.5L4 9l3.5 3.5M4.5 9h7a4.5 4.5 0 0 1 0 9H10" />
    </svg>
  );
}
