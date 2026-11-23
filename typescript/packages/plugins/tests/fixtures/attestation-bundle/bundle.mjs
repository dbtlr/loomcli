import { fileURLToPath } from 'node:url';

/**
 * Bundles one of this folder's applications into a directory with the named bundler, as an
 * author's build does: `bun` runs `Bun.build` under Bun, and `rolldown` runs under Node.
 */
const [bundler, name, outdir] = process.argv.slice(2);
const entry = fileURLToPath(new URL(`${name}.mjs`, import.meta.url));
if (bundler === 'bun') {
  const result = await Bun.build({ entrypoints: [entry], outdir, target: 'node' });
  if (!result.success) {
    throw new AggregateError(result.logs, 'Bun did not bundle the application.');
  }
} else if (bundler === 'rolldown') {
  const { build } = await import('rolldown');
  await build({ input: entry, output: { dir: outdir }, platform: 'node' });
} else {
  throw new Error(`No bundler is named "${bundler}".`);
}
