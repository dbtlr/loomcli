import { InputError } from '@loomcli/core';

/**
 * A failure thrown before `next()` settles resolves through the failure path with its class's exit
 * code. A throw after `next()` settled is a throw during unwinding, which is this middleware's
 * failure with its own class and code.
 */
const middleware = async ({ next, out }) => {
  const mode = process.env.LOOM_FIXTURE_THROW;
  if (mode === 'fatal') {
    out.fatal('the plugin stopped the invocation');
  }
  if (mode === 'usage') {
    throw new InputError('the plugin rejected the invocation', []);
  }
  const outcome = await next();
  await out.info(`throwing:${outcome}`);
  if (mode === 'unwind-usage') {
    throw new InputError('the plugin rejected the outcome', []);
  }
  throw new Error('the plugin failed while unwinding');
};

export default middleware;
