import { realpathSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';

import type { Background } from './background.js';
import { WorkingDirectoryError } from './errors.js';
import type { InternalError } from './errors.js';
import { handleRelease } from './process-handle.js';
import type { CapturedRelease } from './release.js';
import type {
  Host,
  HostTerminal,
  OutputTerminal,
  ProcessHandle,
  ReleaseFacts,
  SignalSource,
} from './types.js';

/**
 * Each run's background, by the terminal facts it belongs to: the background its process handle's
 * terminal stated, if any, and the settled one, written once at settlement.
 */
const settlements = new WeakMap<
  HostTerminal,
  { readonly stated: Background | undefined; value: Background | undefined }
>();

/**
 * The raise a run's host holds: the signal a raw-mode key stands for, raised on the run's signal
 * source when `stdin` is that source's own terminal, answering whether it raised.
 */
function raiseOn(signals: SignalSource, stdin: Readable): Host['raise'] {
  return (signal) => {
    const { terminal } = signals;
    if (terminal === undefined || terminal !== stdin) {
      return false;
    }
    signals.raise(signal);
    return true;
  };
}

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

/** A read that runs once, on its first call, and answers that value from then on. */
function once<Value>(read: () => Value): () => Value {
  let held: { value: Value } | undefined = undefined;
  return () => {
    held ??= { value: read() };
    return held.value;
  };
}

/**
 * One host or report: its facts, working directory, and release facts, with `libc` a getter, so
 * no spread reads the C library before the run's own code does.
 */
function assembled<Facts extends object, Cwd, Release>(parts: {
  readonly cwd: Cwd;
  readonly facts: Facts;
  readonly libc: () => Host['libc'];
  readonly release: Release;
}) {
  const { cwd, facts, libc, release } = parts;
  return {
    ...facts,
    cwd,
    get libc() {
      return libc();
    },
    release,
  };
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

/** The working directory one capture read, or the failure its read raised in its place. */
export type WorkingDirectory =
  | { readonly cwd: string }
  | { readonly failure: WorkingDirectoryError };

/**
 * The one step `run()` and `app.invoke` read the working directory through, once per run: the
 * handle's `cwd()`. A read that throws, as the process's does once another process removed the
 * directory, answers the failure in its place, whose `cause` is the thrown value.
 */
export function captureWorkingDirectory(handle: ProcessHandle): WorkingDirectory {
  try {
    return { cwd: handle.cwd() };
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

/**
 * The facts every run copies from its process handle, `run()` and an invocation by name alike, with
 * the working directory and the release facts as the capture read them. A new host fact a handle
 * supplies is copied here, in one place.
 */
export interface HandleFacts {
  readonly arch: string;
  readonly directory: WorkingDirectory;
  readonly env: Host['env'];
  /** Reads the C library once, on the run's first read of `host.libc`, which can be costly. */
  readonly libc: () => Host['libc'];
  readonly platform: string;
  readonly program: readonly string[];
  readonly readSource?: NonNullable<Host['readSource']>;
  readonly release: CapturedRelease;
  readonly timeZone: string;
  readonly uid: number | undefined;
}

/**
 * The facts one run copies from its process handle at entry, each read once. The application's
 * name finds its installation record.
 */
export function handleFacts(application: string, handle: ProcessHandle): HandleFacts {
  const env = { ...handle.env };
  const { platform, readSource } = handle;
  const facts = {
    arch: handle.arch,
    directory: captureWorkingDirectory(handle),
    env,
    libc: once(() => handle.libc),
    platform,
    program: Object.freeze([...handle.program]),
    release: handleRelease(handle, { application, env, platform }),
    timeZone: handle.timeZone,
    uid: handle.uid,
  };
  return readSource === undefined ? facts : { ...facts, readSource };
}

/** The facts a run holds beside its handle's: its argv, its streams, its terminal, and its raise. */
export type RunFacts = Pick<Host, 'argv' | 'raise' | 'stderr' | 'stdin' | 'stdout' | 'terminal'>;

/**
 * The host one run captures from its own facts and its handle's, around the release facts and the
 * working directory the handle's capture read. Malformed release facts are the author's defect and
 * report first.
 */
export function capturedHost(run: RunFacts, shared: HandleFacts): HostCapture {
  const { directory, libc, release, ...copied } = shared;
  const facts = { ...run, ...copied };
  const cwd = 'cwd' in directory ? directory.cwd : undefined;
  if ('failure' in release) {
    return {
      failure: release.failure,
      report: assembled({ cwd, facts, libc, release: undefined }),
    };
  }
  if ('failure' in directory) {
    return {
      failure: directory.failure,
      report: assembled({ cwd, facts, libc, release: release.facts }),
    };
  }
  const host: Host = assembled({ cwd: directory.cwd, facts, libc, release: release.facts });
  return { host, report: host };
}

/**
 * The host `run()` captures from its process handle at entry: the facts every run copies, and the
 * argv, streams, terminal facts, and raise of an argv run.
 */
export function captureHost(
  application: string,
  handle: ProcessHandle,
  stderr: Writable,
): HostCapture {
  const shared = handleFacts(application, handle);
  const { signals, stdin, terminal } = handle;
  return capturedHost(
    {
      argv: [...handle.argv],
      raise: raiseOn(signals, stdin),
      stderr,
      stdin,
      stdout: handle.stdout,
      terminal: settlingTerminal({
        background: terminal.background,
        stderr: suppliedTerminal(terminal.stderr),
        stdin: { isTTY: terminal.stdin.isTTY },
        stdout: suppliedTerminal(terminal.stdout),
      }),
    },
    shared,
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

/** The background a run's process handle stated, a source of its settled background. */
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
