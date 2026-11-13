/// <reference types="node" preserve="true" />
import type { Readable, Writable } from 'node:stream';

import type { ExitCode } from '../application/types.js';
import type { ReleaseFacts } from '../shipping/types.js';
import type { Background } from './background.js';

/**
 * The facts of one input stream of the run, as the process handle reports them.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/host.md#host-facts
 * @public
 */
export interface InputTerminal {
  /** Whether the stream is attached to a terminal. A pipe or a file reads `false`. */
  isTTY: boolean;
}

/**
 * The facts of one output stream of the run: whether it is a terminal and its size.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/host.md#host-facts
 * @public
 */
export interface OutputTerminal extends InputTerminal {
  /** The width in terminal cells, or `undefined` when the stream is no terminal or reports none. */
  columns: number | undefined;
  /** The height in terminal rows, or `undefined` when the stream is no terminal or reports none. */
  rows: number | undefined;
}

/**
 * The run's terminal facts: each stream's kind, the output streams' live width and height, and the
 * run's background, the one fact core settles rather than captures. It reads `undefined` until it
 * settles, when no source settled it, and in an invocation by name.
 *
 * @public
 */
export interface HostTerminal {
  /** The terminal facts of the run's stdin. */
  stdin: InputTerminal;
  /** The terminal facts of the run's stdout, with its live width and height. */
  stdout: OutputTerminal;
  /** The terminal facts of the run's stderr, with its live width and height. */
  stderr: OutputTerminal;
  /** The terminal's background, light or dark, once it settles; `undefined` until then. */
  readonly background: Background | undefined;
}

/**
 * A signal a signal source delivers and raises.
 *
 * @public
 */
export type ProcessSignal = 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGTERM' | 'SIGTSTP' | 'SIGCONT';

/**
 * A listener for one signal source event: the `exit` event passes the exit code, a signal nothing.
 *
 * @public
 */
export type SignalListener<Event extends ProcessSignal | 'exit'> = Event extends 'exit'
  ? (code: number) => void
  : () => void;

/**
 * Where a run's signals come from and where core raises them: the real process's own, which every
 * handle `processHandle` builds shares, or a source a handle holds of its own.
 *
 * @public
 */
export interface SignalSource {
  /** The stdin of the terminal this source's process is attached to, or `undefined` for none. */
  readonly terminal: Readable | undefined;
  /** Adds a listener for a signal or for the `exit` event of this source. */
  on<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>): void;
  /** Removes a listener added with `on`. */
  off<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>): void;
  /** Delivers the signal to this source's process. */
  raise(signal: ProcessSignal): void;
}

/**
 * The terminal facts of a process handle's streams. Output `columns` and `rows` may be getters,
 * which core reads live. A stated `background` settles the run's background, with no query.
 *
 * @public
 */
export interface ProcessTerminal {
  /** The terminal facts of the handle's stdin. */
  readonly stdin: InputTerminal;
  /** The terminal facts of the handle's stdout, which may read its width live. */
  readonly stdout: OutputTerminal;
  /** The terminal facts of the handle's stderr, which may read its width live. */
  readonly stderr: OutputTerminal;
  /**
   * The terminal's background, when the handle states it; a stated one settles the run's background
   * with no query.
   */
  readonly background?: Background | undefined;
}

/**
 * Where one child program runs and what it reads and writes. `cwd` and `env` default to the run's;
 * a relative `cwd` resolves against the run's, and a supplied `env` is the child's whole
 * environment. An attached child takes `input`, its whole stdin, or `stdin: 'inherit'`, the run's
 * own, never both; each of `stdout` and `stderr` is captured when omitted. A detached child starts
 * in a process group of its own with every stream ignored, and nothing in the run ends it.
 *
 * @public
 */
