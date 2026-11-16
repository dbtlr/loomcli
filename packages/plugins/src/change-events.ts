/*
 * The four change events every first-party plugin shares, under ADR-0165: one `info` log event for
 * each change a plugin makes outside the process. A plugin raises them through the `log` its
 * action, middleware, or `afterReplace` context already holds, so the event's `plugin` field tells
 * the plugins apart. A read and a failed change raise none, because core logs the failure itself.
 * The messages are records for a reader later, not operator sentences, so they live here and not in
 * a `messages.ts`.
 */
import type { Log } from '@loomcli/core';

/** The fields of a file a plugin wrote or removed: its absolute path. */
interface FileChange {
  readonly path: string;
}

/**
 * The fields of a child program that changed something: the program as the plugin starts it, the
 * words it passes, which never hold a secret, and the code it exited with that the plugin accepts.
 */
interface ProgramChange {
  readonly program: string;
  readonly arguments: readonly string[];
  readonly code: number;
}

/** The fields of the self-update rename: the recorded path, and the replaced and the new version. */
interface BinaryChange {
  readonly path: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Records a file created or rewritten, a startup file whose line changed and an installation
 * record file included.
 *
 * @example
 * ```ts
 * fileWritten(log, { path: '/home/me/.local/state/notes/installation/completion.bash.json' });
 * ```
 */
function fileWritten(log: Log, { path }: FileChange): void {
  log.info('File written.', { path });
}

/**
 * Records a file deleted, a leftover staging file included.
 *
 * @example
 * ```ts
 * fileRemoved(log, { path: '/home/me/.local/share/bash-completion/completions/notes' });
 * ```
 */
function fileRemoved(log: Log, { path }: FileChange): void {
  log.info('File removed.', { path });
}

/**
 * Records a child program that changed something, once it exits with a code the plugin accepts.
 *
 * @example
 * ```ts
 * programRun(log, { arguments: ['--user', 'daemon-reload'], code: 0, program: 'systemctl' });
 * ```
 */
function programRun(log: Log, { arguments: words, code, program }: ProgramChange): void {
  log.info('Program run.', { arguments: [...words], code, program });
}

/**
 * Records the self-update Command's rename over the recorded path.
 *
 * @example
 * ```ts
 * binaryReplaced(log, { from: '1.5.0', path: '/home/me/.local/bin/notes', to: '1.5.1' });
 * ```
 */
function binaryReplaced(log: Log, { from, path, to }: BinaryChange): void {
  log.info('Binary replaced.', { from, path, to });
}

export type { BinaryChange, FileChange, ProgramChange };
export { binaryReplaced, fileRemoved, fileWritten, programRun };
