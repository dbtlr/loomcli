import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Writable } from 'node:stream';

import type { Background } from './background.js';
import { WorkingDirectoryError } from './errors.js';
import type { InternalError } from './errors.js';
import { readSmallFile } from './files.js';
import { captureRelease, isCompiled } from './release.js';
import type { CapturedRelease } from './release.js';
import type { Host, HostTerminal, OutputTerminal, ReleaseFacts, RunOptions } from './types.js';

// Process stream declarations assume a terminal, but pipes omit isTTY at runtime.
function isTerminal(stream: { isTTY?: boolean }): boolean {
  return stream.isTTY === true;
}

function dimension(value: number | undefined): number | undefined {
  return value === 0 ? undefined : value;
}

/**
 * Each run's background, by the terminal facts it belongs to: the background an override stated,
 * if any, and the settled one, written once at settlement.
 */
const settlements = new WeakMap<
  HostTerminal,
  { readonly stated: Background | undefined; value: Background | undefined }
>();

/** An output terminal whose width and height are read each time, and whose kind is fixed. */
function outputTerminal(
  isTTY: boolean,
  read: { columns: () => number | undefined; rows: () => number | undefined },
): OutputTerminal {
  return {
    get columns() {
      return read.columns();
    },
    isTTY,
    get rows() {
      return read.rows();
    },
  };
}

/**
 * One process stream's terminal: `isTTY` captured once, because a stream does not change kind
 * mid-run, and the width and height read from the stream each time, which Node and Bun update when
 * the window resizes. A zero reading is unavailable.
 */
function streamTerminal(stream: NodeJS.WriteStream): OutputTerminal {
  return outputTerminal(isTerminal(stream), {
    columns: () => dimension(stream.columns),
    rows: () => dimension(stream.rows),
  });
}

/**
 * One dimension of a supplied terminal: a plain value copied, so it stays fixed, and a getter kept,
 * so it is as live as the getter.
 */
function suppliedDimension(
  supplied: OutputTerminal,
  key: 'columns' | 'rows',
): () => number | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(supplied, key);
  if (descriptor !== undefined && 'value' in descriptor) {
    const value = supplied[key];
    return () => value;
  }
  return () => supplied[key];
}

/** A supplied output terminal: its `isTTY` copied once, its width and height as supplied. */
function suppliedTerminal(supplied: OutputTerminal): OutputTerminal {
  return outputTerminal(supplied.isTTY, {
    columns: suppliedDimension(supplied, 'columns'),
    rows: suppliedDimension(supplied, 'rows'),
  });
}

/** The absolute path of the script the runtime ran, as the process names it. */
function scriptPath(script: string): string {
  if (isAbsolute(script)) {
    return script;
  }
  try {
    return resolve(script);
  } catch {
    return script;
  }
}

/**
 * The reader process capture supplies: one UTF-8 file, read synchronously, whose path lies under
 * the working directory once both resolve through symbolic links. A stack can be forged, so a file
 * outside `cwd`, a link that leaves it, a path that is not a regular file, such as a FIFO or a
 * device, a file larger than 1 MiB, and any failure answer `undefined`.
 */
export function readSourceFile(path: string, cwd: string): string | undefined {
  try {
    const file = realpathSync(path);
    const within = relative(realpathSync(cwd), file);
    if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      return undefined;
    }
    return readSmallFile(file);
  } catch {
    return undefined;
  }
}

/**
 * The roots a defect's frame may lie under: the working directory as the host names it, and the
 * path it resolves to through symbolic links, because a runtime names a module by its resolved
 * path. A directory that cannot be resolved is its own one root.
 */
export function sourceRoots(cwd: string): readonly string[] {
  try {
    const resolved = realpathSync(cwd);
    return resolved === cwd ? [cwd] : [cwd, resolved];
  } catch {
    return [cwd];
  }
}

/**
 * The words that start this application again, frozen: an override copied whole, else the
 * compiled binary alone, else the runtime and the absolute path of the script it ran, or the
 * runtime alone when it ran none.
 */
export function captureProgram(override: readonly string[] | undefined): readonly string[] {
  if (override !== undefined) {
    return Object.freeze([...override]);
  }
  const [, script] = process.argv;
  return Object.freeze(
    isCompiled() || script === undefined
      ? [process.execPath]
      : [process.execPath, scriptPath(script)],
  );
}

/**
 * The time zone a run reads: an override, else the IANA name `Intl` resolves, which honours `TZ`.
 * A zone `Intl` does not resolve, or will not build a formatter for, reads as UTC, as an empty `TZ` does.
 */
