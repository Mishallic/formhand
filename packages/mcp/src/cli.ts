import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_PORTS } from '@formhand/core';
import { Bridge } from './bridge';
import { configDir, loadOrCreatePairingCode } from './pairing';
import { createMcpServer } from './server';

declare const __VERSION__: string | undefined;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev';

// stdout belongs to the MCP protocol; everything for humans goes to stderr.
const log = (message: string) => process.stderr.write(`[formhand] ${message}\n`);

function ports(): number[] {
  const fromEnv = process.env.FORMHAND_PORTS?.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0);
  return fromEnv?.length ? fromEnv : DEFAULT_PORTS;
}

function claudeDesktopConfigPath(): string {
  switch (platform()) {
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    default:
      return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
  }
}

function setup(): void {
  const code = loadOrCreatePairingCode();
  const script = fileURLToPath(import.meta.url);
  const node = process.execPath;
  const json = JSON.stringify({ mcpServers: { formhand: { command: node, args: [script] } } }, null, 2);
  process.stdout.write(`Formhand MCP helper ${VERSION}

1. Pairing code (saved in ${configDir()}):

     ${code}

   In the browser: Formhand side panel > Settings > AI apps (MCP). Paste the code and turn the bridge on.

2. Add the helper to your AI app. It starts the helper itself; you don't run anything else.

   Claude Code:
     claude mcp add formhand -- "${node}" "${script}"

   Claude Desktop (${claudeDesktopConfigPath()}),
   Cursor, VS Code, Windsurf, Gemini CLI and other MCP apps, in their MCP JSON config:
${json.replace(/^/gm, '     ')}

3. Restart the AI app and ask it something like "fill the form in my browser with my details".
`);
}

async function serve(): Promise<void> {
  const bridge = new Bridge({ pairingCode: loadOrCreatePairingCode(), version: VERSION, ports: ports(), log });
  try {
    await bridge.listen();
  } catch (error) {
    // Keep serving MCP so the AI app shows a useful error on each tool call instead of a dead server.
    log((error as Error).message);
  }
  const server = createMcpServer(bridge, VERSION);
  await server.connect(new StdioServerTransport());

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void bridge.close().finally(() => process.exit(0));
  };
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const command = process.argv[2];
if (command === 'setup') {
  setup();
} else if (command === 'pairing-code') {
  process.stdout.write(`${loadOrCreatePairingCode()}\n`);
} else if (command === '--version' || command === '-v') {
  process.stdout.write(`${VERSION}\n`);
} else if (command === '--help' || command === '-h') {
  process.stdout.write('Usage: formhand-mcp            run as an MCP server (your AI app does this)\n       formhand-mcp setup      print the pairing code and the config for your AI app\n       formhand-mcp pairing-code\n');
} else {
  serve().catch((error) => {
    log(`fatal: ${(error as Error).stack ?? error}`);
    process.exit(1);
  });
}
