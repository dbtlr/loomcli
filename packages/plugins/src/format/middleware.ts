import type { Middleware } from '@loomcli/core';

import type { format } from './plugin.js';

/**
 * Copies a supplied `--format` into `view`. The option is hook-declared, so its value is unknown to
 * the types, and `ownOptions` holds it whenever it validated, a held fault on another input
 * included, so the selection stands for the failure too.
 */
const middleware: Middleware<typeof format> = async (context) => {
  const selected = context.ownOptions.format;
  if (context.view !== null && typeof selected === 'string') {
    context.view = selected;
  }
  await context.next();
};

export default middleware;
