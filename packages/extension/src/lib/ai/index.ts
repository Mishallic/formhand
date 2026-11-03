import type { PromptInput, ResumeReply } from '@formhand/core';
import { providerConfig, type Settings } from '../settings';
import { AiError, type AiReply } from './errors';
import { runOpenAiCompatible } from './openai';
import { PROVIDERS } from './providers';
import { fillTask, resumeTask, type AiTask } from './tasks';

export { AiError, type AiReply } from './errors';
export { listModels } from './openai';
export { PROVIDERS, PROVIDER_ORDER, type ProviderId, type ProviderPreset } from './providers';

/** Runs a task on the provider chosen in Settings. */
async function runAi<T>(settings: Settings, task: AiTask<T>, signal?: AbortSignal): Promise<T> {
  const config = providerConfig(settings);
  if (PROVIDERS[config.id].api !== 'anthropic') return runOpenAiCompatible(config, task, signal);
  // The Anthropic SDK is most of the side panel's size; load it only for Claude.
  const { runClaude } = await import('./anthropic');
  return runClaude(config, task, signal);
}

/** Sends the form and the user's info to the provider chosen in Settings. */
export function askAi(settings: Settings, input: PromptInput, signal?: AbortSignal): Promise<AiReply> {
  return runAi(settings, fillTask(input), signal);
}

/**
 * Picks the details forms ask for out of a resume's text. A scanned PDF has no text,
 * so it goes to Claude as the PDF itself; other providers can't read it.
 */
export function readResumeWithAi(settings: Settings, resume: { text: string; scannedPdf?: string }, signal?: AbortSignal): Promise<ResumeReply> {
  if (!resume.text.trim()) {
    if (!resume.scannedPdf || PROVIDERS[settings.provider].api !== 'anthropic') {
      return Promise.reject(new AiError('This PDF is a scanned image with no text in it. Claude can read scans: pick Claude in Settings, or paste the text into a new profile.'));
    }
    return runAi(settings, resumeTask('', resume.scannedPdf), signal);
  }
  return runAi(settings, resumeTask(resume.text), signal);
}
