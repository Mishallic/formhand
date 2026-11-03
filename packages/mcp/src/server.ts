import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { describeField, type BridgeMethod, type BridgeMethods } from '@formhand/core';
import { BridgeError } from './bridge';

/** The part of the Bridge the tools use, so tests can stand in for the browser. */
export interface BridgeLike {
  request<M extends BridgeMethod>(method: M, params: BridgeMethods[M]['params']): Promise<BridgeMethods[M]['result']>;
  setClientName(name: string | undefined): void;
}

const INSTRUCTIONS = `Formhand reads and fills web forms in the user's browser.
Call get_form to see the fields in the user's active tab, then fill_form with values for those field ids.
Use only information the user has given you (in the chat, their files, or what you know about them); ask for anything missing rather than guessing.
Formhand never submits a form: tell the user to review the highlighted fields and submit it themselves.`;

function text(message: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError };
}

async function run(action: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof BridgeError ? error.message : `Formhand failed: ${(error as Error).message}`;
    return text(message, true);
  }
}

export function createMcpServer(bridge: BridgeLike, version: string): McpServer {
  const server = new McpServer({ name: 'formhand', title: 'Formhand', version }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'get_form',
    {
      title: 'Read the form in the browser',
      description:
        "Lists the fillable fields in the user's active browser tab: id, type, label, section, options and current value. " +
        'Password, payment-card and one-time-code fields are never included. Call this before fill_form.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const snapshot = await bridge.request('get_form', {});
        const where = `${snapshot.title || 'Untitled page'} (${snapshot.url})`;
        if (snapshot.fields.length === 0) {
          return text(
            `No fillable fields found on ${where}. The page may still be loading, or the form may be inside an iframe, which Formhand doesn't read yet.`,
          );
        }
        const fields = snapshot.fields.map((f) => JSON.stringify(describeField(f))).join('\n');
        return text(`Page: ${where}\n${snapshot.fields.length} fields. Fill them with fill_form using these ids.\n${fields}`);
      }),
  );

  server.registerTool(
    'fill_form',
    {
      title: 'Fill the form in the browser',
      description:
        "Puts values into fields of the user's active tab, by the ids from get_form. Values are strings: for select and radio " +
        'fields one of the listed options; for checkboxes "true" or "false"; dates as YYYY-MM-DD. Filled fields are highlighted ' +
        'and the form is not submitted. Only fill fields you have real information for.',
      inputSchema: {
        fills: z
          .array(
            z.object({
              id: z.string().describe('Field id from get_form, such as "f3"'),
              value: z.string().describe('The value to put in the field'),
            }),
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ fills }) =>
      run(async () => {
        const result = await bridge.request('fill_form', { fills });
        const lines = [`Filled ${result.filled.length} of ${fills.length} fields${result.filled.length ? ` (${result.filled.join(', ')})` : ''}.`];
        if (result.skipped.length) {
          lines.push(`Skipped: ${result.skipped.map((s) => `${s.id} (${s.reason})`).join('; ')}.`);
        }
        lines.push('The form was not submitted. Ask the user to review the highlighted fields and submit it. undo_fill puts the old values back.');
        return text(lines.join('\n'), result.filled.length === 0);
      }),
  );

  server.registerTool(
    'undo_fill',
    {
      title: 'Undo the last fill',
      description: "Puts back the values the fields had before the last fill_form in the user's active tab.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const { restored } = await bridge.request('undo_fill', {});
        return text(restored ? `Restored ${restored} fields.` : 'There was nothing to undo on this page.');
      }),
  );

  server.server.oninitialized = () => {
    const client = server.server.getClientVersion();
    bridge.setClientName(client?.title ?? client?.name);
  };

  return server;
}
