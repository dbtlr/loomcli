import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import { packageName } from '../constants.js';

const identity = `${packageName}/verbose`;

// The record lists verbose before quiet, the order help and the manifest print them in.
const options = {
  verbose: {
    control: true,
    description: 'Show more detail. Repeat it for more.',
    short: 'v',
    type: 'count',
    verbose: true,
  },
  quiet: {
    control: true,
    description: 'Hide info and success messages.',
    quiet: true,
    short: 'q',
    type: 'count',
  },
} satisfies PluginOptions;
/**
 * The options record `verbose()` declares: the global `--verbose` and `--quiet` counters.
 *
 * @public @sealed
 */
export type VerboseOptions = typeof options;

/**
 * Gives the operator the standard -v, --verbose and -q, --quiet, which core reads as the run's
 * verbosity right after graph build. The spellings are the standard's, so it takes no settings.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { verbose } from '@loomcli/plugins/verbose';
 *
 * export const app = new Application('notes', { plugins: [verbose()] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/verbose.md
 *
 * @public
 */
export function verbose(): Plugin<VerboseOptions> {
  return plugin(identity, { options });
}
