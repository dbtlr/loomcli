import { fileURLToPath } from 'node:url';

/**
 * Bundles the release facts probe into `release-dist` with `Bun.build`, baking the facts of a
 * distributed build into the packed core through the `__LOOM_RELEASE__` define, as `loom build`
 * bakes them.
 */
const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const result = await Bun.build({
  define: { __LOOM_RELEASE__: JSON.stringify({ build: 'distributed' }) },
  entrypoints: [path('release.ts')],
  outdir: path('release-dist'),
  target: 'node',
});
if (!result.success) {
  throw new AggregateError(result.logs, 'The release facts probe did not build.');
}
