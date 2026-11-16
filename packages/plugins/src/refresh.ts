/*
 * The `afterReplace` refresh the installing plugins share: a replaced process holds the old
 * version's files, so it runs the new binary with the plugin's `update` words, as a child program
 * through the run's `host.spawn`, and passes the child's output through. The skills, completion,
 * and manpage plugins each call it with their words, their record files, and their sentences. When
 * the installation record holds none of the plugin's files it starts no child. A child that exits 0
 * records `Program run.`, and one that fails or cannot start adds a `warn` log event and resolves,
 * because the binary update succeeded. At `-v` it names a refresh that ran and at `-vv` one that
 * did not, through the context's `out`.
 */
import { basename } from 'node:path';

import { applicationDirectory, escapeControlCharacters } from '@loomcli/core';
import type { Host, Log, Out } from '@loomcli/core';

import { programRun } from './change-events.js';
import { exists } from './installation/disk.js';
import { pluginFilePath } from './installation/record.js';
import { say } from './lane-writes.js';

/**
 * What a refresh reads from a self-update's `afterReplace` context.
 *
 * @public
 */
interface RefreshContext {
  /** The binary that replaced this one. */
  readonly path: string;
  /** The run's host. */
  readonly host: Host;
  /** The run signal. */
  readonly signal: AbortSignal;
  /** The run's log. */
  readonly log: Log;
  /**
   * The application's name, which finds the installation record. Without it, the refresh always
   * runs the new binary.
   */
  readonly name?: string;
  /** Where the refresh writes its `-v` and `-vv` lines. Without it, the refresh writes none. */
  readonly out?: Pick<Out, 'debug' | 'trace'>;
}

/**
 * What one plugin's refresh runs and says: the words the new binary runs with, the names of the
 * plugin's files in the installation record, the `warn` log event's message, the line a child that
 * cannot start leaves for the operator, from the binary's path and its name, each escaped, and its
 * `-v` and `-vv` lines.
 */
interface Refresh {
  readonly words: readonly string[];
  readonly records: readonly string[];
  readonly warning: string;
  readonly notStarted: (path: string, name: string) => string;
  readonly refreshed: string;
  readonly skipped: string;
}

/** The code of a child that succeeded. */
const succeeded = 0;

/** The text of an error the log event carries. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether the installation record holds none of the plugin's files, read only by whether each
 * exists. A context without a name, a record directory that does not resolve, or one that cannot be
 * read, is not known to hold none.
 */
function nothingInstalled({ host, name }: RefreshContext, records: readonly string[]): boolean {
  if (name === undefined) {
    return false;
  }
  const directory = applicationDirectory('installation', name, host);
  if ('variable' in directory) {
    return false;
  }
  try {
    return !records.some((record) => exists(pluginFilePath(directory.path, record)));
  } catch {
    // The child reads the record itself and reports what it finds there.
    return false;
  }
}

/**
 * Runs the new binary with the refresh's words, the host's environment and working directory, no
 * input, and its output piped into the host's streams as `Writable`s, so the child reads neither as
 * a terminal. A record that holds none of the plugin's files starts no child. A child that exits 0
 * records the run; one that fails adds the `warn` event with its code, and one that cannot start
 * writes the refresh's line to the host's stderr and adds the event with its error; either way it
 * resolves.
 */
async function refreshByRunning(context: RefreshContext, refresh: Refresh): Promise<void> {
  const { host, path, signal } = context;
  if (nothingInstalled(context, refresh.records)) {
    await say(context.out?.trace(refresh.skipped));
    return;
  }
  const answer = await host.spawn(path, refresh.words, {
    signal,
    stderr: host.stderr,
    stdout: host.stdout,
  }).exited;
  await settle(context, refresh, answer);
}

/** What the child's `exited` settled with. */
type Answer = Awaited<ReturnType<Host['spawn']>['exited']>;

/**
 * Records and names a child that exited 0; adds the `warn` event with the code of one that failed,
 * and writes the refresh's line to the host's stderr and adds the event with the error of one that
 * could not start.
 */
async function settle(context: RefreshContext, refresh: Refresh, answer: Answer): Promise<void> {
  const { host, log, path } = context;
  if (answer.kind === 'exited' && answer.code === succeeded) {
    await refreshed(context, refresh);
    return;
  }
  if (answer.kind === 'exited') {
    log.warn(refresh.warning, { code: answer.code, path });
    return;
  }
  const name = escapeControlCharacters(basename(path));
  host.stderr.write(refresh.notStarted(escapeControlCharacters(path), name));
  log.warn(refresh.warning, { error: errorText(answer.error), path });
}

/** Records the child that exited 0 as a program run, and names the refresh at `-v`. */
async function refreshed(context: RefreshContext, refresh: Refresh): Promise<void> {
  const { log, out, path } = context;
  programRun(log, { arguments: refresh.words, code: succeeded, program: path });
  await say(out?.debug(refresh.refreshed));
}

export type { RefreshContext };
export { refreshByRunning };
