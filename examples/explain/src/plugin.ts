import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import Package from '../package.json' with { type: 'json' };
import { explainCommand } from './extension.js';

const options = {
  explain: { description: 'Explain the selected command and exit.', type: 'boolean' },
} satisfies PluginOptions;

export type ExplainOptions = typeof options;

/**
 * A plugin that explains the routed Command instead of running it. The annotated return type is the
 * boundary that breaks the cycle between this module and the middleware module it names in `load`.
 */
export function explain(): Plugin<ExplainOptions> {
  return plugin(Package.name, {
    extensions: [explainCommand],
    middleware: { activate: ['explain'], load: () => import('./middleware.js') },
    options,
  });
}
