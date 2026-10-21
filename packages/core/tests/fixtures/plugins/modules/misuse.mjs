/**
 * The call the action reaches for, so a second call happens after this middleware returned, and
 * the late call a timer makes, which the action waits on so the run is still open when it lands.
 */
const stashed = { late: Promise.resolve(), next: undefined };

/**
 * Ways to misuse `next`: calling it twice while it is live, letting that second call's rejection
 * escape the middleware, leaving it unobserved, and calling it once the middleware has returned,
 * observed or from a timer no code observes. The mode arrives in the environment so one module
 * covers all of them.
 */
const middleware = async ({ next, out }) => {
  if (process.env.LOOM_FIXTURE_MISUSE === 'after-return') {
    stashed.next = next;
    const started = next();
    void started.catch(() => undefined);
    return;
  }
  if (process.env.LOOM_FIXTURE_MISUSE === 'late') {
    const started = next();
    void started.catch(() => undefined);
    stashed.late = new Promise((resolve) => {
      setTimeout(() => {
        // No code observes this call.
        next();
        resolve();
      }, 0);
    });
    return;
  }
  if (process.env.LOOM_FIXTURE_MISUSE === 'unawaited') {
    await next();
    // No code observes this call.
    next();
    return;
  }
  if (process.env.LOOM_FIXTURE_MISUSE === 'escaping') {
    await next();
    // Uncaught, so the rejection is this middleware's failure.
    await next();
    return;
  }
  await next();
  await next().catch((error) => out.info(`misuse:${error.sentence ?? error.message}`));
};

export default middleware;
export { stashed };
