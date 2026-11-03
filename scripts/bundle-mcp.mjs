import { fileURLToPath } from 'node:url';

import { build } from 'rolldown';

/*
 * Bundles the `mcp` subpath's server module, as tsc emitted it, in place. The plugin's entry loads it
 * when the `mcp` Command runs, so the protocol package loads only then.
 * It inlines the private protocol package `@loom/mcp`, which is never published, so the packed pack names no dependency on it.
 * `@loomcli/core`, the pack's other dependencies, and the pack's own modules stay external, so each extension descriptor and rule stays one module.
 */

const entry = fileURLToPath(new URL('../packages/plugins/dist/src/mcp/serve.js', import.meta.url));
const protocol = fileURLToPath(new URL('../packages/mcp/dist/', import.meta.url));

/** Whether a module belongs to the protocol package, by its specifier or by the module importing it. */
function isProtocol(id, importer) {
  return id === '@loom/mcp' || id.startsWith(protocol) || (importer?.startsWith(protocol) ?? false);
}

await build({
  external: (id, importer) => !isProtocol(id, importer),
  input: entry,
  output: { file: entry },
  platform: 'node',
});
