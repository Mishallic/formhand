import { useEffect, useRef, useState } from 'react';
import type { FormSnapshot } from '@formhand/core';
import { askAi, listModels, PROVIDER_ORDER, PROVIDERS, type ProviderId } from '../lib/ai';
import type { BridgeStatus } from '../lib/messages';
import { providerConfig, providerProblem, type ProviderSettings, type Settings } from '../lib/settings';

const TEST_FORM: FormSnapshot = {
  url: 'https://example.com/formhand-test',
  title: 'Formhand connection test',
  fields: [{ id: 'f1', kind: 'email', label: 'Email' }],
};

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
  bridge: BridgeStatus;
  onReconnect: () => void;
}

function bridgeLine(status: BridgeStatus): string {
  switch (status.state) {
    case 'off':
      return 'Off.';
    case 'searching':
      return 'Waiting for an AI app. Start one that has Formhand in its MCP settings.';
    case 'bad-code':
      return 'The helper refused this pairing code. Run the setup command again and paste the code it prints.';
    case 'connected':
      return `Connected to ${status.apps.map((a) => a.clientName ?? 'an AI app').join(', ')}.`;
  }
}

export function SettingsView({ settings, onSave, bridge, onReconnect }: Props) {
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>();
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; value: Settings } | undefined>(undefined);

  // Save shortly after typing stops, and right away when the panel closes or the tab changes.
  function change(next: Settings) {
    setS(next);
    setSaved(false);
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = {
      value: next,
      timer: setTimeout(() => {
        pending.current = undefined;
        void onSave(next).then(() => setSaved(true));
      }, 350),
    };
  }
  useEffect(
    () => () => {
      if (pending.current) {
        clearTimeout(pending.current.timer);
        void onSave(pending.current.value);
      }
    },
    [onSave],
  );

  const id = s.provider;
  const preset = PROVIDERS[id];
  const own = s.providers[id] ?? {};
  const config = providerConfig(s);
  const setOwn = (patch: Partial<ProviderSettings>) => change({ ...s, providers: { ...s.providers, [id]: { ...own, ...patch } } });
  const showBaseUrl = preset.local || id === 'custom';

  async function loadModels() {
    setTest({ kind: 'info', text: 'Loading models…' });
    try {
      const list = await listModels(config);
      setModels(list);
      setTest({ kind: 'info', text: list.length ? `${list.length} models found. Pick one in the Model box.` : 'The server lists no models. Download one first.' });
      if (!config.model && list[0]) setOwn({ model: list[0] });
    } catch (e) {
      setTest({ kind: 'error', text: (e as Error).message });
    }
  }

  async function runTest() {
    const problem = providerProblem(s);
    if (problem) {
      setTest({ kind: 'error', text: problem.replace(' in Settings', '') });
      return;
    }
    setTest({ kind: 'info', text: `Asking ${config.model}…` });
    const started = performance.now();
    try {
      const reply = await askAi(s, { snapshot: TEST_FORM, info: 'Email: test@example.com' });
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      const ok = reply.fills.some((f) => f.id === 'f1' && f.value.includes('@'));
      setTest(
        ok
          ? { kind: 'success', text: `It works. ${config.model} answered in ${seconds} s.` }
          : { kind: 'error', text: `${config.model} answered, but didn't fill the test field. Try a larger model.` },
      );
    } catch (e) {
      setTest({ kind: 'error', text: (e as Error).message });
    }
  }

  return (
    <div className="view">
      <section className="section">
        <div className="row spread">
          <h2 className="section-title">AI provider</h2>
          {saved && <span className="saved">Saved</span>}
        </div>
        <p className="help">Used by Fill with AI. Your key stays in this browser and is sent only to the provider.</p>
        <label className="label" htmlFor="provider">
          Provider
        </label>
        <select
          id="provider"
          className="select"
          value={id}
          onChange={(e) => {
            setModels([]);
            setTest(undefined);
            change({ ...s, provider: e.target.value as ProviderId });
          }}
        >
          {PROVIDER_ORDER.map((p) => (
            <option key={p} value={p}>
              {PROVIDERS[p].label}
            </option>
          ))}
        </select>
        {preset.hint && <p className="help">{preset.hint}</p>}

        {showBaseUrl && (
          <>
            <label className="label" htmlFor="base-url">
              Server address
            </label>
            <input id="base-url" className="input" value={own.baseUrl ?? preset.baseUrl} onChange={(e) => setOwn({ baseUrl: e.target.value })} placeholder="https://example.com/v1" spellCheck={false} />
          </>
        )}

        {(preset.needsKey || id === 'custom') && (
          <>
            <div className="row spread">
              <label className="label" htmlFor="api-key">
                API key{id === 'custom' ? ' (if the server needs one)' : ''}
              </label>
              {preset.keyUrl && (
                <a href={preset.keyUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
                  Get a key
                </a>
              )}
            </div>
            <input id="api-key" className="input" type="password" autoComplete="off" spellCheck={false} value={own.apiKey ?? ''} onChange={(e) => setOwn({ apiKey: e.target.value })} />
          </>
        )}

        <label className="label" htmlFor="model">
          Model
        </label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input
            id="model"
            className="input"
            list="model-options"
            value={own.model ?? preset.defaultModel}
            onChange={(e) => setOwn({ model: e.target.value })}
            placeholder={preset.local ? 'Load models to choose' : preset.defaultModel}
            spellCheck={false}
          />
          {preset.api === 'openai' && (
            <button type="button" className="button" onClick={loadModels}>
              Load models
            </button>
          )}
        </div>
        <datalist id="model-options">
          {[...new Set([...preset.models, ...models])].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

        <div className="row">
          <button type="button" className="button" onClick={runTest}>
            Test connection
          </button>
        </div>
        {test && <div className={`notice ${test.kind === 'info' ? '' : test.kind}`}>{test.text}</div>}
      </section>

      <section className="section">
        <h2 className="section-title">AI apps (MCP)</h2>
        <p className="help">Let an AI app on this computer read and fill forms in your browser, using your subscription to that app instead of an API key.</p>
        <label className="toggle">
          <input type="checkbox" checked={s.bridge.enabled} onChange={(e) => change({ ...s, bridge: { ...s.bridge, enabled: e.target.checked } })} />
          <span>Let AI apps fill forms in my active tab</span>
        </label>
        <label className="label" htmlFor="pairing">
          Pairing code
        </label>
        <input
          id="pairing"
          className="input"
          value={s.bridge.pairingCode}
          onChange={(e) => change({ ...s, bridge: { ...s.bridge, pairingCode: e.target.value } })}
          placeholder="ABCDE-FGHJK-MNPQR-STUVW"
          spellCheck={false}
          autoComplete="off"
          style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}
        />
        <div className="row" role="status">
          <span className={`dot ${bridge.state === 'connected' ? 'on' : bridge.state === 'bad-code' ? 'warn' : ''}`} />
          <span className="help" style={{ flex: 1 }}>
            {bridgeLine(bridge)}
          </span>
          {bridge.state !== 'off' && bridge.state !== 'connected' && (
            <button type="button" className="link-button" onClick={onReconnect}>
              Try again
            </button>
          )}
        </div>
        <ol className="steps">
          <li>
            In the Formhand folder, run <code>npm run mcp:setup</code>. It prints a pairing code and the settings for your AI app.
          </li>
          <li>Add Formhand to your AI app (Claude Desktop, Claude Code, Cursor, VS Code…) as it shows, then restart the app.</li>
          <li>Paste the pairing code above and tick the box.</li>
          <li>In the AI app, ask: "Fill the form in my browser with my details."</li>
        </ol>
      </section>

      <section className="section">
        <h2 className="section-title">What leaves your computer</h2>
        <p className="help">
          Formhand has no server. Your profiles and pasted text stay in this browser. Fill with AI sends the page's field labels and your info to{' '}
          {preset.local ? 'the model running on this computer' : preset.label}, and nothing else. Passwords, card numbers and one-time codes are never read. While
          the MCP box is ticked, connected AI apps can read and fill the form in your active tab; it is never submitted for you.
        </p>
      </section>
    </div>
  );
}
