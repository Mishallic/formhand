import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, loadProfiles, loadSettings, providerConfig, providerProblem, saveProfiles, saveSettings } from '../src/lib/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('settings', () => {
  it('starts from defaults', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips and keeps defaults for missing parts', async () => {
    await fakeBrowser.storage.local.set({ settings: { provider: 'ollama' } });
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, provider: 'ollama' });
    const s = { ...DEFAULT_SETTINGS, bridge: { enabled: true, pairingCode: 'X' } };
    await saveSettings(s);
    expect(await loadSettings()).toEqual(s);
  });

  it('fills provider settings from the preset', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'ollama' as const, providers: { ollama: { model: ' qwen3:8b ', baseUrl: 'http://192.168.1.5:11434/v1/' } } };
    expect(providerConfig(s)).toEqual({ id: 'ollama', apiKey: '', model: 'qwen3:8b', baseUrl: 'http://192.168.1.5:11434/v1' });
    expect(providerConfig(DEFAULT_SETTINGS)).toEqual({ id: 'anthropic', apiKey: '', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com' });
  });

  it('says what is missing before a provider can be used', () => {
    expect(providerProblem(DEFAULT_SETTINGS)).toBe('Add your Claude (Anthropic) API key in Settings.');
    expect(providerProblem({ ...DEFAULT_SETTINGS, providers: { anthropic: { apiKey: 'k' } } })).toBeUndefined();
    expect(providerProblem({ ...DEFAULT_SETTINGS, provider: 'ollama' })).toBe('Pick a model in Settings.');
    expect(providerProblem({ ...DEFAULT_SETTINGS, provider: 'custom' })).toBe('Set the server address in Settings.');
  });

  it('stores profiles and the active one', async () => {
    expect(await loadProfiles()).toEqual({ profiles: [], activeId: undefined });
    await saveProfiles([{ id: 'p1', name: 'Me', text: 'Name: Jane' }], 'p1');
    expect(await loadProfiles()).toEqual({ profiles: [{ id: 'p1', name: 'Me', text: 'Name: Jane' }], activeId: 'p1' });
  });
});
