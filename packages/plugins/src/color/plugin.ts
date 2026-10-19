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
export type ColorOptions = typeof options;

/**
 * Gives the operator the standard --color and --no-color pair, which core reads as the run's color
 * choice right after host capture. The pair's spelling is the standard's, so it takes no settings.
 */
export function color(): Plugin<ColorOptions> {
  return plugin(identity, { options });
}
