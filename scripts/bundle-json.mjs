import { fileURLToPath } from 'node:url';

import { build } from 'rolldown';

/*
 * Bundles the configuration plugin's text module, as tsc emitted it, in place. It inlines the
 * private package `@loom/json`, which is never published, so the packed pack names no dependency on
 * it. The toolchain's own bundle inlines the same package when `loom build` bundles the loom bin.
 * Every other module stays external, so each module of the pack stays one module.
 */

const entry = fileURLToPath(
  new URL('../packages/plugins/dist/src/config/text.js', import.meta.url),
);
const shared = fileURLToPath(new URL('../packages/json/dist/', import.meta.url));

/** Whether a module belongs to the shared package, by its specifier or by the module importing it. */
function isShared(id, importer) {
  return id === '@loom/json' || id.startsWith(shared) || (importer?.startsWith(shared) ?? false);
}

await build({
  external: (id, importer) => !isShared(id, importer),
  input: entry,
  output: { file: entry },
  platform: 'node',
});
