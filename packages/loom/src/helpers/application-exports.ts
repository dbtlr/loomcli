import { array, boolean, strictObject, string, union } from 'valibot';
import type { InferOutput } from 'valibot';

import { loadFailure, threw } from './application-load-failure.js';
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

/** What the reading process writes to its result file: the read, or the reason the module threw. */
const readResult = union([exportsResult, threw]);

/** One read of an application module, a throw while it loaded formatted as its diagnostic. */
export type ApplicationExports = InferOutput<typeof exportsResult>;

/** One read of an application module, as the reading process writes it to its result file. */
export type ApplicationRead = InferOutput<typeof readResult>;

/**
 * Reads the exports of one application module under Bun, in a process of its own in the package
 * directory, as a build runs. `path` is absolute, resolved against the working directory before the
 * spawn, and `module` is the module as the operator reads it. A module that threw while it loaded
 * reads as the failure `@loomcli/loom/application-load-failed` names.
 */
export async function readApplicationExports(
  run: RunHost,
  options: { directory: string; module: string; path: string },
): Promise<ApplicationExports> {
  const result = await runReader(run, { ...options, reader: 'read-application' }, readResult);
  return 'threw' in result
    ? { failure: loadFailure(options.module, result.threw), loaded: false }
    : result;
}
