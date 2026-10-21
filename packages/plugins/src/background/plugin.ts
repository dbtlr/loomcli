import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';
import { createValidator } from '@loomcli/validators';

import { packageName } from '../constants.js';

const identity = `${packageName}/background`;

const backgrounds = ['dark', 'light'] as const;

/** `dark` or `light`, with the sentence that names both. */
const backgroundInput = createValidator({
  inputSchema: { type: 'string', enum: [...backgrounds] },
  parse: (raw) => {
    const match = backgrounds.find((each) => each === raw);
    return match === undefined
      ? { issues: [{ message: 'Supply dark or light.' }] }
      : { value: match };
  },
});

const options = {
  background: {
    background: true,
    control: true,
    description: 'Pick colors for this terminal background instead of detecting it.',
    type: 'string',
    validate: backgroundInput,
  },
} satisfies PluginOptions;
export type BackgroundOptions = typeof options;

/**
 * Gives the operator --background=dark|light, which core reads as the run's background choice
 * right after host capture. Its mark also makes core detect the background when no theme entry
 * adapts, so an application whose own code reads the background installs it. It takes no settings.
 */
export function background(): Plugin<BackgroundOptions> {
  return plugin(identity, { options });
}
