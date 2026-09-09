import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import { helpCommand, helpInput } from './plugin-extension.js';

// The entry module exports its options type and annotates its factory's return type. That
// Annotation breaks the type cycle with the middleware module, which type-imports this factory.
const options = {
  help: { extensions: [helpInput({ placeholder: 'topic' })], short: 'h', type: 'boolean' },
} satisfies PluginOptions;

export type HelpOptions = typeof options;

export function help(): Plugin<HelpOptions> {
  return plugin('@fixture/help', {
    extensions: [helpCommand, helpInput],
    middleware: { activate: ['help'], load: () => import('./plugin-middleware.js') },
    options,
  });
}
