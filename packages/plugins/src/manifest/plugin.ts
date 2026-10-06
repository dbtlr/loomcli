import { checkShortSetting, plugin } from '@loomcli/core';
import type { BooleanOption, Plugin, PluginOptions } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { manifestCommand } from './extension.js';

const identity = `${Package.name}/manifest`;

const options = {
  manifest: {
    control: true,
    description: "Print this command's manifest as JSON.",
    type: 'boolean',
  },
} satisfies PluginOptions;

export type ManifestOptions = typeof options;

/** The short spelling an application gives `--manifest`, none by default. */
export interface ManifestSettings {
  readonly short?: NonNullable<BooleanOption['short']>;
}

/**
 * A plugin that prints the routed Command's manifest, the JSON slice of the graph an agent reads
 * before it invokes, and ends the invocation. It defines the collecting extension any supplier
 * gives prose, examples, and failures through, and it declares no view and claims no slot. The
 * annotated return type is the boundary that breaks the cycle between this module and the
 * middleware module `load` names.
 */
export function manifest(settings?: ManifestSettings): Plugin<ManifestOptions> {
  checkShortSetting(settings, { call: 'manifest', option: 'manifest', plugin: identity });
  const short = settings?.short;
  return plugin(identity, {
    extensions: [manifestCommand],
    middleware: { activate: ['manifest'], load: () => import('./middleware.js') },
    options: { manifest: { ...options.manifest, ...(short === undefined ? {} : { short }) } },
  });
}
