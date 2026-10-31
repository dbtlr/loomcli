import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/*
 * Builds the published `loom` bin with `loom build` itself, run from source under Bun, so the
 * toolchain ships as the distributed bundle every author's application ships as.
 * `loom build` bundles the entry and the application module. The process `loom init` starts to read
 * an application module runs one more module, which a second, plain Bun build writes beside them.
 */

const directory = fileURLToPath(new URL('../packages/loom/', import.meta.url));

/** Runs Bun in the toolchain's package directory and stops the build when Bun fails. */
function bun(args) {
  const result = spawnSync('bun', args, { cwd: directory, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

bun(['src/main.ts', 'build', '--target', 'node']);
bun([
  'build',
  'src/read-application.ts',
  '--target',
  'bun',
  '--outfile',
  'dist/read-application.js',
]);
