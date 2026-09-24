import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { manifestCommand } from './extension.js';

const options = {
  manifest: { description: "Print this command's manifest as JSON.", type: 'boolean' },
} satisfies PluginOptions;

export type ManifestOptions = typeof options;

/**
 * A plugin that prints the routed Command's manifest, the JSON slice of the graph an agent reads
 * before it invokes, and ends the invocation. It defines the collecting extension any supplier
 * gives prose and examples through, and it declares no view and claims no slot. The annotated
 * return type is the boundary that breaks the cycle between this module and the middleware module
 * `load` names.
 */
export function manifest(): Plugin<ManifestOptions> {
  return plugin(`${Package.name}/manifest`, {
    extensions: [manifestCommand],
    middleware: { activate: ['manifest'], load: () => import('./middleware.js') },
    options,
  });
}
