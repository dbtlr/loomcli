import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import { packageName } from '../constants.js';

const identity = `${packageName}/plain`;

const options = {
  plain: {
    control: true,
    description: 'Never redraw: print progress as plain lines and ask questions line by line.',
    plain: true,
    type: 'boolean',
  },
} satisfies PluginOptions;
/**
 * The options record `plain()` declares: the global `--plain` option.
 *
 * @public @sealed
 */
export type PlainOptions = typeof options;

/**
 * Gives the operator --plain, which turns the run's plain switch on, so nothing redraws: a
 * progress line prints plain lines, a streamed message is written a line at a time, and a
 * question asks line by line. Core turns the switch on for ACCESSIBLE too, with or without the
 * plugin, so the plugin takes no settings.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { plain } from '@loomcli/plugins/plain';
 *
 * export const app = new Application('notes', { plugins: [plain()] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/plain.md
 *
 * @public
 */
export function plain(): Plugin<PlainOptions> {
  return plugin(identity, { options });
}

// The plugin pack's member of MessagePackages, which this entry's declarations load.
export type {} from '../registry.js';
