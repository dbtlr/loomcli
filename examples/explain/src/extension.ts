import { extension } from '@loomcli/core';
import { z } from 'zod';

import Package from '../package.json' with { type: 'json' };

/**
 * The explanation one Command declaration carries. It is declarations alone, so an application that
 * installs no explain plugin still compiles against it and a projection reads the value without
 * importing the plugin's middleware.
 */
const examples = z.array(z.string());

export const explainCommand = extension(`${Package.name}/command`, {
  schema: z.object({ details: z.string(), examples: examples.optional() }),
  target: 'command',
});
