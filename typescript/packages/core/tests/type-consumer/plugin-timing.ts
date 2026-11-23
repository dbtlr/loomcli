import type { Middleware } from '@loomcli/core';

import type { timer } from './plugin-timer.js';

// Cleanup in `finally`, the outcome from `next()`, which is what an always-on wrapper reads.
const timing: Middleware<typeof timer> = async ({ next, out }) => {
  const started = Date.now();
  try {
    const outcome = await next();
    if (outcome === 'dispatched') {
      await out.info(`${String(Date.now() - started)} ms`);
    }
  } finally {
    await out.info('done');
  }
};

export default timing;
