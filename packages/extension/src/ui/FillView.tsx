import { useEffect, useMemo, useRef, useState } from 'react';
import {
  answersToRemember,
  buildChatPrompt,
  fillsToProposals,
  matchPairs,
  memoryPairs,
  parseFillsReply,
  parsePasted,
  questionKey,
  rememberAnswers,
  sameMemory,
  type FormField,
  type FormSnapshot,
  type Proposal,
  type RememberedAnswer,
} from '@formhand/core';
import { askAi, AiError, PROVIDERS } from '../lib/ai';
import { loadDraft, providerProblem, saveDraft, saveMemory, type Profile, type Settings } from '../lib/settings';
import { sendToTab } from '../lib/tabs';
import { CopyIcon, SparkIcon, UndoIcon } from './icons';
import { ResumeButton } from './ResumeButton';

interface Row {
  fieldId: string;
  value: string;
  checked: boolean;
  source: string;
  confidence: number;
  /** Where the value came from: the info box, remembered answers, or the AI (or a chat app's reply). */
  origin: 'info' | 'memory' | 'ai';
  /** Set once the person changes the value in the preview. */
  edited?: boolean;
}

function host(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

type Message = { kind: 'error' | 'success' | 'info'; text: string; list?: string[]; action?: { label: string; run: () => void } };

function baseName(field: FormField): string {
  return field.label || field.placeholder || field.name || 'Unlabelled field';
}

/** Names labels used by more than one field, which then get their section added ("City (Billing)"). */
function ambiguousNames(fields: FormField[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const f of fields) {
    const name = baseName(f);
    if (seen.has(name)) twice.add(name);
    seen.add(name);
  }
  return twice;
}

export function fieldName(field: FormField, ambiguous: Set<string>): string {
  const base = baseName(field);
  return field.section && ambiguous.has(base) ? `${base} (${field.section})` : base;
}

function ValueInput({ field, name, value, onChange }: { field: FormField; name: string; value: string; onChange: (v: string) => void }) {
  const label = `Value for ${name}`;
  if (field.kind === 'select' || field.kind === 'radio') {
    const options = field.options ?? [];
    return (
      <select className="entry-value" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {!options.some((o) => o.label === value) && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.value + o.label} value={o.label}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'checkbox') {
    return (
      <select className="entry-value" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="true">Ticked</option>
        <option value="false">Not ticked</option>
      </select>
    );
  }
  if (field.kind === 'textarea' || value.length > 60) {
    return <textarea className="entry-value" aria-label={label} value={value} rows={Math.min(6, Math.ceil(value.length / 42) || 1)} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input className="entry-value" aria-label={label} type={field.kind === 'date' ? 'date' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} />;
}

interface Props {
  tabId?: number;
  snapshot?: FormSnapshot;
  settings: Settings;
  profiles: Profile[];
  activeProfileId?: string;
  onPickProfile: (id: string | undefined) => void;
  /** Saves a new profile (made from a resume) and makes it the active one. */
  onAddProfile: (profile: Profile) => void;
  goToSettings: () => void;
  memory: RememberedAnswer[];
}

export function FillView({ tabId, snapshot, settings, profiles, activeProfileId, onPickProfile, onAddProfile, goToSettings, memory }: Props) {
  const [info, setInfo] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);
  const [rows, setRows] = useState<Row[]>();
  const [notes, setNotes] = useState<string>();
  const [busy, setBusy] = useState<'match' | 'ai' | 'fill' | 'undo'>();
  const [message, setMessage] = useState<Message>();
  const [chatReply, setChatReply] = useState<string>();
  const [canUndo, setCanUndo] = useState(false);
  /** Memory before and after the last fill, so undoing the fill takes its answers back out. */
  const memoryUndo = useRef<{ before: RememberedAnswer[]; after: RememberedAnswer[] } | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const remembered = settings.memory.enabled ? memory : [];

  const fields = snapshot?.fields ?? [];
  const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const ambiguous = useMemo(() => ambiguousNames(fields), [fields]);
  const nameOf = (f: FormField) => fieldName(f, ambiguous);
  const nameById = (id: string) => (byId.get(id) ? nameOf(byId.get(id)!) : id);
  const locale = navigator.language;
  const provider = PROVIDERS[settings.provider];

  // Start from the unsaved draft, or the active profile.
  useEffect(() => {
    void loadDraft().then((draft) => {
      setInfo(draft || profiles.find((p) => p.id === activeProfileId)?.text || '');
      setLoaded(true);
    });
    // Only on first render: later profile picks set the text explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => void saveDraft(info), 400);
    return () => clearTimeout(t);
  }, [info, loaded]);

  // A different page means different fields: drop the old preview.
  useEffect(() => {
    setRows(undefined);
    setNotes(undefined);
    setMessage(undefined);
    setCanUndo(false);
    memoryUndo.current = undefined;
  }, [snapshot?.url, tabId]);

  function show(proposals: Proposal[], rejected: { id: string; reason: string }[], aiNotes: string | undefined, originOf: (fieldId: string) => Row['origin']) {
    setRows(
      proposals.map((p) => ({ fieldId: p.fieldId, value: p.value, checked: true, source: p.source, confidence: p.confidence, origin: originOf(p.fieldId) })),
    );
    setNotes(aiNotes);
    if (proposals.length === 0) {
      setMessage({ kind: 'info', text: 'Nothing in your info matched a field on this page. Fill with AI can work out less obvious matches.' });
    } else if (rejected.length) {
      setMessage({
        kind: 'info',
        text: `${rejected.length} suggested ${rejected.length === 1 ? 'value was' : 'values were'} left out:`,
        list: rejected.map((r) => `${nameById(r.id)}: ${r.reason}`),
      });
    } else {
      setMessage(undefined);
    }
  }

  function match() {
    const parsed = parsePasted(info);
    if (parsed.kind === 'empty' && remembered.length === 0) {
      setMessage({ kind: 'error', text: 'Nothing to match. Paste lines like "Email: jane@example.com", a JSON object, or a reply from a chat app.' });
      return;
    }
    if (parsed.kind === 'fills') {
      const { proposals, rejected } = fillsToProposals(parsed.fills, fields, { locale });
      show(proposals, rejected, parsed.notes, () => 'ai');
      return;
    }
    // The info first; remembered answers only for the fields it left empty.
    const fromInfo = parsed.kind === 'pairs' ? matchPairs(parsed.pairs, fields, { locale }) : [];
    const taken = new Set(fromInfo.map((p) => p.fieldId));
    const fromMemory = remembered.length ? matchPairs(memoryPairs(remembered), fields.filter((f) => !taken.has(f.id)), { locale }) : [];
    const order = new Map(fields.map((f, i) => [f.id, i]));
    const proposals = [...fromInfo, ...fromMemory].sort((a, b) => order.get(a.fieldId)! - order.get(b.fieldId)!);
    show(proposals, [], undefined, (id) => (taken.has(id) ? 'info' : 'memory'));
  }

  async function fillWithAi() {
    if (!snapshot) return;
    const problem = providerProblem(settings);
    if (problem) {
      setMessage({ kind: 'error', text: problem, action: { label: 'Open Settings', run: goToSettings } });
      return;
    }
    abort.current = new AbortController();
    setBusy('ai');
    setMessage(undefined);
    try {
      const reply = await askAi(settings, { snapshot, info, instructions, remembered }, abort.current.signal);
      const { proposals, rejected } = fillsToProposals(reply.fills, fields, { locale });
      show(proposals, rejected, reply.notes, () => 'ai');
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof AiError ? e.message : `Something went wrong: ${(e as Error).message}` });
    } finally {
      setBusy(undefined);
    }
  }

  async function copyPrompt() {
    if (!snapshot) return;
    await navigator.clipboard.writeText(buildChatPrompt({ snapshot, info, instructions, remembered }));
    setChatReply('');
    setMessage({ kind: 'info', text: 'Prompt copied. Paste it into ChatGPT, Claude or Gemini, then paste the reply below.' });
  }

  function applyChatReply() {
    const reply = parseFillsReply(chatReply ?? '');
    if (!reply) {
      setMessage({ kind: 'error', text: 'That reply has no fills in it. Copy the whole reply, including the {"fills": ...} part.' });
      return;
    }
    const { proposals, rejected } = fillsToProposals(reply.fills, fields, { locale });
    show(proposals, rejected, reply.notes, () => 'ai');
    setChatReply(undefined);
  }

  async function fill() {
    if (tabId === undefined || !rows) return;
    const chosen = rows.filter((r) => r.checked);
    setBusy('fill');
    try {
      const result = await sendToTab(tabId, { type: 'formhand:fill', fills: chosen.map((r) => ({ id: r.fieldId, value: r.value })) });
      setCanUndo(result.filled.length > 0);
      const n = result.filled.length;
      const kept = await remember(chosen.filter((r) => result.filled.includes(r.fieldId)));
      const keptLine = kept ? ` Formhand will remember ${kept} ${kept === 1 ? 'answer' : 'answers'} for later forms.` : '';
      setMessage({
        kind: result.skipped.length && !n ? 'error' : 'success',
        text: n ? `Filled ${n} ${n === 1 ? 'field' : 'fields'}. Check them on the page, then submit.${keptLine}` : 'No fields were filled.',
        list: result.skipped.map((s) => `${nameById(s.id)}: ${s.reason}`),
      });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  /**
   * Keeps the filled answers the info didn't already have. Values matched from the info
   * and left alone are in the info already; edited ones, AI answers and remembered
   * answers (which get a fresh date) are kept. Returns how many.
   */
  async function remember(filled: Row[]): Promise<number> {
    if (!settings.memory.enabled || !snapshot) return 0;
    const fills = filled.filter((r) => r.origin !== 'info' || r.edited).map((r) => ({ id: r.fieldId, value: r.value }));
    const answers = answersToRemember(fields, fills, { site: host(snapshot.url), at: new Date().toISOString(), info });
    if (!answers.length) return 0;
    const after = rememberAnswers(memory, answers);
    memoryUndo.current = { before: memory, after };
    await saveMemory(after);
    // Remembered answers used again only get a fresh date; count the new or changed ones.
    return answers.filter((a) => !memory.some((m) => questionKey(m.question) === questionKey(a.question) && m.value === a.value)).length;
  }

  async function undo() {
    if (tabId === undefined) return;
    setBusy('undo');
    try {
      const { restored } = await sendToTab(tabId, { type: 'formhand:undo' });
      setCanUndo(false);
      // Take this fill's answers back out, unless memory was changed since.
      const last = memoryUndo.current;
      memoryUndo.current = undefined;
      if (last && sameMemory(memory, last.after)) await saveMemory(last.before);
      setMessage({ kind: 'info', text: restored ? `Put back the previous values in ${restored} ${restored === 1 ? 'field' : 'fields'}.` : 'There was nothing to undo.' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  const pickProfile = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    onPickProfile(profile?.id);
    if (profile) setInfo(profile.text);
  };

  const chosenCount = rows?.filter((r) => r.checked).length ?? 0;
  const leftEmpty = rows ? fields.filter((f) => !rows.some((r) => r.fieldId === f.id)) : [];
  const noForm = !!snapshot && fields.length === 0;

  return (
    <>
      <div className="view">
        <section className="section" aria-label="Your info">
          <div className="row spread">
            <label className="label" htmlFor="info">
              Your info
            </label>
            {profiles.length > 0 && (
              <select className="select inline" aria-label="Profile" value={activeProfileId ?? ''} onChange={(e) => pickProfile(e.target.value)}>
                <option value="">Profile…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <textarea
            id="info"
            className="textarea"
            value={info}
            onChange={(e) => setInfo(e.target.value)}
            placeholder={'Paste anything about you or the request:\nName: Jane Doe\nEmail: jane@example.com\n…or a CV, a JSON object, or notes.'}
          />
          {showInstructions ? (
            <input
              className="input"
              aria-label="Instructions for the AI"
              autoFocus
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder='For the AI, e.g. "Applying for the designer role, keep answers short"'
            />
          ) : (
            <button type="button" className="link-button" onClick={() => setShowInstructions(true)}>
              Add instructions for the AI
            </button>
          )}
          <ResumeButton
            settings={settings}
            label="Upload a resume"
            className="link-button"
            onProfile={(profile, { fileName, problem }) => {
              onAddProfile(profile);
              setInfo(profile.text);
              setMessage({
                kind: 'info',
                text: problem
                  ? `${problem} It’s saved as the profile “${profile.name}”.`
                  : `Made the profile “${profile.name}” from ${fileName}. Press Fill with AI, or Match fields.`,
              });
            }}
          />
          <div className="row">
            <button type="button" className="button" onClick={match} disabled={!snapshot || noForm || !!busy}>
              Match fields
            </button>
            {busy === 'ai' ? (
              <button type="button" className="button primary" onClick={() => abort.current?.abort()}>
                <SparkIcon /> Asking {provider.label.split(' (')[0]}… Stop
              </button>
            ) : (
              <button type="button" className="button primary" onClick={fillWithAi} disabled={!snapshot || noForm || !!busy}>
                <SparkIcon /> Fill with AI
              </button>
            )}
          </div>
          <button type="button" className="link-button" onClick={copyPrompt} disabled={!snapshot || noForm}>
            <span className="row" style={{ gap: 5 }}>
              <CopyIcon /> Copy a prompt for ChatGPT or another chat app
            </span>
          </button>
          {chatReply !== undefined && (
            <div className="section">
              <label className="label" htmlFor="reply">
                The chat app's reply
              </label>
              <textarea id="reply" className="textarea small" value={chatReply} onChange={(e) => setChatReply(e.target.value)} placeholder='{"fills":[...]}' />
              <div className="row">
                <button type="button" className="button" onClick={applyChatReply} disabled={!chatReply.trim()}>
                  Use this reply
                </button>
                <button type="button" className="link-button" onClick={() => setChatReply(undefined)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        {noForm && <p className="empty">No form fields on this page. Open a page with a form, or wait for it to finish loading.</p>}

        {message && (
          <div className={`notice ${message.kind === 'info' ? '' : message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
            {message.list && message.list.length > 0 && (
              <ul>
                {message.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {message.action && (
              <div>
                <button type="button" className="link-button" onClick={message.action.run}>
                  {message.action.label}
                </button>
              </div>
            )}
          </div>
        )}

        {notes && <div className="notice">{notes}</div>}

        {rows && rows.length > 0 && (
          <section className="sheet" aria-label="Values to fill">
            <div className="sheet-head">
              <strong>
                {rows.length} of {fields.length} fields ready
              </strong>
              <button
                type="button"
                className="link-button"
                onClick={() => setRows(rows.map((r) => ({ ...r, checked: chosenCount !== rows.length })))}
              >
                {chosenCount === rows.length ? 'Untick all' : 'Tick all'}
              </button>
            </div>
            {rows.map((row, i) => {
              const field = byId.get(row.fieldId);
              if (!field) return null;
              const unsure = row.confidence < 0.75;
              const update = (patch: Partial<Row>) =>
                setRows(rows.map((r, j) => (j === i ? { ...r, ...patch, edited: r.edited || (patch.value !== undefined && patch.value !== r.value) } : r)));
              return (
                <div key={row.fieldId} className={`entry${row.checked ? '' : ' off'}${unsure ? ' unsure' : ''}`}>
                  <input type="checkbox" className="tick" aria-label={`Fill ${nameOf(field)}`} checked={row.checked} onChange={(e) => update({ checked: e.target.checked })} />
                  <div className="entry-label" title={unsure ? 'A loose match: check it' : undefined}>
                    <span className="name">{nameOf(field)}</span>
                    <span className="source">{row.origin === 'memory' ? 'remembered' : row.source === 'AI' ? `from ${provider.label.split(' (')[0]}` : `from “${row.source}”`}</span>
                  </div>
                  <ValueInput field={field} name={nameOf(field)} value={row.value} onChange={(value) => update({ value })} />
                </div>
              );
            })}
            {leftEmpty.length > 0 && (
              <details className="left-empty">
                <summary>
                  {leftEmpty.length} {leftEmpty.length === 1 ? 'field' : 'fields'} left empty
                </summary>
                {leftEmpty.map(nameOf).join(', ')}
              </details>
            )}
          </section>
        )}
      </div>

      {(!!rows?.length || canUndo) && (
        <div className="actionbar">
          {rows && rows.length > 0 && (
            <button type="button" className="button primary" onClick={fill} disabled={!chosenCount || !!busy}>
              {busy === 'fill' ? 'Filling…' : `Fill ${chosenCount} ${chosenCount === 1 ? 'field' : 'fields'}`}
            </button>
          )}
          {canUndo && (
            <button type="button" className="button" onClick={undo} disabled={!!busy}>
              <UndoIcon /> Undo fill
            </button>
          )}
        </div>
      )}
    </>
  );
}
