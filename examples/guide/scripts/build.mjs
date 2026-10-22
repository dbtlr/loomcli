import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { snapshotNames } from './snapshots.mjs';

/**
 * Compiles every chapter snapshot under `src/` as its own TypeScript project, so a new chapter
 * directory with a `tsconfig.json` builds without an edit here. Output lands in
 * `dist/src/<chapter>/`.
 */
const require = createRequire(import.meta.url);
const typescript = require('typescript/package.json');
const compiler = join(dirname(require.resolve('typescript/package.json')), typescript.bin.tsc);
const source = new URL('../src/', import.meta.url);

const success = 0;
const failed = [];
for (const name of await snapshotNames(source)) {
  const project = fileURLToPath(new URL(`${name}/tsconfig.json`, source));
  const result = spawnSync(process.execPath, [compiler, '-p', project], { stdio: 'inherit' });
  if (result.status !== success) {
    failed.push(name);
  }
}
if (failed.length > success) {
  throw new Error(`The guide snapshots that failed to compile: ${failed.join(', ')}.`);
}
