import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import { packageName } from '../constants.js';

const identity = `${packageName}/interaction`;

const options = {
  input: {
    control: true,
    description: 'Ask no questions, and take every answer from options.',
    interaction: true,
    polarity: 'negative',
    type: 'boolean',
  },
} satisfies PluginOptions;
/**
 * What an application tells the interaction plugin: the variables that lower interaction.
 *
 * @public
 */
export interface InteractionSettings {
  /**
   * A variable, or an ordered list of variables, that lowers the interaction decision when it is
   * set and not empty. None by default.
   */
  readonly env?: string | readonly [string, ...string[]];
}
/**
 * The options record `interaction()` declares: the global `--no-input` option.
 *
 * @public @sealed
 */
export type InteractionOptions = typeof options;

/**
 * Lets the operator lower the run interaction decision with --no-input or a named variable.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { interaction } from '@loomcli/plugins/interaction';
 *
 * export const app = new Application('notes', { plugins: [interaction({ env: 'NOTES_INPUT' })] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/interaction.md
 *
 * @public
 */
export function interaction(settings?: InteractionSettings): Plugin<InteractionOptions> {
  return plugin(identity, {
    options: {
      input: { ...options.input, ...(settings?.env === undefined ? {} : { env: settings.env }) },
    },
  });
}
