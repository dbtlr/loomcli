import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { runBun } from './bun.js';

/**
 * What the read found: each name the module exports its one Application under, `default`
 * included; or the one sentence that says why no Application could be read, and whether the module
 * loaded before the read stopped.
 */
const exportsResult = z.union([
  z.object({ names: z.string().array() }),
  z.object({ failure: z.string(), loaded: z.boolean() }),
]);

/** The script the reading process runs, shipped beside this module in `dist`. */
const script = fileURLToPath(new URL('../read-application.js', import.meta.url));

/** One read of an application module, as the reading process writes it to its result file. */
export type ApplicationExports = z.infer<typeof exportsResult>;

/**
 * Reads the exports of one application module under Bun, in a process of its own in the package
 * directory, as a build runs, so the package's own `bunfig.toml` applies from any working
 * directory. `path` is absolute, resolved against the working directory before the spawn. The
 * process writes its result to a file, so nothing the module prints while it loads can be mistaken
 * for the result. A process that ends without a result fails with what it wrote. Bun runs with
 * `--no-install`, because a package with no `node_modules` would otherwise resolve core and the
 * module's imports from Bun's global cache, which the package never installed.
 */
export function readApplicationExports(options: {
  directory: string;
  module: string;
  path: string;
}): ApplicationExports {
  const temporary = mkdtempSync(join(tmpdir(), 'loom-init-'));
  try {
    const resultFile = join(temporary, 'result.json');
    const run = runBun(
      ['--no-install', script, resultFile, options.directory, options.path, options.module],
      options.directory,
    );
    if (run.status !== 0 || !existsSync(resultFile)) {
      throw new Error(`${run.output.trim()}\n\nBun could not read ${options.module}.`.trim());
    }
    return exportsResult.parse(JSON.parse(readFileSync(resultFile, 'utf8')));
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}
