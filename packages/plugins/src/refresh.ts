/*
 * The `afterReplace` refresh the installing plugins share: a replaced process holds the old
 * version's files, so it runs the new binary with the plugin's `update` words, through the pack's
 * one way to run a child, and passes the child's output through. The skills, completion, and
 * manpage plugins each call it with their words and sentences. A child that fails or cannot start
 * adds a `warn` log event and resolves, because the binary update succeeded.
 */
import { basename } from 'node:path';

import { escapeControlCharacters } from '@loomcli/core';
import type { Host, Log } from '@loomcli/core';

import { runChild } from './child.js';

/** What a refresh reads from a self-update's `afterReplace` context. */
interface RefreshContext {
  /** The binary that replaced this one. */
  readonly path: string;
  /** The run's host. */
  readonly host: Host;
  /** The run signal. */
  readonly signal: AbortSignal;
  /** The run's log. */
  readonly log: Log;
}

/**
 * What one plugin's refresh runs and says: the words the new binary runs with, the `warn` log
 * event's message, and the line a child that cannot start leaves for the operator, from the
 * binary's path and its name, each escaped.
 */
interface Refresh {
  readonly words: readonly string[];
  readonly warning: string;
  readonly notStarted: (path: string, name: string) => string;
}

/** The code of a child that succeeded. */
const succeeded = 0;

/** The text of an error the log event carries. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the new binary with the refresh's words, the host's environment and working directory, and
 * its output piped into the host's streams. A child that fails adds the `warn` event with its code,
 * and one that cannot start writes the refresh's line to the host's stderr and adds the event with
 * its error; either way it resolves.
 */
async function refreshByRunning(context: RefreshContext, refresh: Refresh): Promise<void> {
  const { host, log, path, signal } = context;
  const answer = await runChild({
    cwd: host.cwd,
    env: host.env,
    program: path,
    signal,
    stderr: host.stderr,
    stdout: host.stdout,
    words: refresh.words,
  });
  if (answer.kind === 'exited' && answer.code === succeeded) {
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

export type { RefreshContext };
export { refreshByRunning };
