/**
 * The moment-of-signal work a slot owner does: a synchronous listener on the run's own signal,
 * added before the chain continues, so it runs even when the action ignores the abort.
 */
const middleware = async ({ next, signal }) => {
  signal.addEventListener('abort', () => {
    process.stdout.write(`aborted:${signal.reason.source}\n`);
  });
  await next();
};

export default middleware;
