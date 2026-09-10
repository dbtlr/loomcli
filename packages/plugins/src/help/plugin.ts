import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { helpCommand, helpInput } from './extension.js';

const options = {
  help: { description: 'Show this help.', short: 'h', type: 'boolean' },
} satisfies PluginOptions;

export type HelpOptions = typeof options;

/**
 * A plugin that renders the help page of the routed Command and ends the invocation. The annotated
 * return type is the boundary that breaks the cycle between this module and the middleware module
 * `load` names.
 */
export function help(): Plugin<HelpOptions> {
  return plugin(`${Package.name}/help`, {
    extensions: [helpCommand, helpInput],
    middleware: { activate: ['help'], load: () => import('./middleware.js') },
    options,
  });
}
