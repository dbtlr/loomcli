import { fileURLToPath } from 'node:url';

import { packet } from '@loomcli/loom/build';

/** A path under the application's package root, wherever the build is run from. */
const path = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

/**
 * Bundles jsonkit into `dist` with `packet()`, so the bundle reads a distributed packet while the
 * source keeps reading development. The application module is an entry of its own, which the tests
 * import to run jsonkit on a host of their choosing, and splitting keeps each plugin's middleware
 * in a chunk of its own that loads only when the chain reaches it.
 */
const result = await Bun.build({
  entrypoints: [path('src/main.ts'), path('src/application.ts')],
  outdir: path('dist'),
  plugins: [packet()],
  root: path('src'),
  splitting: true,
  target: 'node',
});
if (!result.success) {
  throw new AggregateError(result.logs, 'jsonkit did not build.');
}
