import { callerReason, controller } from '../caller.mjs';

/**
 * Announces that it ran, cancels the run from inside the chain, and then either takes over by
 * returning or continues with `next()`. A chain that reaches this entry after cancellation never
 * calls it, so the absence of its line is what a skipped entry looks like.
 */
const middleware = async ({ next, out }) => {
  await out.print('middleware:ran');
  controller.abort(callerReason);
  if (process.env.LOOM_FIXTURE_CANCEL === 'continue') {
    await next();
  }
};

export default middleware;
