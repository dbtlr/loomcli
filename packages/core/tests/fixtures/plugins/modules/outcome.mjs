/** An always-on wrapper that reports the outcome its own `next()` resolved. */
const middleware = async ({ next, out }) => {
  const outcome = await next();
  await out.print(`wrapper:${outcome}`);
};

export default middleware;
