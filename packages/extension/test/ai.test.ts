import { describe, expect, it, vi } from 'vitest';
import type { PromptInput } from '@formhand/core';
import { readResumeWithAi } from '../src/lib/ai';
import { askClaude, runClaude } from '../src/lib/ai/anthropic';
import { AiError } from '../src/lib/ai/errors';
import { askOpenAiCompatible, listModels, runOpenAiCompatible } from '../src/lib/ai/openai';
import { resumeTask } from '../src/lib/ai/tasks';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

const input: PromptInput = {
  snapshot: {
    url: 'https://example.com/signup',
    title: 'Sign up',
    fields: [{ id: 'f1', kind: 'email', label: 'Email' }],
  },
  info: 'Email: jane@x.io',
};

const REPLY = '{"fills":[{"id":"f1","value":"jane@x.io"}],"notes":""}';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function claudeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: REPLY }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    ...overrides,
  };
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): { url: string; headers: Headers; body: Record<string, any> } {
  const [url, init] = fetchMock.mock.calls[call] as [string | URL | Request, RequestInit];
  return { url: String(url), headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : {} };
}

describe('askClaude', () => {
  const config = { apiKey: 'sk-ant-test', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com' };

  it('asks for a JSON-schema reply with the default refusal fallback, and parses it', async () => {
    const fetchMock = vi.fn(async () => json(claudeMessage()));
    const reply = await askClaude(config, input, undefined, fetchMock);
    expect(reply).toEqual({ fills: [{ id: 'f1', value: 'jane@x.io' }], notes: undefined });

    const { url, headers, body } = requestOf(fetchMock);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers.get('authorization')).toBe('Bearer sk-ant-test');
    expect(headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toEqual(['fills', 'notes']);
    expect(body.system).toMatch(/You fill in web forms/);
    expect(body.messages[0].content).toContain('{"id":"f1","type":"email","label":"Email"}');
  });

  it('leaves out the fallback for models without one', async () => {
    const fetchMock = vi.fn(async () => json(claudeMessage({ model: 'claude-haiku-5-5' })));
    await askClaude({ ...config, model: 'claude-haiku-5-5' }, input, undefined, fetchMock);
    const { headers, body } = requestOf(fetchMock);
    expect(body.fallbacks).toBeUndefined();
    expect(headers.get('anthropic-beta')).toBeNull();
    expect(body.output_config.effort).toBe('low');
  });

  it('explains a refusal instead of returning nothing', async () => {
    const fetchMock = vi.fn(async () => json(claudeMessage({ content: [], stop_reason: 'refusal' })));
    await expect(askClaude(config, input, undefined, fetchMock)).rejects.toThrow(/declined/);
  });

  it('turns a 401 into a hint about the key', async () => {
    const fetchMock = vi.fn(async () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401));
    const call = askClaude(config, input, undefined, fetchMock);
    await expect(call).rejects.toBeInstanceOf(AiError);
    await expect(call).rejects.toThrow('Claude rejected the API key. Check it in Settings.');
  });
});

