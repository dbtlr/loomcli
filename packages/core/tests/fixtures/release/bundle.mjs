import { fileURLToPath } from 'node:url';

/**
 * Bundles one fixture under `fixtures` into `outdir` with `Bun.build`, the release facts JSON a test
 * names baked into `__LOOM_RELEASE__` through a define, as `loom build` bakes them. A `--compile`
 * path compiles a binary for the host instead.
 */
const [entry, outdir, facts, compile] = process.argv.slice(2);
const define = facts === '' ? {} : { __LOOM_RELEASE__: facts };
const entrypoints = [fileURLToPath(new URL(`../${entry}`, import.meta.url))];
const result = await Bun.build(
  compile === undefined
    ? { define, entrypoints, outdir, target: 'node' }
    : { compile: { outfile: compile }, define, entrypoints },
);
if (!result.success) {
  throw new AggregateError(result.logs, `Bun did not bundle ${entry}.`);
}
