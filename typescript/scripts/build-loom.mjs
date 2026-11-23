import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeNotices } from './bundle-notices.mjs';

/*
 * Builds the published `loom` bin with `loom build` itself, run from source under Bun, so the
 * toolchain ships as the distributed bundle every author's application ships as.
 * `loom build` bundles the entry and the application module. The processes `loom init` and
 * `loom build` start to read an application module each run one more module, which a plain Bun
 * build writes beside them.
 *
 * The bundle carries other packages' code, so their license notices must travel with it:
 * bundle-notices.mjs writes them and checks the loom package's license field against them.
 */

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const directory = join(repositoryRoot, 'packages/loom');

/** Runs Bun in the toolchain's package directory and stops the build when Bun fails. */
function bun(args) {
  const result = spawnSync('bun', args, { cwd: directory, stdio: 'inherit' });
  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
    console.error('Building the loom bin needs Bun on the PATH. Install it from https://bun.sh.');
    process.exit(1);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

bun(['src/main.ts', 'build', '--target', 'node']);
for (const reader of ['read-application', 'read-skills']) {
  bun(['build', `src/${reader}.ts`, '--target', 'bun', '--outfile', `dist/${reader}.js`]);
}

try {
  writeNotices(repositoryRoot);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
