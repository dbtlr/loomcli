/**
 * The real process's handle, and the checks only the real process can answer. This module is the
 * one place core reads the global `process`; every other module reads a run's process handle.
 */
import { execFileSync } from 'node:child_process';
import { fstatSync, readFileSync, realpathSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { isatty, ReadStream } from 'node:tty';

import { readSmallFile } from './files.js';
import type { InstallationLookup } from './installation.js';
import { isPlainObject } from './plain.js';
import { bakedFacts, captureRelease, isCompiled } from './release.js';
import type { CapturedRelease } from './release.js';
import type {
  ExitCode,
  OutputTerminal,
  ProcessFields,
  ProcessHandle,
  ProcessSignal,
  ProcessTerminal,
  SignalListener,
  SignalSource,
} from './types.js';

/** Process stream declarations assume a terminal, but pipes omit isTTY at runtime. */
function isTerminal(stream: { isTTY?: boolean }): boolean {
  return stream.isTTY === true;
}

/** One terminal dimension as a stream reports it: a zero reading is unavailable. */
function dimension(value: number | undefined): number | undefined {
  return value === 0 ? undefined : value;
}

/**
 * One process stream's terminal: `isTTY` read once, because a stream does not change kind
 * mid-run, and the width and height read from the stream each time, which Node and Bun update when
 * the window resizes. A zero reading is unavailable.
 */
function streamTerminal(stream: NodeJS.WriteStream): OutputTerminal {
  return {
    get columns() {
      return dimension(stream.columns);
    },
    isTTY: isTerminal(stream),
    get rows() {
      return dimension(stream.rows);
    },
  };
}

/** The real process's terminal facts, read when core reads them. */
function processTerminal(): ProcessTerminal {
  return {
    stderr: streamTerminal(process.stderr),
    stdin: { isTTY: isTerminal(process.stdin) },
    stdout: streamTerminal(process.stdout),
  };
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
 * The words that start this application again: the compiled binary alone, else the runtime and the
 * absolute path of the script it ran, or the runtime alone when it ran none.
 */
function processProgram(): readonly string[] {
  const [, script] = process.argv;
  return isCompiled() || script === undefined
    ? [process.execPath]
    : [process.execPath, scriptPath(script)];
}

/**
 * The IANA name `Intl` resolves, which honours `TZ`. A zone `Intl` does not resolve, or will not
 * build a formatter for, reads as UTC, as an empty `TZ` does.
 */
function processTimeZone(): string {
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

/**
 * The runtime's diagnostic report without its network section where the runtime can leave it out,
 * because Node resolves the name of every open socket's peer to fill it, which can take seconds.
 */
function networkFreeReport(): unknown {
  const { report } = process;
  if (!('excludeNetwork' in report)) {
    return report.getReport();
  }
  const excluded: unknown = Reflect.get(report, 'excludeNetwork');
  Reflect.set(report, 'excludeNetwork', true);
  try {
    return report.getReport();
  } finally {
    Reflect.set(report, 'excludeNetwork', excluded);
  }
}

/** The C library the process runs on, which cannot change during its life, once read. */
let readLibc: { value: 'glibc' | 'musl' | undefined } | undefined = undefined;

/**
 * `glibc` or `musl` on Linux, from the runtime's report of a glibc version, which a musl host
 * leaves out, and `undefined` elsewhere.
 */
function processLibc(): 'glibc' | 'musl' | undefined {
  if (readLibc === undefined) {
    if (process.platform === 'linux') {
      const report = networkFreeReport();
      const header: unknown = isPlainObject(report) ? report.header : undefined;
      const glibc = isPlainObject(header) ? header.glibcVersionRuntime : undefined;
      readLibc = { value: glibc === undefined ? 'musl' : 'glibc' };
    } else {
      readLibc = { value: undefined };
    }
  }
  return readLibc.value;
}

/**
 * The reader the real process's handle supplies: one UTF-8 file, read synchronously, whose path
 * lies under the working directory once both resolve through symbolic links. A stack can be
 * forged, so a file outside `cwd`, a link that leaves it, a path that is not a regular file, such
 * as a FIFO or a device, a file larger than 1 MiB, and any failure answer `undefined`.
 */
function readSourceFile(path: string, cwd: string): string | undefined {
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
 * The working directory a handle's `cwd()` reads: a function's answer, an absolute string as
 * given, a relative string resolved against the process's working directory at each read, or the
 * process's own. A read of the process's working directory throws once another process removed it.
 */
function workingDirectory(cwd: ProcessFields['cwd']): string {
  if (typeof cwd === 'function') {
    return cwd();
  }
  if (cwd !== undefined && isAbsolute(cwd)) {
    return cwd;
  }
  const own = process.cwd();
  return cwd === undefined ? own : resolve(own, cwd);
}

/** The real process's signals, which every copy of core shares. */
function processSource(): SignalSource {
  return {
    off<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>) {
      process.off(event, listener);
    },
    on<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>) {
      process.on(event, listener);
    },
    raise(signal: ProcessSignal) {
      process.kill(process.pid, signal);
    },
    get terminal() {
      return isatty(0) ? process.stdin : undefined;
    },
  };
}

/** Whether a value another copy of core stored is a signal source this copy can call. */
function isSignalSource(value: unknown): value is SignalSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'terminal' in value &&
    typeof Reflect.get(value, 'on') === 'function' &&
    typeof Reflect.get(value, 'off') === 'function' &&
    typeof Reflect.get(value, 'raise') === 'function'
  );
}

