/**
 * Returns synchronously after queueing its own `next()` as a microtask. `next` is live until the
 * middleware's own result settles, so the queued call lands first and continues the chain.
 */
const middleware = ({ next }) => {
  queueMicrotask(() => {
    void next().catch(() => undefined);
  });
};

export default middleware;