export type SpawnOptions = {
  /** The run's `cwd` when omitted; a relative path resolves against it. */
  readonly cwd?: string;
  /** The run's `env` when omitted, replaced whole when given. */
  readonly env?: Readonly<Record<string, string | undefined>>;
} & (
  | ({
      readonly detached?: false;
      /** `capture` when omitted. */
      readonly stdout?: 'capture' | 'ignore' | 'inherit' | Writable;
      /** `capture` when omitted. */
      readonly stderr?: 'capture' | 'ignore' | 'inherit' | Writable;
      /** An abort ends the child with `SIGTERM`. */
      readonly signal?: AbortSignal;
    } & (
      | {
          /** Written to the child's stdin, which then ends; an empty stdin when omitted. */
          readonly input?: string | Uint8Array;
          readonly stdin?: never;
        }
      | {
          /** The run's own stdin. */
          readonly stdin: 'inherit';
          readonly input?: never;
        }
    ))
  | { readonly detached: true }
);

/**
 * What a child wrote to one captured stream: empty for a stream that was not captured.
 *
 * @public
 */
export interface ChildOutput {
  /** The bytes the child wrote to the stream. */
  readonly bytes: Uint8Array;
  /** The bytes decoded as UTF-8. */
  readonly text: string;
}

/**
 * How a child ended: its exit code, 128 plus the signal's number for a child a signal ended, and
 * its captured output; or that it never started, because no program answered to the command or
 * the runtime refused it, with the runtime's error.
 *
 * @public
 */
export type ChildExit =
  | {
      readonly kind: 'exited';
      readonly code: number;
      readonly stdout: ChildOutput;
      readonly stderr: ChildOutput;
    }
  | { readonly kind: 'unstarted'; readonly error: Error };

/**
 * A child program a run started.
 *
 * @public
 */
export interface Child {
  /** Resolves once the child has ended and its streams have closed; it never rejects. */
  readonly exited: Promise<ChildExit>;
  /**
   * Delivers a signal to the child, `SIGTERM` when omitted, or `SIGKILL`, which the child cannot
   * handle; does nothing once it has exited.
   */
  kill(signal?: ProcessSignal | 'SIGKILL'): void;
}

/**
 * Every process fact a run reads and every process effect it makes. A run binds one at entry and
 * never replaces it, and core copies its facts into the run's host.
 *
 * @public
 */
export interface ProcessHandle {
  /** The command-line words after the program, as the operator typed them. */
  readonly argv: readonly string[];
  /** The words that start the application again: the runtime and script prefix `argv` omits. */
  readonly program: readonly string[];
  /** The process's environment variables. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The working directory, which throws when it cannot be read. */
  cwd(): string;
  /** The operator's home folder. */
  readonly home: string;
  /** The folder for temporary files. */
  readonly tmpdir: string;
  /**
   * The process's operating system, as `process.platform` names it, such as `linux` or `darwin`.
   */
  readonly platform: string;
  /** The process's CPU architecture, such as `x64` or `arm64`. */
  readonly arch: string;
  /** `glibc` or `musl` on Linux, and `undefined` elsewhere. */
  readonly libc: 'glibc' | 'musl' | undefined;
  /** The process's user ID, or `undefined` on a runtime with none. */
  readonly uid: number | undefined;
  /** The operator's IANA time zone, such as `America/New_York`. */
  readonly timeZone: string;
  /** The release facts of the running build, which tell a source run from a shipped binary. */
  readonly release: ReleaseFacts;
  /** Reads one source file for a defect report, or answers `undefined`. */
  readonly readSource?: (path: string, cwd: string) => string | undefined;
  /** The stream the run reads its stdin from. */
  readonly stdin: Readable;
  /** The stream the run writes its results to. */
  readonly stdout: Writable;
  /** The stream the run writes diagnostics and progress to. */
  readonly stderr: Writable;
  /** The terminal facts of the handle's three streams. */
  readonly terminal: ProcessTerminal;
  /** Where the run's signals come from and where core raises them. */
  readonly signals: SignalSource;
  /**
   * Starts one child program. Core fills `cwd` and `env` from the run before it calls the handle,
   * and passes `inherit` only for a stream that is the handle's own.
   */
  spawn(
    command: string,
    args: readonly string[],
    options: SpawnOptions & {
      readonly cwd: string;
      readonly env: Readonly<Record<string, string | undefined>>;
    },
  ): Child;
  /** The one member core writes: `run()` writes the run's code once it is final. */
  exitCode: ExitCode | undefined;
  /** Receives each variable an argv run's environment preparation copies out. */
  readonly publishEnv?: (name: string, value: string) => void;
}