export function captureTimeZone(override: string | undefined): string {
  if (override !== undefined) {
    return override;
  }
  const resolved: string | undefined = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (resolved === undefined) {
    return 'UTC';
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: resolved }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** The working directory one capture read, or the failure its read raised in its place. */
export type WorkingDirectory =
  | { readonly cwd: string }
  | { readonly failure: WorkingDirectoryError };

/**
 * The one step `run()` and `app.invoke` read the working directory through, once per run. An
 * override replaces the read. A read that throws, as `process.cwd()` does once another process
 * removed the directory, answers the failure in its place, whose `cause` is the thrown value.
 */
export function captureWorkingDirectory(override: string | undefined): WorkingDirectory {
  if (override !== undefined) {
    return { cwd: override };
  }
  try {
    return { cwd: process.cwd() };
  } catch (error) {
    return { failure: new WorkingDirectoryError({ cause: error }) };
  }
}

/**
 * The facts a failure's report writes through: a host whose working directory may be unread, and
 * whose release facts are `undefined` when the baked value was malformed.
 */
export type ReportHost = Omit<Host, 'cwd' | 'release'> & {
  readonly cwd: string | undefined;
  readonly release: ReleaseFacts | undefined;
};

/**
 * One host capture: the run's host, or the failure its release facts or its working directory
 * raised. Either way it holds the facts a report writes through, so the failure path never
 * captures the host again.
 */
export type HostCapture =
  | { readonly host: Host; readonly report: Host }
  | { readonly failure: InternalError | WorkingDirectoryError; readonly report: ReportHost };

/** What one capture read beside the host's other facts: the release facts and the working directory. */
export interface CapturedFacts {
  readonly directory: WorkingDirectory;
  readonly release: CapturedRelease;
}

/**
 * The capture one set of host facts makes around the release facts and the working directory read
 * beside them. Malformed release facts are the author's defect and report first.
 */
export function capturedHost(
  facts: Omit<Host, 'cwd' | 'release'>,
  captured: CapturedFacts,
): HostCapture {
  const { directory, release } = captured;
  const cwd = 'cwd' in directory ? directory.cwd : undefined;
  if ('failure' in release) {
    return { failure: release.failure, report: { ...facts, cwd, release: undefined } };
  }
  if ('failure' in directory) {
    return { failure: directory.failure, report: { ...facts, cwd, release: release.facts } };
  }
  const host: Host = { ...facts, cwd: directory.cwd, release: release.facts };
  return { host, report: host };
}

/**
 * The host `run()` captures from the process at entry, each override replacing its whole field.
 * The application's name finds its installation record.
 */
export function captureHost(
  application: string,
  overrides: RunOptions['host'],
  stderr: Writable,
): HostCapture {
  const { argv, cwd, program, readSource, release, stdin, stdout, terminal, timeZone } =
    overrides ?? {};
  const env = { ...(overrides?.env ?? process.env) };
  const platform = overrides?.platform ?? process.platform;
  const captured = {
    directory: captureWorkingDirectory(cwd),
    release: captureRelease(release, { application, env, platform }),
  };
  return capturedHost(
    {
      argv: [...(argv ?? process.argv.slice(2))],
      env,
      platform,
      program: captureProgram(program),
      readSource: readSource ?? readSourceFile,
      stderr,
      stdin: stdin ?? process.stdin,
      stdout: stdout ?? process.stdout,
      terminal: settlingTerminal(
        terminal
          ? {
              background: terminal.background,
              stderr: suppliedTerminal(terminal.stderr),
              stdin: { isTTY: terminal.stdin.isTTY },
              stdout: suppliedTerminal(terminal.stdout),
            }
          : {
              stderr: streamTerminal(process.stderr),
              stdin: { isTTY: isTerminal(process.stdin) },
              stdout: streamTerminal(process.stdout),
            },
      ),
      timeZone: captureTimeZone(timeZone),
    },
    captured,
  );
}

/**
 * A run's terminal facts around the streams' own, whose `background` reads `undefined` until
 * `settleTerminal` writes the run's settled background, and reads that value from then on. A
 * `background` the streams' facts state is kept apart, as the source `statedBackground` reads.
 */
export function settlingTerminal(
  streams: Omit<HostTerminal, 'background'> & { readonly background?: Background | undefined },
): HostTerminal {
  const cell = { stated: streams.background, value: undefined };
  const terminal: HostTerminal = {
    get background() {
      return cell.value;
    },
    stderr: streams.stderr,
    stdin: streams.stdin,
    stdout: streams.stdout,
  };
  settlements.set(terminal, cell);
  return terminal;
}

/** The background a run's host override stated, a source of its settled background. */
export function statedBackground(terminal: HostTerminal): Background | undefined {
  return settlements.get(terminal)?.stated;
}

/** Writes a run's settled background, which its terminal facts read from then on. */
export function settleTerminal(terminal: HostTerminal, background: Background | undefined): void {
  const cell = settlements.get(terminal);
  if (cell !== undefined) {
    cell.value = background;
  }
}
