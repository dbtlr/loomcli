import { fileURLToPath } from 'node:url';

/**
 * Bundles the application into one directory with the named bundler and no define, as an author's
 * build does with any bundler: `bun` runs `Bun.build` under Bun, and `rolldown` runs under Node.
 */
const [bundler, outdir] = process.argv.slice(2);
const entry = fileURLToPath(new URL('main.mjs', import.meta.url));
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
