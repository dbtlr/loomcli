import { extension } from '@loomcli/core';
import { z } from 'zod';

import { packageName } from './constants.js';

/**
 * The explanation one Command declaration carries. It is declarations alone, so an application that
 * installs no explain plugin still compiles against it and a projection reads the value without
 * importing the plugin's middleware.
 */
const examples = z.array(z.string());

export const explainCommand = extension(`${packageName}/command`, {
  schema: z.object({ details: z.string(), examples: examples.optional() }),
  target: 'command',
});
