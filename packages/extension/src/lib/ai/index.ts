import type { PromptInput } from '@formhand/core';
import { providerConfig, type Settings } from '../settings';
import type { AiReply } from './errors';
import { askOpenAiCompatible } from './openai';
import { PROVIDERS } from './providers';

export { AiError, type AiReply } from './errors';
export { listModels } from './openai';
export { PROVIDERS, PROVIDER_ORDER, type ProviderId, type ProviderPreset } from './providers';

/** Sends the form and the user's info to the provider chosen in Settings. */
export async function askAi(settings: Settings, input: PromptInput, signal?: AbortSignal): Promise<AiReply> {
  const config = providerConfig(settings);
  if (PROVIDERS[config.id].api !== 'anthropic') return askOpenAiCompatible(config, input, signal);
  // The Anthropic SDK is most of the side panel's size; load it only for Claude.
  const { askClaude } = await import('./anthropic');
  return askClaude(config, input, signal);
}
