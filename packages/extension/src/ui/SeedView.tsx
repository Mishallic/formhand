import { useEffect, useState } from 'react';
import { makeSeedEntry, SEED_ROLES, seedFills, type FormField, type SeedEntry, type SeedPlan, type SeedRole } from '@formhand/core';
import { loadSeeds, saveSeeds, type SeedRecord } from '../lib/settings';
import { sendToTab } from '../lib/tabs';
import { CopyIcon, UndoIcon } from './icons';

interface Props {
  tabId?: number;
  /** The page the panel sits beside; a new page clears what was detected. */
  pageUrl?: string;
}

type Message = { kind: 'error' | 'success' | 'info'; text: string; list?: string[] };

const ROLE_LABEL = Object.fromEntries(SEED_ROLES.map((r) => [r.role, r.label])) as Record<SeedRole, string>;

function host(url: string | undefined): string {
  try {
    return new URL(url ?? '').host;
  } catch {
    return '';
  }
}

function nameOf(field: FormField | undefined): string {
  return field?.label || field?.placeholder || field?.name || 'Unlabelled field';
}

function EntryRows({ entry, labelPrefix = '' }: { entry: SeedEntry; labelPrefix?: string }) {
  const [copied, setCopied] = useState<SeedRole>();
  return (
    <>
      {SEED_ROLES.map(({ role, label }) => (
        <div className="seed-row" key={role}>
          <span className="seed-label">{label}</span>
          <code className="seed-value">{entry[role]}</code>
          <button
            type="button"
            className="icon-button"
            aria-label={`Copy ${labelPrefix}${label.toLowerCase()}`}
            title={copied === role ? 'Copied' : `Copy ${label.toLowerCase()}`}
            onClick={() => {
              void navigator.clipboard.writeText(entry[role]);
              setCopied(role);
            }}
          >
            <CopyIcon />
          </button>
        </div>
      ))}
    </>
  );
}

/**
 * The test-data seeder: makes up a new person for every fill. Detect shows which
 * fields on the page take a part of the entry; Fill puts one entry into all of them.
 */
