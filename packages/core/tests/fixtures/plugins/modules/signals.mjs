/** Reports the run's cancellation signal, which nothing aborts without a caller or a slot owner. */
const middleware = async ({ next, out, signal }) => {
  await out.print(`middleware-signal:${signal instanceof AbortSignal}:${signal.aborted}`);
  await next();
};

export default middleware;
