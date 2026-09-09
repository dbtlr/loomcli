import { mark } from '../mark.mjs';

/**
 * An always-on wrapper: it reports each outcome `next()` resolved and each failure it rejected
 * with, and its cleanup runs while the chain unwinds. The failure it caught is rethrown, so the
 * chain keeps reporting it.
 */
export function wrapper(label) {
  mark(`loaded:${label}`);
  return async ({ next, out }) => {
    await out.info(`${label}:start`);
    try {
      const outcome = await next();
      await out.info(`${label}:${outcome}`);
    } catch (error) {
      await out.info(`${label}:rejected:${error.message}`);
      throw error;
    } finally {
      await out.info(`${label}:cleanup`);
    }
  };
}