/**
 * The global object every copy of core shares for the real process, under one registered symbol.
 * The first copy to load creates it, and every later copy uses the one it finds.
 */
const laneKey = Symbol.for('loomcli.processLane');

/** The real process's one signal source, which this copy found or stored on the shared object. */
let sharedSource: SignalSource | undefined = undefined;

/**
 * The real process's one signal source: the one the shared object holds, or a new one stored
 * there when it holds none, so every copy of core and every handle `processHandle` builds listens
 * and raises on the same source.
 */
function realSignals(): SignalSource {
  sharedSource ??= heldSource(sharedLane());
  return sharedSource;
}

/** The shared object for the real process: the one an earlier copy stored, or a new one stored now. */
function sharedLane(): object {
  const found: unknown = Reflect.get(globalThis, laneKey);
  if (typeof found === 'object' && found !== null) {
    return found;
  }
  const lane = {};
  Reflect.set(globalThis, laneKey, lane);
  return lane;
}

/** The signal source the shared object holds, or a new one stored there when it holds none. */
function heldSource(lane: object): SignalSource {
  const held: unknown = Reflect.get(lane, 'source');
  if (isSignalSource(held)) {
    return held;
  }
  const source = processSource();
  Reflect.set(lane, 'source', source);
  return source;
}

/** The handles `processHandle` built that read their release facts from the build. */
const readsBuild = new WeakSet<ProcessHandle>();

/**
 * Copies one environment addition into the real process's environment, unless the process already
 * holds the variable, an empty one included.
 */
function publishToProcess(name: string, value: string): void {
  if (!Object.hasOwn(process.env, name) || process.env[name] === undefined) {
    process.env[name] = value;
  }
}

/**
 * A handle over the process it runs in. Each supplied field replaces its whole field, and each
 * fact it was not given reads the process at the moment core reads it. Every handle shares the
 * real process's signal source, writes `exitCode` to `process.exitCode`, and has `publishEnv`
 * only when it was given neither `env` nor `cwd`.
 */
function processHandle(fields: ProcessFields = {}): ProcessHandle {
  const {
    arch,
    argv,
    cwd,
    env,
    platform,
    program,
    readSource,
    release,
    stderr,
    stdin,
    stdout,
    terminal,
    timeZone,
  } = fields;
  const uid = 'uid' in fields ? { value: fields.uid } : undefined;
  const libc = 'libc' in fields ? { value: fields.libc } : undefined;
  let written: ExitCode | undefined = undefined;
  const handle: ProcessHandle = {
    get arch() {
      return arch ?? process.arch;
    },
    get argv() {
      return argv ?? process.argv.slice(2);
    },
    cwd: () => workingDirectory(cwd),
    get env() {
      return env ?? process.env;
    },
    get exitCode() {
      return written;
    },
    set exitCode(code: ExitCode | undefined) {
      written = code;
      process.exitCode = code;
    },
    get libc() {
      return libc === undefined ? processLibc() : libc.value;
    },
    get platform() {
      return platform ?? process.platform;
    },
    get program() {
      return program ?? processProgram();
    },
    readSource: readSource ?? readSourceFile,
    get release() {
      return release ?? bakedFacts();
    },
    signals: realSignals(),
    get stderr() {
      return stderr ?? process.stderr;
    },
    get stdin() {
      return stdin ?? process.stdin;
    },
    get stdout() {
      return stdout ?? process.stdout;
    },
    get terminal() {
      return terminal ?? processTerminal();
    },
    get timeZone() {
      return timeZone ?? processTimeZone();
    },
    get uid() {
      return uid === undefined ? process.getuid?.() : uid.value;
    },
    ...(env === undefined && cwd === undefined ? { publishEnv: publishToProcess } : {}),
  };
  if (release === undefined) {
    readsBuild.add(handle);
  }
  return handle;
}

