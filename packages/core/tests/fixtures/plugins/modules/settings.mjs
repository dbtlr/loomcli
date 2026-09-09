/**
 * Reports the option values this plugin's own declaration produced, then writes to the collection
 * it received, so a second run shows whether the declared default reached it afresh.
 */
const middleware = async ({ next, options, out }) => {
  await out.print(`settings:${JSON.stringify(options)}`);
  if (Array.isArray(options.tags)) {
    options.tags.push('written');
  }
  await next();
};

export default middleware;
