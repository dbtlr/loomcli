/** The call a later plugin reaches for, so a second call happens after this middleware returned. */
const stashed = { next: undefined };

/** Takes over the invocation by returning without calling `next()`, keeping its own call. */
const middleware = async ({ next, out }) => {
  stashed.next = next;
  await out.info('stashing:taken-over');
};

export default middleware;
export { stashed };
