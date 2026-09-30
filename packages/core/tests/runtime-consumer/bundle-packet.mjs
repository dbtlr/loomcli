import { fileURLToPath } from 'node:url';

import { plugins } from './dist/packet.js';

/**
 * Bundles the packet fixture with the compiled consumer's `packet()` into `packet-dist`, as an
 * application's build does. It runs under Bun, because `packet()` is a `Bun.build` plugin.
 */
const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const result = await Bun.build({
  entrypoints: [path('packet-app/src/main.ts')],
  outdir: path('packet-dist'),
  plugins,
  target: 'node',
});
if (!result.success) {
  throw new AggregateError(result.logs, 'The packet fixture did not build.');
}
