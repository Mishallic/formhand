import type { PromptInput } from '@formhand/core';
import { providerConfig, type Settings } from '../settings';
import { askClaude } from './anthropic';
import type { AiReply } from './errors';
import { askOpenAiCompatible } from './openai';
import { PROVIDERS } from './providers';

export { AiError, type AiReply } from './errors';
export { listModels } from './openai';
export { PROVIDERS, PROVIDER_ORDER, type ProviderId, type ProviderPreset } from './providers';

/** Sends the form and the user's info to the provider chosen in Settings. */
export function askAi(settings: Settings, input: PromptInput, signal?: AbortSignal): Promise<AiReply> {
  const config = providerConfig(settings);
  return PROVIDERS[config.id].api === 'anthropic' ? askClaude(config, input, signal) : askOpenAiCompatible(config, input, signal);
}
