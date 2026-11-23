/**
 * A middleware that catches what the rest of the chain raised and returns, so the outcome is its
 * own.
 */
const middleware = async ({ next, out }) => {
  try {
    const outcome = await next();
    await out.info(`catching:${outcome}`);
  } catch (error) {
    await out.info(`catching:caught:${error.sentence ?? error.message}`);
  }
};

export default middleware;