describe('askOpenAiCompatible', () => {
  const config = { apiKey: 'sk-test', model: 'gpt-6.1-terra', baseUrl: 'https://api.openai.com/v1' };

  it('posts a chat completion with a JSON schema and parses the reply', async () => {
    const fetchMock = vi.fn(async () => json({ choices: [{ message: { content: REPLY } }] }));
    const reply = await askOpenAiCompatible(config, input, undefined, fetchMock);
    expect(reply.fills).toEqual([{ id: 'f1', value: 'jane@x.io' }]);

    const { url, headers, body } = requestOf(fetchMock);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(headers.get('authorization')).toBe('Bearer sk-test');
    expect(body.model).toBe('gpt-6.1-terra');
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'form_fills', strict: true } });
  });

  it('retries without the schema when the server does not support it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: "'response_format.type' must be 'text'" } }, 400))
      .mockResolvedValueOnce(json({ choices: [{ message: { content: `Here:\n\`\`\`json\n${REPLY}\n\`\`\`` } }] }));
    const reply = await askOpenAiCompatible({ ...config, apiKey: '', baseUrl: 'http://localhost:1234/v1' }, input, undefined, fetchMock);
    expect(reply.fills).toHaveLength(1);
    expect(requestOf(fetchMock, 1).body.response_format).toBeUndefined();
    expect(requestOf(fetchMock, 1).headers.get('authorization')).toBeNull();
  });

  it('does not retry other 400 errors', async () => {
    const fetchMock = vi.fn(async () => json({ error: { message: 'context length exceeded' } }, 400));
    await expect(askOpenAiCompatible(config, input, undefined, fetchMock)).rejects.toThrow('api.openai.com returned an error (400): context length exceeded');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains Ollama refusing the extension origin', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 403 }));
    await expect(askOpenAiCompatible({ ...config, baseUrl: 'http://localhost:11434/v1' }, input, undefined, fetchMock)).rejects.toThrow(/OLLAMA_ORIGINS/);
  });

  it('says when a local server is not running', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(askOpenAiCompatible({ ...config, baseUrl: 'http://localhost:1234/v1' }, input, undefined, fetchMock)).rejects.toThrow(
      "Couldn't reach localhost:1234. Is the local server running?",
    );
  });

  it('reports a model refusal and an unreadable reply', async () => {
    const refusal = vi.fn(async () => json({ choices: [{ message: { content: null, refusal: 'I cannot help with that.' } }] }));
    await expect(askOpenAiCompatible(config, input, undefined, refusal)).rejects.toThrow('The model declined: I cannot help with that.');
    const prose = vi.fn(async () => json({ choices: [{ message: { content: 'Sure, Jane!' } }] }));
    await expect(askOpenAiCompatible(config, input, undefined, prose)).rejects.toThrow(/expected format/);
  });

  it('lists models, sorted', async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ id: 'qwen3:8b' }, { id: 'gemma3:4b' }, {}] }));
    expect(await listModels({ ...config, baseUrl: 'http://localhost:11434/v1' }, fetchMock)).toEqual(['gemma3:4b', 'qwen3:8b']);
    expect(requestOf(fetchMock).url).toBe('http://localhost:11434/v1/models');
  });
});

describe('reading a resume', () => {
  const RESUME_REPLY = '{"name":"Jane Doe","details":[{"label":"Email","value":"jane@x.io"}]}';

  it('sends the text to Claude with the resume schema', async () => {
    const fetchMock = vi.fn(async () => json(claudeMessage({ content: [{ type: 'text', text: RESUME_REPLY }] })));
    const reply = await runClaude({ apiKey: 'k', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com' }, resumeTask('Jane Doe\njane@x.io'), undefined, fetchMock);
    expect(reply).toEqual({ name: 'Jane Doe', details: [{ label: 'Email', value: 'jane@x.io' }] });
    const { body } = requestOf(fetchMock);
    expect(body.system).toMatch(/You read a person's resume/);
    expect(body.output_config.format.schema.required).toEqual(['name', 'details']);
    expect(body.messages[0].content).toBe('Resume:\n<<<\nJane Doe\njane@x.io\n>>>');
  });

  it('sends a scanned PDF to Claude as a document', async () => {
    const fetchMock = vi.fn(async () => json(claudeMessage({ content: [{ type: 'text', text: RESUME_REPLY }] })));
    await runClaude({ apiKey: 'k', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com' }, resumeTask('', 'JVBERi0='), undefined, fetchMock);
    const content = requestOf(fetchMock).body.messages[0].content;
    expect(content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } });
    expect(content[1]).toEqual({ type: 'text', text: 'The resume is the attached PDF.' });
  });

  it('names the resume schema for OpenAI-compatible servers', async () => {
    const fetchMock = vi.fn(async () => json({ choices: [{ message: { content: RESUME_REPLY } }] }));
    const reply = await runOpenAiCompatible({ apiKey: 'k', model: 'm', baseUrl: 'https://api.openai.com/v1' }, resumeTask('Jane Doe'), undefined, fetchMock);
    expect(reply.name).toBe('Jane Doe');
    expect(requestOf(fetchMock).body.response_format).toMatchObject({ json_schema: { name: 'resume_profile', strict: true } });
  });

  it('only sends a scan to Claude, and says why to everyone else', async () => {
    const settings = { ...DEFAULT_SETTINGS, provider: 'openai' as const, providers: { openai: { apiKey: 'k' } } };
    await expect(readResumeWithAi(settings, { text: '', scannedPdf: 'JVBERi0=' })).rejects.toThrow('Claude can read scans');
  });
});
