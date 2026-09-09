/**
 * A middleware that catches what the rest of the chain raised and returns. Its own control flow
 * changes; the exit code stays the recorded failure's.
 */
const middleware = async ({ next, out }) => {
  try {
    const outcome = await next();
    await out.info(`catching:${outcome}`);
  } catch (error) {
    await out.info(`catching:caught:${error.message}`);
  }
};

export default middleware;
