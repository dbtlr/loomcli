import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import type { Writable } from 'node:stream';

import { WorkingDirectoryError } from './errors.js';
import type { InternalError } from './errors.js';
import { captureRelease } from './release.js';
import type { CapturedRelease } from './release.js';
import type { Host, ReleaseFacts, RunOptions } from './types.js';

// Process stream declarations assume a terminal, but pipes omit isTTY at runtime.
function isTerminal(stream: { isTTY?: boolean }): boolean {
  return stream.isTTY === true;
}

function dimension(value: number | undefined): number | undefined {
  return value === 0 ? undefined : value;
}

/** The largest source file the captured reader reads, so a frame cannot make it read without end. */
const sourceLimit = 1_048_576;

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
    const stats = statSync(file);
    if (!stats.isFile() || stats.size > sourceLimit) {
      return undefined;
    }
    return readFileSync(file, 'utf8');
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

/** The host `run()` captures from the process at entry, each override replacing its whole field. */
export function captureHost(overrides: RunOptions['host'], stderr: Writable): HostCapture {
  const { argv, cwd, env, platform, readSource, release, stdin, stdout, terminal } =
    overrides ?? {};
  const captured = { directory: captureWorkingDirectory(cwd), release: captureRelease(release) };
  return capturedHost(
    {
      argv: [...(argv ?? process.argv.slice(2))],
      env: { ...(env ?? process.env) },
      platform: platform ?? process.platform,
      readSource: readSource ?? readSourceFile,
      stderr,
      stdin: stdin ?? process.stdin,
      stdout: stdout ?? process.stdout,
      terminal: terminal
        ? {
            stderr: { ...terminal.stderr },
            stdin: { ...terminal.stdin },
            stdout: { ...terminal.stdout },
          }
        : {
            stderr: {
              columns: dimension(process.stderr.columns),
              isTTY: isTerminal(process.stderr),
              rows: dimension(process.stderr.rows),
            },
            stdin: { isTTY: isTerminal(process.stdin) },
            stdout: {
              columns: dimension(process.stdout.columns),
              isTTY: isTerminal(process.stdout),
              rows: dimension(process.stdout.rows),
            },
          },
    },
    captured,
  );
}
