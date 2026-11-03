import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: { 'formhand-mcp': 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node20',
  clean: true,
  // Core is TypeScript source inside the repo, so it is bundled; npm packages load from node_modules.
  noExternal: ['@formhand/core'],
  banner: { js: '#!/usr/bin/env node' },
  define: { __VERSION__: JSON.stringify(version) },
});
