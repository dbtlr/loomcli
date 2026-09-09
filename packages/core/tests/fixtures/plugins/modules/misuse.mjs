/** The call the action reaches for, so a second call happens after this middleware returned. */
const stashed = { next: undefined };

/**
 * Two ways to misuse `next`: calling it twice while it is live, and calling it once the middleware
 * has returned. The mode arrives in the environment so one module covers both.
 */
const middleware = async ({ next, out }) => {
  if (process.env.LOOM_FIXTURE_MISUSE === 'after-return') {
    stashed.next = next;
    const started = next();
    void started.catch(() => undefined);
    return;
  }
  await next();
  await next().catch((error) => out.info(`misuse:${error.message}`));
};

export default middleware;
export { stashed };
