import { fileURLToPath } from 'node:url';

/**
 * Bundles one fixture under `fixtures` into `outdir` with `Bun.build`, the release facts JSON a test
 * names baked into `__LOOM_RELEASE__` through a define, as `loom build` bakes them. A test bakes any
 * value this way, a malformed one included, which `loom build` never writes; the loom package's
 * process tests prove the facts `loom build` itself bakes, a compiled binary's included.
 */
const [entry, outdir, facts] = process.argv.slice(2);
const define = facts === '' ? {} : { __LOOM_RELEASE__: facts };
const entrypoints = [fileURLToPath(new URL(`../${entry}`, import.meta.url))];
const result = await Bun.build({ define, entrypoints, outdir, target: 'node' });
if (!result.success) {
  throw new AggregateError(result.logs, `Bun did not bundle ${entry}.`);
}
