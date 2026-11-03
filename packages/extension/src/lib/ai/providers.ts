export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'lmstudio' | 'custom';

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  /** "anthropic" uses Anthropic's SDK; everything else speaks the OpenAI chat completions API. */
  api: 'anthropic' | 'openai';
  baseUrl: string;
  defaultModel: string;
  /** Suggestions for the model box; the user can type any model id. */
  models: string[];
  needsKey: boolean;
  /** Runs on the user's computer, so nothing leaves it. */
  local: boolean;
  keyUrl?: string;
  hint?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    api: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    needsKey: true,
    local: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    api: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6.1-terra',
    models: ['gpt-6.1-terra', 'gpt-6-luna', 'gpt-6.1-sol'],
    needsKey: true,
    local: false,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    api: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.6-flash',
    models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
    needsKey: true,
    local: false,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    api: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    models: ['openrouter/auto'],
    needsKey: true,
    local: false,
    keyUrl: 'https://openrouter.ai/keys',
    hint: 'One key for hundreds of models. Use "Load models" to pick one.',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (this computer)',
    api: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: '',
    models: [],
    needsKey: false,
    local: true,
    hint: 'Start Ollama, then "Load models". If it refuses, set OLLAMA_ORIGINS=chrome-extension://*,moz-extension://* and restart it.',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (this computer)',
    api: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: '',
    models: [],
    needsKey: false,
    local: true,
    hint: 'Start the server in LM Studio (Developer tab), then "Load models".',
  },
  custom: {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    api: 'openai',
    baseUrl: '',
    defaultModel: '',
    models: [],
    needsKey: false,
    local: false,
    hint: 'Any server with an OpenAI-style /chat/completions endpoint: Groq, Together, Mistral, vLLM, a company gateway.',
  },
};

export const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama', 'lmstudio', 'custom'];
