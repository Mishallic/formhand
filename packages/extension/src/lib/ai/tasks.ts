import {
  buildResumeMessage,
  buildUserMessage,
  FILLS_SCHEMA,
  parseFillsReply,
  parseResumeReply,
  RESUME_SCHEMA,
  RESUME_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  type PromptInput,
  type ResumeReply,
} from '@formhand/core';
import type { AiReply } from './errors';

/** One request to the AI provider: what to send, the reply's schema, and how to read it. */
export interface AiTask<T> {
  system: string;
  user: string;
  /** Names the schema for OpenAI-compatible servers. */
  schemaName: string;
  schema: Record<string, unknown>;
  parse(text: string): T | undefined;
  /** A PDF, base64, for a scanned resume with no text. Only Claude is sent one. */
  pdf?: string;
  /** What Claude's refusal and a cut-off reply mean for this task, in the panel's words. */
  declined: string;
  cutOff: string;
}

export function fillTask(input: PromptInput): AiTask<AiReply> {
  return {
    system: SYSTEM_PROMPT,
    user: buildUserMessage(input),
    schemaName: 'form_fills',
    schema: FILLS_SCHEMA as unknown as Record<string, unknown>,
    parse: parseFillsReply,
    declined: 'Claude declined to fill this form. Try different instructions, or fill it from pasted text.',
    cutOff: 'The reply was cut off. Try a shorter "Your info", or fill the form in two parts.',
  };
}

export function resumeTask(text: string, pdf?: string): AiTask<ResumeReply> {
  return {
    system: RESUME_SYSTEM_PROMPT,
    user: buildResumeMessage(text),
    schemaName: 'resume_profile',
    schema: RESUME_SCHEMA as unknown as Record<string, unknown>,
    parse: parseResumeReply,
    ...(pdf && { pdf }),
    declined: 'Claude declined to read this resume. Paste its text into a new profile instead.',
    cutOff: 'The reply was cut off. Try a shorter resume.',
  };
}
