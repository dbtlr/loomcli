/** The call the action reaches for, so a second call happens after this middleware returned. */
const stashed = { next: undefined };

/**
 * Three ways to misuse `next`: calling it twice while it is live, letting that second call's
 * rejection escape the middleware, and calling it once the middleware has returned. The mode
 * arrives in the environment so one module covers all of them.
 */
const middleware = async ({ next, out }) => {
  if (process.env.LOOM_FIXTURE_MISUSE === 'after-return') {
    stashed.next = next;
    const started = next();
    void started.catch(() => undefined);
    return;
  }
  if (process.env.LOOM_FIXTURE_MISUSE === 'escaping') {
    await next();
    // Uncaught, so the same recorded fault reaches core a second time as this middleware's throw.
    await next();
    return;
  }
  await next();
  await next().catch((error) => out.info(`misuse:${error.message}`));
};

export default middleware;
export { stashed };
