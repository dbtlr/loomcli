import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import { packageName } from '../constants.js';

const identity = `${packageName}/color`;

const options = {
  color: {
    color: true,
    control: true,
    description: 'Turn color on or off, overriding NO_COLOR.',
    polarity: 'both',
    type: 'boolean',
  },
} satisfies PluginOptions;
/**
 * The options record `color()` declares: the global `--color` and `--no-color` pair.
 *
 * @public @sealed
 */
export type ColorOptions = typeof options;

/**
 * Gives the operator the standard --color and --no-color pair, which core reads as the run's color
 * choice right after host capture. The pair's spelling is the standard's, so it takes no settings.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { color } from '@loomcli/plugins/color';
 *
 * export const app = new Application('notes', { plugins: [color()] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/color.md
 *
 * @public
 */
export function color(): Plugin<ColorOptions> {
  return plugin(identity, { options });
}
