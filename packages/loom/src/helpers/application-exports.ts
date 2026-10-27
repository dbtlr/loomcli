import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  array,
  boolean,
  exactOptional,
  object,
  strictObject,
  string,
  tupleWithRest,
  union,
} from 'valibot';
import type { InferOutput } from 'valibot';

import { runBun } from './bun.js';
import { parseOrThrow } from './parse-or-throw.js';
import type { RunHost } from './run-host.js';

/** The names a module exports its Application under. */
const names = array(string());

/** The post-install command's words, which hold at least one. */
const words = tupleWithRest([string()], string());

/** The post-install declaration as the Application's graph carries it. */
const postInstall = object({
  command: exactOptional(words),
  message: exactOptional(string()),
});

/**
 * What the build of the Application's graph found: its post-install declaration, absent where it
 * declares none; the Developer Diagnostic of the declaration fault the build raised; or why the
 * build failed otherwise.
 */
const graphRead = union([
  strictObject({ fault: string() }),
  strictObject({ failure: string() }),
  object({ postInstall: exactOptional(postInstall) }),
]);

/**
 * What the read found: each name the module exports its one Application under, `default`
 * included, and what the build of its graph found; the Developer Diagnostic of a declaration fault
 * the module threw while it loaded; or the one sentence that says why no Application could be read,
 * and whether the module loaded before the read stopped.
 */
const exportsResult = union([
  strictObject({ graph: graphRead, names }),
  strictObject({ fault: string() }),
  strictObject({ failure: string(), loaded: boolean() }),
]);

/** The script the reading process runs, shipped beside this module in `dist`. */
const script = fileURLToPath(new URL('../read-application.js', import.meta.url));

/** One read of an application module, as the reading process writes it to its result file. */
export type ApplicationExports = InferOutput<typeof exportsResult>;

/** What the build of the Application's graph found, once its post-install declaration is read. */
export type GraphRead = InferOutput<typeof graphRead>;

/**
 * Reads the exports of one application module under Bun, in a process of its own in the package
 * directory, as a build runs, so the package's own `bunfig.toml` applies from any working
 * directory. `path` is absolute, resolved against the working directory before the spawn. The
 * process writes its result to a file, so nothing the module prints while it loads can be mistaken
 * for the result. A process that ends without a result fails with what it wrote. Bun runs with
 * `--no-install`, because a package with no `node_modules` would otherwise resolve core and the
 * module's imports from Bun's global cache, which the package never installed. The result file lives
 * in a scratch folder under the run's temporary folder, removed once it is read or when a shutdown
 * ends before the run has unwound. A cancelled run fails with the signal's reason.
 */
export async function readApplicationExports(
  run: RunHost,
  options: { directory: string; module: string; path: string },
): Promise<ApplicationExports> {
  const temporary = mkdtempSync(join(run.host.tmpdir, 'loom-init-'));
  const removeTemporary = () => {
    rmSync(temporary, { force: true, recursive: true });
  };
  const removeCleanup = run.onShutdown(removeTemporary);
  try {
    const resultFile = join(temporary, 'result.json');
    const read = await runBun(
      run,
      ['--no-install', script, resultFile, options.directory, options.path, options.module],
      options.directory,
    );
    if (read.code !== 0 || !existsSync(resultFile)) {
      throw new Error(`${read.output.trim()}\n\nBun could not read ${options.module}.`.trim());
    }
    return parseOrThrow(exportsResult, JSON.parse(readFileSync(resultFile, 'utf8')));
  } finally {
    removeCleanup();
    removeTemporary();
  }
}
