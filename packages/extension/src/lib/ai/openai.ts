import { buildUserMessage, FILLS_SCHEMA, parseFillsReply, SYSTEM_PROMPT, type PromptInput } from '@formhand/core';
import { AiError, type AiReply } from './errors';

export interface OpenAiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

type Fetch = typeof fetch;

function host(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function headers(config: OpenAiConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) h.Authorization = `Bearer ${config.apiKey}`;
  // OpenRouter shows these on its activity page; other servers ignore them.
  h['X-Title'] = 'Formhand';
  return h;
}

async function errorMessage(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const msg = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message);
    if (msg) return msg;
  } catch {
    // Not JSON.
  }
  return body.slice(0, 300) || res.statusText;
}

async function call(config: OpenAiConfig, body: unknown, fetchImpl: Fetch, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetchImpl(`${config.baseUrl}/chat/completions`, { method: 'POST', headers: headers(config), body: JSON.stringify(body), signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new AiError('Stopped.');
    const local = /localhost|127\.0\.0\.1/.test(config.baseUrl);
    throw new AiError(
      local ? `Couldn't reach ${host(config.baseUrl)}. Is the local server running?` : `Couldn't reach ${host(config.baseUrl)}. Check your connection and the server address.`,
    );
  }
}

function statusError(status: number, message: string, config: OpenAiConfig): AiError {
  if (status === 401) return new AiError(`${host(config.baseUrl)} rejected the API key. Check it in Settings.`);
  if (status === 403 && /localhost:11434|127\.0\.0\.1:11434/.test(config.baseUrl)) {
    return new AiError('Ollama refused the extension. Set OLLAMA_ORIGINS=chrome-extension://*,moz-extension://* and restart Ollama.');
  }
  if (status === 404) return new AiError(`Model or endpoint not found on ${host(config.baseUrl)}: ${message}`);
  if (status === 429) return new AiError(`${host(config.baseUrl)} is rate-limiting this key. Wait a moment and try again.`);
  return new AiError(`${host(config.baseUrl)} returned an error (${status}): ${message}`);
}

/**
 * Asks any OpenAI-compatible server (OpenAI, Gemini, OpenRouter, Ollama, LM Studio...)
 * for fills. Requests a JSON-schema reply; servers that don't support that get the
 * same request without it, and the prompt alone asks for JSON.
 */
export async function askOpenAiCompatible(config: OpenAiConfig, input: PromptInput, signal?: AbortSignal, fetchImpl: Fetch = fetch): Promise<AiReply> {
  const base = {
    model: config.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(input) },
    ],
  };
  const withSchema = {
    ...base,
    response_format: { type: 'json_schema', json_schema: { name: 'form_fills', strict: true, schema: FILLS_SCHEMA } },
  };

  let res = await call(config, withSchema, fetchImpl, signal);
  if (res.status === 400 || res.status === 422) {
    const message = await errorMessage(res);
    if (!/response_format|json_schema|schema|structured/i.test(message)) throw statusError(res.status, message, config);
    res = await call(config, base, fetchImpl, signal);
  }
  if (!res.ok) throw statusError(res.status, await errorMessage(res), config);

  const data = (await res.json()) as { choices?: { message?: { content?: string | null; refusal?: string | null } }[] };
  const message = data.choices?.[0]?.message;
  if (message?.refusal) throw new AiError(`The model declined: ${message.refusal}`);
  const reply = parseFillsReply(message?.content ?? '');
  if (!reply) throw new AiError("The model's reply wasn't in the expected format. Try again, or try a larger model.");
  return reply;
}

/** Model ids the server offers, for the "Load models" button. */
export async function listModels(config: OpenAiConfig, fetchImpl: Fetch = fetch): Promise<string[]> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}/models`, { headers: headers(config) });
  } catch {
    throw new AiError(`Couldn't reach ${host(config.baseUrl)}.`);
  }
  if (!res.ok) throw statusError(res.status, await errorMessage(res), config);
  const data = (await res.json()) as { data?: { id?: string }[] };
  return (data.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id)
    .sort((a, b) => a.localeCompare(b));
}
