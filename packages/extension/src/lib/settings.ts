import { browser } from 'wxt/browser';
import { PROVIDERS, type ProviderId } from './ai/providers';

export interface ProviderSettings {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface Settings {
  provider: ProviderId;
  /** Per-provider overrides; missing values fall back to the preset. */
  providers: Partial<Record<ProviderId, Partial<ProviderSettings>>>;
  /** `ports` overrides the helper's default ports; only tests and unusual setups need it. */
  bridge: { enabled: boolean; pairingCode: string; ports?: number[] };
}

export interface Profile {
  id: string;
  name: string;
  text: string;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  providers: {},
  bridge: { enabled: false, pairingCode: '' },
};

const KEYS = { settings: 'settings', profiles: 'profiles', activeProfile: 'activeProfile', draft: 'draft' } as const;

export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(KEYS.settings))[KEYS.settings] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    providers: { ...stored?.providers },
    bridge: { ...DEFAULT_SETTINGS.bridge, ...stored?.bridge },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [KEYS.settings]: settings });
}

/** The settings to call `id` with: the user's values over the preset's defaults. */
export function providerConfig(settings: Settings, id: ProviderId = settings.provider): ProviderSettings & { id: ProviderId } {
  const preset = PROVIDERS[id];
  const own = settings.providers[id] ?? {};
  return {
    id,
    apiKey: own.apiKey?.trim() ?? '',
    model: own.model?.trim() || preset.defaultModel,
    baseUrl: (own.baseUrl?.trim() || preset.baseUrl).replace(/\/+$/, ''),
  };
}

/** Why the current provider can't be used yet, or undefined when it can. */
export function providerProblem(settings: Settings): string | undefined {
  const preset = PROVIDERS[settings.provider];
  const config = providerConfig(settings);
  if (preset.needsKey && !config.apiKey) return `Add your ${preset.label} API key in Settings.`;
  if (!config.baseUrl) return 'Set the server address in Settings.';
  if (!config.model) return 'Pick a model in Settings.';
  return undefined;
}

export async function loadProfiles(): Promise<{ profiles: Profile[]; activeId?: string }> {
  const got = await browser.storage.local.get([KEYS.profiles, KEYS.activeProfile]);
  return { profiles: (got[KEYS.profiles] as Profile[] | undefined) ?? [], activeId: got[KEYS.activeProfile] as string | undefined };
}

export async function saveProfiles(profiles: Profile[], activeId?: string): Promise<void> {
  await browser.storage.local.set({ [KEYS.profiles]: profiles });
  if (activeId) await browser.storage.local.set({ [KEYS.activeProfile]: activeId });
  else await browser.storage.local.remove(KEYS.activeProfile);
}

/** Unsaved text in the Fill box, kept so closing the panel doesn't lose it. */
export async function loadDraft(): Promise<string> {
  return ((await browser.storage.local.get(KEYS.draft))[KEYS.draft] as string | undefined) ?? '';
}

export async function saveDraft(text: string): Promise<void> {
  await browser.storage.local.set({ [KEYS.draft]: text });
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && KEYS.settings in changes) void loadSettings().then(listener);
  };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}
