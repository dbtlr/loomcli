import { plugin } from '@loomcli/core';
import type { BooleanOption, Plugin, PluginOptions } from '@loomcli/core';

import { packageName } from '../constants.js';
import { manifestCommand } from './extension.js';

const identity = `${packageName}/manifest`;

const options = {
  manifest: {
    control: true,
    description: "Print this command's manifest as JSON.",
    type: 'boolean',
  },
} satisfies PluginOptions;

/**
 * The options record `manifest()` declares: the global `--manifest` option.
 *
 * @public @sealed
 */
export type ManifestOptions = typeof options;

/**
 * The short spelling an application gives `--manifest`, none by default.
 *
 * @public
 */
export interface ManifestSettings {
  /** The short spelling of `--manifest`. None by default. */
  readonly short?: NonNullable<BooleanOption['short']>;
}

/**
 * A plugin that prints the routed Command's manifest, the JSON slice of the graph an agent reads
 * before it invokes, and ends the invocation. It defines the collecting extension any supplier
 * gives prose, examples, and failures through, and it declares no view and claims no slot. The
 * annotated return type is the boundary that breaks the cycle between this module and the
 * middleware module `load` names.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { manifest } from '@loomcli/plugins/manifest';
 *
 * export const app = new Application('notes', { plugins: [manifest()] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/manifest.md
 *
 * @public
 */
export function manifest(settings?: ManifestSettings): Plugin<ManifestOptions> {
  const short = settings?.short;
  return plugin(identity, {
    extensions: [manifestCommand],
    middleware: { activate: ['manifest'], load: () => import('./middleware.js') },
    options: { manifest: { ...options.manifest, ...(short === undefined ? {} : { short }) } },
  });
}