/**
 * The fields `processHandle` takes, each replacing its whole field. An absolute `cwd` string never
 * throws; a relative one resolves against the process's working directory at each read, so it
 * throws when that directory cannot be read; and a `cwd` function throws as it chooses.
 *
 * @public
 */
export type ProcessFields = Partial<
  Omit<ProcessHandle, 'cwd' | 'exitCode' | 'publishEnv' | 'signals' | 'spawn'>
> & {
  readonly cwd?: string | (() => string);
};

/**
 * The facts of the process a run reads, copied from its process handle at entry: the platform,
 * `argv`, the working directory, the environment, the terminal, and the streams. An action reads
 * them as `host`; core never reads the process behind its back.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/host.md#host-facts
 * @public
 */
export interface Host {
  /** The operating system, as `process.platform` names it, such as `linux` or `darwin`. */
  platform: string;
  /** The process's CPU architecture, such as `x64` or `arm64`. */
  arch: string;
  /**
   * `glibc` or `musl` on Linux, and `undefined` elsewhere. Core copies it from the handle on the
   * run's first read, because the real process's answer comes from a costly runtime report.
   */
  readonly libc: 'glibc' | 'musl' | undefined;
  /** The process's user ID, or `undefined` on a runtime with none. */
  uid: number | undefined;
  /** The command-line words after the program, as the operator typed them. */
  argv: string[];
  /**
   * The runtime and script prefix `argv` omits: the words that start this application again, so
   * `[...program, ...argv]` reruns it. A compiled binary reads its own path alone, and any other
   * run reads the runtime's path and the absolute path of the script it ran. Frozen; a supplied
   * `program` replaces the whole list, and an action's `invoke` keeps its run's.
   */
  program: readonly string[];
  /** The working directory, read when the run captured its host. */
  cwd: string;
  /**
   * The operator's home folder, copied from the handle at entry: its absolute `HOME` unless a
   * `home` was supplied. Environment preparation never moves it.
   */
  home: string;
  /**
   * The folder for temporary files, copied from the handle at entry: its absolute `TMPDIR`, else
   * `/tmp`, unless a `tmpdir` was supplied. It names a folder and creates nothing.
   */
  tmpdir: string;
  /**
   * The operator's IANA time zone, such as `America/New_York`, which a validator reads to place a
   * local time. The real process's handle reads the zone `Intl` resolves, which honours `TZ`; a
   * supplied `timeZone` replaces it, and an action's `invoke` keeps its run's. Core copies it from
   * the handle on the run's first read, because resolving the zone through `Intl` is costly.
   */
  readonly timeZone: string;
  /** The run's environment variables, which environment preparation may add to. */
  env: Record<string, string | undefined>;
  /** The run's terminal facts. */
  terminal: HostTerminal;
  /** The stream the run reads its stdin from. */
  stdin: Readable;
  /** The stream the run writes its results to. */
  stdout: Writable;
  /** The stream the run writes diagnostics and progress to. */
  stderr: Writable;
  /**
   * Reads one source file for a defect's Developer Diagnostic, or answers `undefined`. Core calls
   * it only in a development build, only while it reports a defect, and only for a path under the
   * working directory. The real process's handle supplies a reader that refuses a file outside
   * `cwd` after resolving symbolic links, and answers `undefined` for a path that is not a regular
   * file or that exceeds 1 MiB.
   */
  readSource?: (path: string, cwd: string) => string | undefined;
  /**
   * The release facts the build baked in, or `{ build: 'source' }` when it baked none, frozen when
   * core read them. A supplied `release` is taken as given, neither validated nor frozen.
   */
  release: ReleaseFacts;
  /**
   * Raises the signal a key read in raw mode stands for on the run's signal source and answers
   * `true` when `stdin` is that source's own terminal; otherwise it raises nothing and answers
   * `false`, and the reader cancels the run itself.
   */
  raise: (signal: 'SIGINT' | 'SIGQUIT' | 'SIGTSTP') => boolean;
  /**
   * Starts a child program through the run's process handle, with no shell, in the run's `cwd` and
   * with its `env` unless the options name others. It returns the child at once.
   */
  spawn: (command: string, args: readonly string[], options?: SpawnOptions) => Child;
}
