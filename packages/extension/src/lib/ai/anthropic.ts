import Anthropic from '@anthropic-ai/sdk';
import { buildUserMessage, FILLS_SCHEMA, parseFillsReply, SYSTEM_PROMPT, type PromptInput } from '@formhand/core';
import { AiError, type AiReply } from './errors';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** Models that take server-side refusal fallbacks in their "default" form. */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
/** Claude 5-family models accept `effort`; older ones may reject it. */
const EFFORT_MODELS = /^claude-(fable|mythos|opus|sonnet|haiku)-5/;

function friendly(error: unknown): AiError {
  if (error instanceof Anthropic.AuthenticationError) return new AiError('Claude rejected the API key. Check it in Settings.');
  if (error instanceof Anthropic.PermissionDeniedError) return new AiError("This API key can't use that model.");
  if (error instanceof Anthropic.NotFoundError) return new AiError('Claude doesn\'t know that model. Check the model name in Settings.');
  if (error instanceof Anthropic.RateLimitError) return new AiError('Claude is rate-limiting this key. Wait a moment and try again.');
  if (error instanceof Anthropic.APIUserAbortError) return new AiError('Stopped.');
  if (error instanceof Anthropic.APIConnectionError) return new AiError("Couldn't reach Claude. Check your connection.");
  if (error instanceof Anthropic.APIError) return new AiError(`Claude returned an error (${error.status ?? 'no status'}): ${error.message}`);
  return error instanceof AiError ? error : new AiError((error as Error).message);
}

/**
 * Asks Claude for fills. Uses structured outputs so the reply always parses, low
 * effort because mapping facts onto fields is quick work, and Anthropic's default
 * refusal fallback on the models that support it.
 */
export async function askClaude(config: AnthropicConfig, input: PromptInput, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<AiReply> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    // The key belongs to the person using the extension and stays in their browser.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    ...(fetchImpl && { fetch: fetchImpl }),
  });
  try {
    const response = await client.beta.messages.create(
      {
        model: config.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(input) }],
        output_config: {
          ...(EFFORT_MODELS.test(config.model) && { effort: 'low' as const }),
          format: { type: 'json_schema', schema: FILLS_SCHEMA as unknown as Record<string, unknown> },
        },
        ...(FALLBACK_MODELS.has(config.model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') {
      throw new AiError('Claude declined to fill this form. Try different instructions, or fill it from pasted text.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiError('The reply was cut off. Try a shorter "Your info", or fill the form in two parts.');
    }
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    const reply = parseFillsReply(text);
    if (!reply) throw new AiError("Claude's reply wasn't in the expected format. Try again.");
    return reply;
  } catch (error) {
    throw friendly(error);
  }
}
