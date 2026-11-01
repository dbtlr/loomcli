import { array, boolean, strictObject, string, union } from 'valibot';
import type { InferOutput } from 'valibot';

import { runReader } from './application-reader.js';
import type { RunHost } from './run-host.js';

/** The names a module exports its Application under. */
const names = array(string());

/**
 * What the read found: each name the module exports its one Application under, `default`
 * included; or why no Application could be read, a declaration fault's Developer Diagnostic
 * included, and whether the module loaded before the read stopped.
 */
const exportsResult = union([
  strictObject({ names }),
  strictObject({ failure: string(), loaded: boolean() }),
]);

/** One read of an application module, as the reading process writes it to its result file. */
export type ApplicationExports = InferOutput<typeof exportsResult>;

/**
 * Reads the exports of one application module under Bun, in a process of its own in the package
 * directory, as a build runs. `path` is absolute, resolved against the working directory before the
 * spawn, and `module` is the module as the operator reads it.
 */
export function readApplicationExports(
  run: RunHost,
  options: { directory: string; module: string; path: string },
): Promise<ApplicationExports> {
  return runReader(run, { ...options, reader: 'read-application' }, exportsResult);
}
