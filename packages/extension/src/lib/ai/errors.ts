/** An AI call failure, worded for the person using the side panel. */
export class AiError extends Error {}

export interface AiReply {
  fills: { id: string; value: string }[];
  notes?: string;
}
