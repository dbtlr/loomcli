/**
 * Reports the global option values it received, then whether the collection it received is frozen,
 * so a test shows that a middleware reads a copy and contributes nothing to what the action reads.
 */
const middleware = async ({ next, options, out }) => {
  await out.print(`settings:${JSON.stringify(options)}`);
  if (Array.isArray(options?.tags)) {
    await out.print(`frozen:${Object.isFrozen(options) && Object.isFrozen(options.tags)}`);
  }
  await next();
};

export default middleware;
