import { stashed } from './stashing.mjs';

/**
 * Calls the `next` a later middleware kept, once that middleware has returned and while the run is
 * still live. The call is no longer live, so it continues nothing and rejects.
 */
const middleware = async ({ next, out }) => {
  const outcome = await next();
  await out.info(`caller:${outcome}`);
  await stashed.next().catch((error) => out.info(`caller:${error.message}`));
};

export default middleware;
