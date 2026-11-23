/**
 * Catches what the rest of the chain raised and throws a failure of its own while unwinding, which
 * is the outcome the run reports.
 */
const middleware = async ({ next, out }) => {
  try {
    await next();
  } catch (error) {
    await out.info(`recatching:${error.sentence ?? error.message}`);
    throw new Error('the plugin failed after catching', { cause: error });
  }
};

export default middleware;
