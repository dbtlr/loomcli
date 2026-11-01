import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BaseIssue, BaseSchema, InferOutput } from 'valibot';

import { runBun } from './bun.js';
import { parseOrThrow } from './parse-or-throw.js';
import type { RunHost } from './run-host.js';

/**
 * The child programs that load an application module under Bun: `loom init`'s read of its exports
 * and `loom build`'s read of its skills folder.
 */
type Reader = 'read-application' | 'read-skills';

/**
 * The script a reader runs. The build writes each into `dist` beside the bundle's modules, this one
 * included. A run of `loom` from its source, as the toolchain's own build and its tests make, has
 * no built script beside this module, so it runs the script's source, which Bun runs directly.
 */
function readerScript(reader: Reader): string {
  const built = fileURLToPath(new URL(`${reader}.js`, import.meta.url));
  return existsSync(built) ? built : fileURLToPath(new URL(`../${reader}.ts`, import.meta.url));
}

/** One read of an application module: the reader, the package directory, and the module. */
interface ReaderRequest {
  readonly reader: Reader;
  /** The package directory, where Bun runs, so the package's own `bunfig.toml` applies. */
  readonly directory: string;
  /** The module's absolute path, resolved against the working directory before the spawn. */
  readonly path: string;
  /** The module as the operator reads it, which the reader's sentences name. */
  readonly module: string;
}

/**
 * Runs a reader under Bun, in a process of its own in the package directory, and answers the result
 * it wrote, checked against the schema. The arguments name the result file, the package directory,
 * the module, and the module as the operator reads it. The process writes its result to a file, so
 * nothing the module prints while it loads can be mistaken for the result. A process that ends
 * without a result fails with what it wrote and `Bun could not read <module>.` Bun runs with
 * `--no-install`, because a package with no `node_modules` would otherwise resolve core and the
 * module's imports from Bun's global cache, which the package never installed. The result file
 * lives in a scratch folder under the run's temporary folder, removed once it is read or when a
 * shutdown ends before the run has unwound. A cancelled run fails with the signal's reason.
 */
async function runReader<Schema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(
  run: RunHost,
  request: ReaderRequest,
  schema: Schema,
): Promise<InferOutput<Schema>> {
  const temporary = mkdtempSync(join(run.host.tmpdir, `loom-${request.reader}-`));
  const removeTemporary = () => {
    rmSync(temporary, { force: true, recursive: true });
  };
  const removeCleanup = run.onShutdown(removeTemporary);
  try {
    const resultFile = join(temporary, 'result.json');
    const { directory, module, path } = request;
    const read = await runBun(
      run,
      ['--no-install', readerScript(request.reader), resultFile, directory, path, module],
      directory,
    );
    if (read.code !== 0 || !existsSync(resultFile)) {
      throw new Error(`${read.output.trim()}\n\nBun could not read ${module}.`.trim());
    }
    return parseOrThrow(schema, JSON.parse(readFileSync(resultFile, 'utf8')));
  } finally {
    removeCleanup();
    removeTemporary();
  }
}

export type { ReaderRequest };
export { runReader };
