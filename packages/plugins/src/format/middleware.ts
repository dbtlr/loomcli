import type { Middleware } from '@loomcli/core';

import type { format } from './plugin.js';

const middleware: Middleware<typeof format> = async (context) => {
  const selected = context.request?.options.format;
  if (context.view !== null && typeof selected === 'string') {
    context.view = selected;
  }
  await context.next();
};

export default middleware;
