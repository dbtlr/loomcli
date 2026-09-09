import { InputError } from '@loomcli/core';

/**
 * A failure thrown before `next()` settles resolves through the failure path with its class's exit
 * code. A throw after `next()` settled is a throw during unwinding: an internal error reported
 * after the primary outcome, which keeps its own code.
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
  throw new Error('the plugin failed while unwinding');
};

export default middleware;
