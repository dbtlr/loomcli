/**
 * Catches what the rest of the chain raised and throws a failure of its own while unwinding. The
 * two are different values, so the recorded failure still decides the exit code and this throw is
 * an internal error reported after it.
 */
const middleware = async ({ next, out }) => {
  try {
    await next();
  } catch (error) {
    await out.info(`recatching:${error.message}`);
    throw new Error('the plugin failed after catching', { cause: error });
  }
};

export default middleware;
