import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'Formhand',
    description: 'Fill web forms from pasted text, your AI provider, or the AI app on your computer (MCP).',
    // sidePanel is added by WXT for Chromium; Firefox gets a sidebar instead.
    permissions: ['storage', 'scripting', 'alarms', 'clipboardWrite'],
    // Reading forms on any page the user opens, calling the AI provider they pick, and
    // reaching the local MCP helper on ws://127.0.0.1.
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open Formhand' },
    commands:
      browser === 'firefox'
        ? { _execute_sidebar_action: { suggested_key: { default: 'Alt+Shift+F' }, description: 'Open Formhand' } }
        : { _execute_action: { suggested_key: { default: 'Alt+Shift+F' }, description: 'Open Formhand' } },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'formhand@mishallic.dev',
          strict_min_version: '128.0',
          // Formhand has no server. Form fields and your info reach a third party only
          // when you choose an AI provider and press "Fill with AI".
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
