import { fileURLToPath } from 'node:url';

import { packet } from '@loomcli/loom/build';

/**
 * Bundles the probe's two entries with `packet()` into the directory the first argument names,
 * and compiles its packed entry into a single binary there, as an application's build does.
 */
const [outdir] = process.argv.slice(2);
const source = (name) => fileURLToPath(new URL(`src/${name}`, import.meta.url));

const bundled = await Bun.build({
  entrypoints: [source('main.ts'), source('unpacked.ts')],
  outdir,
  plugins: [packet()],
  target: 'node',
});
const compiled = await Bun.build({
  compile: { outfile: `${outdir}/probe` },
  entrypoints: [source('main.ts')],
  plugins: [packet()],
});
if (!bundled.success || !compiled.success) {
  throw new AggregateError([...bundled.logs, ...compiled.logs], 'The probe did not build.');
}