export function SeedView({ tabId, pageUrl }: Props) {
  const [entry, setEntry] = useState<SeedEntry>();
  const [history, setHistory] = useState<SeedRecord[]>([]);
  const [found, setFound] = useState<{ plan: SeedPlan; fields: FormField[] }>();
  const [busy, setBusy] = useState<'detect' | 'fill' | 'undo'>();
  const [message, setMessage] = useState<Message>();
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    void loadSeeds().then((seeds) => {
      setHistory(seeds);
      setEntry(makeSeedEntry({ taken: seeds.map((s) => s.username) }));
    });
  }, []);

  useEffect(() => {
    setFound(undefined);
    setMessage(undefined);
    setCanUndo(false);
  }, [pageUrl, tabId]);

  /** Reads the page in the seeder's mode, which also lists password boxes (never what is in them). */
  async function detectWith(current: SeedEntry): Promise<{ plan: SeedPlan; fields: FormField[] } | undefined> {
    if (tabId === undefined) return undefined;
    const { fields } = await sendToTab(tabId, { type: 'formhand:scan', secrets: true });
    const result = { plan: seedFills(fields, current), fields };
    setFound(result);
    return result;
  }

  async function detect() {
    if (!entry) return;
    setBusy('detect');
    setMessage(undefined);
    try {
      const result = await detectWith(entry);
      if (result && result.plan.detected.length === 0) {
        setMessage({ kind: 'info', text: 'No username, password, first name or last name field on this page.' });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  async function fill() {
    if (!entry || tabId === undefined) return;
    setBusy('fill');
    setMessage(undefined);
    try {
      // Detect again every time: the page may have changed since the last look.
      const result = await detectWith(entry);
      if (!result || result.plan.fills.length === 0) {
        setMessage({ kind: 'info', text: 'No username, password, first name or last name field on this page.' });
        return;
      }
      const outcome = await sendToTab(tabId, { type: 'formhand:fill', fills: result.plan.fills, secrets: true });
      const n = outcome.filled.length;
      const byId = new Map(result.fields.map((f) => [f.id, f]));
      setCanUndo(n > 0);
      setMessage({
        kind: n ? 'success' : 'error',
        text: n ? `Filled ${n} ${n === 1 ? 'field' : 'fields'} as ${entry.username}. It’s kept under Recent entries.` : 'No fields were filled.',
        list: outcome.skipped.map((s) => `${nameOf(byId.get(s.id))}: ${s.reason}`),
      });
      if (!n) return;
      // This entry is used up: keep it, and have a different one ready for the next fill.
      const seeds = [{ ...entry, site: host(pageUrl), at: new Date().toISOString() }, ...history];
      setHistory(seeds);
      await saveSeeds(seeds);
      setEntry(makeSeedEntry({ taken: seeds.map((s) => s.username) }));
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  async function undo() {
    if (tabId === undefined) return;
    setBusy('undo');
    try {
      const { restored } = await sendToTab(tabId, { type: 'formhand:undo' });
      setCanUndo(false);
      setMessage({ kind: 'info', text: restored ? `Put back the previous values in ${restored} ${restored === 1 ? 'field' : 'fields'}.` : 'There was nothing to undo.' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  const byId = new Map(found?.fields.map((f) => [f.id, f]));
  const missing = found ? SEED_ROLES.filter(({ role }) => !found.plan.detected.some((d) => d.role === role)) : [];

  return (
    <div className="view">
      <section className="section" aria-label="Seed test data">
        <h2 className="section-title">Seed test data</h2>
        <p className="help">
          Makes up a new test account for every fill: a unique username, a strong password, a first name and a last name. Nothing comes from your profiles, and
          nothing here is remembered as your answers.
        </p>
        <div className="row">
          <button type="button" className="button" onClick={detect} disabled={tabId === undefined || !entry || !!busy}>
            {busy === 'detect' ? 'Detecting…' : 'Detect'}
          </button>
          <button type="button" className="button primary" onClick={fill} disabled={tabId === undefined || !entry || !!busy}>
            {busy === 'fill' ? 'Filling…' : 'Fill'}
          </button>
          {canUndo && (
            <button type="button" className="button" onClick={undo} disabled={!!busy}>
              <UndoIcon /> Undo fill
            </button>
          )}
        </div>

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
          </div>
        )}

        {found && found.plan.detected.length > 0 && (
          <section className="sheet" aria-label="Detected fields">
            <div className="sheet-head">
              <strong>
                {found.plan.detected.length} {found.plan.detected.length === 1 ? 'field' : 'fields'} detected
              </strong>
            </div>
            {found.plan.detected.map((d) => (
              <div className="seed-row" key={d.fieldId}>
                <span className="seed-label">{ROLE_LABEL[d.role]}</span>
                <span className="seed-value plain">{nameOf(byId.get(d.fieldId))}</span>
              </div>
            ))}
            {missing.length > 0 && <p className="help seed-missing">Not on this page: {missing.map((m) => m.label.toLowerCase()).join(', ')}.</p>}
          </section>
        )}

        {entry && (
          <section className="sheet" aria-label="Next entry">
            <div className="sheet-head">
              <strong>Next entry</strong>
              <button type="button" className="link-button" onClick={() => setEntry(makeSeedEntry({ taken: history.map((s) => s.username) }))} disabled={!!busy}>
                Make another
              </button>
            </div>
            <EntryRows entry={entry} labelPrefix="next " />
          </section>
        )}
      </section>

      <section className="section" aria-label="Recent entries">
        <div className="row spread">
          <h2 className="section-title">Recent entries</h2>
          {history.length > 0 && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setHistory([]);
                void saveSeeds([]);
              }}
            >
              Clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="empty">Nothing filled yet. Entries you fill are kept here, in this browser, so you can sign in with them later.</p>
        ) : (
          history.map((record) => (
            <div className="sheet" key={record.at + record.username}>
              <div className="sheet-head">
                <strong>{record.site || 'Unknown site'}</strong>
                <span className="source">{new Date(record.at).toLocaleString()}</span>
              </div>
              <EntryRows entry={record} />
            </div>
          ))
        )}
      </section>
    </div>
  );
}
