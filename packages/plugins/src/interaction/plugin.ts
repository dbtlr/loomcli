import { checkPluginSettings, plugin } from '@loomcli/core';
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
export interface InteractionSettings {
  readonly env?: string | readonly [string, ...string[]];
}
export type InteractionOptions = typeof options;

/** Lets the operator lower the run interaction decision with --no-input or a named variable. */
export function interaction(settings?: InteractionSettings): Plugin<InteractionOptions> {
  checkPluginSettings(settings, { call: 'interaction', plugin: identity });
  return plugin(identity, {
    options: {
      input: { ...options.input, ...(settings?.env === undefined ? {} : { env: settings.env }) },
    },
  });
}