/**
 * One run's release facts from its handle: for a handle that reads them from the build, the baked
 * facts with the installation the record holds for the running executable, or the defect a
 * malformed baked value is; for any other handle, its `release`, taken as given.
 */
function handleRelease(
  handle: ProcessHandle,
  lookup: Omit<InstallationLookup, 'executable'>,
): CapturedRelease {
  return readsBuild.has(handle)
    ? captureRelease({ ...lookup, executable: process.execPath })
    : { facts: handle.release };
}

/** The process and terminal process groups a job-control check compares. */
interface JobIds {
  readonly group: number;
  readonly foreground: number;
}

/** Two process group ids, when both are positive integers. */
function jobIds(group: unknown, foreground: unknown): JobIds | undefined {
  const ids = { foreground: Number(foreground), group: Number(group) };
  return Number.isSafeInteger(ids.group) && ids.group > 0 && Number.isSafeInteger(ids.foreground)
    ? ids
    : undefined;
}

/** Where `/proc/self/stat` holds the process group and the terminal's foreground group. */
const groupField = 2;
const foregroundField = 5;

/**
 * The ids `/proc/self/stat` holds on Linux: after the command name, the fields run state, parent,
 * process group, session, terminal, and the terminal's foreground process group.
 */
function procIds(): JobIds | undefined {
  try {
    const line = readFileSync('/proc/self/stat', 'utf8');
    const fields = line.slice(line.lastIndexOf(')') + 2).split(' ');
    return jobIds(fields[groupField], fields[foregroundField]);
  } catch {
    return undefined;
  }
}

/** The ids `ps` reports where there is no `/proc`, such as macOS and the BSDs. */
function psIds(): JobIds | undefined {
  try {
    const reported = execFileSync('ps', ['-o', 'tpgid=,pgid=', '-p', String(process.pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [foreground, group] = reported.trim().split(/\s+/u);
    return jobIds(group, foreground);
  } catch {
    return undefined;
  }
}

/**
 * Whether a run reading `stdin` must skip the background query because the process is a
 * background job of its terminal: a background job that switches the terminal to raw mode or
 * reads it is stopped by SIGTTOU or SIGTTIN, and a check that cannot tell counts as background.
 * The check applies when `stdin` is a real terminal stream, a terminal device of the process such
 * as `process.stdin` or a stream opened on `/dev/tty`, whatever the handle, and to no other stdin.
 */
function inBackgroundJob(stdin: Readable): boolean {
  if (!(stdin instanceof ReadStream)) {
    return false;
  }
  const ids = procIds() ?? psIds();
  return ids === undefined || ids.group !== ids.foreground;
}

/** Errors that mean a path cannot be a source, which the alias check reads as no alias. */
const absent = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG', 'EINVAL']);

function sameSource(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Darwin's fd-path stat can report a pipe inode differently from descriptor stat. */
async function aliasesDarwinStdin(source: BigIntStats): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }
  try {
    return sameSource(source, await stat('/dev/fd/0', { bigint: true }));
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      (error.code === 'EBADF' || absent.has(error.code))
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Whether a source a named call's content input names is the real process's own stdin, reached
 * through a filesystem alias, so the call cannot reopen the process stream.
 */
async function aliasesProcessStdin(source: BigIntStats): Promise<boolean> {
  try {
    return sameSource(source, fstatSync(0, { bigint: true })) || (await aliasesDarwinStdin(source));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EBADF') {
      return false;
    }
    throw error;
  }
}

export { aliasesProcessStdin, handleRelease, inBackgroundJob, processHandle, readSourceFile };
