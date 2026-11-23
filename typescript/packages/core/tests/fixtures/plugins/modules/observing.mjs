/**
 * Reports every global option value it received, or `null` when a global option was rejected, and
 * continues the chain, so a test reads what another plugin's options look like from here.
 */
const middleware = async ({ next, options, out }) => {
  await out.print(`observed:${JSON.stringify(options)}`);
  await next();
};

export default middleware;
