import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };

const options = {
  version: { description: 'Print the version.', short: 'V', type: 'boolean' },
} satisfies PluginOptions;

export type VersionOptions = typeof options;

/**
 * A plugin that prints the Application's version and ends the invocation. The annotated return type
 * is the boundary that breaks the cycle between this module and the middleware module `load` names.
 */
export function version(): Plugin<VersionOptions> {
  return plugin(`${Package.name}/version`, {
    middleware: { activate: ['version'], load: () => import('./middleware.js') },
    options,
  });
}
