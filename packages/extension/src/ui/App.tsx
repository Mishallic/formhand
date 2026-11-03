import { useCallback, useEffect, useState } from 'react';
import type { RememberedAnswer } from '@formhand/core';
import { loadMemory, loadProfiles, onMemoryChanged, saveProfiles, type Profile } from '../lib/settings';
import { FillView } from './FillView';
import { useBridge, usePage, useSettings } from './hooks';
import { Mark, RefreshIcon } from './icons';
import { ProfilesView } from './ProfilesView';
import { SettingsView } from './SettingsView';

type Tab = 'fill' | 'profiles' | 'settings';

function host(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('fill');
  const page = usePage();
  const { settings, update } = useSettings();
  const [profiles, setProfiles] = useState<{ list: Profile[]; activeId?: string }>();
  const [toast, setToast] = useState<string>();
  const [memory, setMemory] = useState<RememberedAnswer[]>([]);

  const { status: bridge, reconnect } = useBridge(
    useCallback(
      (text: string) => {
        setToast(text);
        void page.rescan();
      },
      [page.rescan],
    ),
  );

  useEffect(() => {
    void loadProfiles().then(({ profiles: list, activeId }) => setProfiles({ list, activeId }));
    void loadMemory().then(setMemory);
    return onMemoryChanged(setMemory);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const changeProfiles = (list: Profile[], activeId?: string) => {
    setProfiles({ list, activeId });
    void saveProfiles(list, activeId);
  };

  const fieldCount = page.snapshot?.fields.length ?? 0;
  const pageLine = page.error
    ? page.error
    : page.snapshot
      ? `${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'} on ${host(page.snapshot.url)}`
      : 'Reading the page…';

  const connectedApp = bridge.state === 'connected' ? (bridge.apps[0]?.clientName ?? 'AI app') : undefined;

  return (
    <>
      <header className="header">
        <div className="header-top">
          <span className="wordmark">
            <Mark />
            Formhand
          </span>
          {bridge.state !== 'off' && (
            <button type="button" className="bridge-pill" onClick={() => setTab('settings')} title="AI apps (MCP)">
              <span className={`dot ${connectedApp ? 'on' : bridge.state === 'bad-code' ? 'warn' : ''}`} />
              {connectedApp ? `${connectedApp} connected` : bridge.state === 'bad-code' ? 'Pairing code refused' : 'Waiting for AI app'}
            </button>
          )}
        </div>
        <div className="page-line">
          <span title={page.snapshot?.url}>{pageLine}</span>
          <button type="button" className={`icon-button${page.scanning ? ' spinning' : ''}`} onClick={() => void page.rescan()} aria-label="Read the page again" title="Read the page again">
            <RefreshIcon />
          </button>
        </div>
        <nav className="tabs" role="tablist">
          {(['fill', 'profiles', 'settings'] as const).map((t) => (
            <button key={t} type="button" role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === 'fill' ? 'Fill' : t === 'profiles' ? 'Profiles' : 'Settings'}
            </button>
          ))}
        </nav>
      </header>

      {settings && profiles && (
        <>
          {/* Views stay mounted so a half-done fill survives a look at Settings. */}
          <main className="panel" hidden={tab !== 'fill'}>
            <FillView
              tabId={page.tabId}
              snapshot={page.snapshot}
              settings={settings}
              profiles={profiles.list}
              activeProfileId={profiles.activeId}
              onPickProfile={(id) => changeProfiles(profiles.list, id)}
              onAddProfile={(profile) => changeProfiles([...profiles.list, profile], profile.id)}
              goToSettings={() => setTab('settings')}
              memory={memory}
            />
          </main>
          <main className="panel" hidden={tab !== 'profiles'}>
            <ProfilesView
              profiles={profiles.list}
              activeId={profiles.activeId}
              onChange={changeProfiles}
              settings={settings}
              onSaveSettings={(next) => void update(next)}
              memory={memory}
            />
          </main>
          <main className="panel" hidden={tab !== 'settings'}>
            <SettingsView settings={settings} onSave={update} bridge={bridge} onReconnect={reconnect} />
          </main>
        </>
      )}

      {toast && (
        <div className="notice success toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
