import { Readable, Writable } from 'node:stream';

import type { StartingView } from './chain.js';
import type { LoomError } from './errors.js';
import {
  capturedHost,
  captureProgram,
  captureTimeZone,
  captureWorkingDirectory,
  readSourceFile,
  settlingTerminal,
} from './host.js';
import type { CapturedFacts, HostCapture } from './host.js';
import type { NamedCall } from './lower.js';
import { captureRelease } from './release.js';
import type { Host, InvocationValues, InvokeOptions, ProgressEvent } from './types.js';

/** The host fields an invocation by name reads, which `app.invoke` replaces whole. */
type InvocationFields = Required<Pick<Host, 'cwd' | 'env' | 'platform' | 'release'>> &
  Pick<Host, 'readSource'>;

/**
 * The five fields one invocation by name runs on, its working directory and its release facts as
 * its capture read them, and the program that starts the application again, which an invocation
 * by name never replaces.
 */
type CapturedFields = Omit<InvocationFields, 'cwd' | 'release'> &
  CapturedFacts &
  Pick<Host, 'program' | 'timeZone'>;

/** The entries of one `args` or `options` record, a key whose value is `undefined` left out. */
function definedEntries(record: InvocationValues['args']): (readonly [string, unknown])[] {
  return record === undefined
    ? []
    : Object.entries(record).filter(([, value]) => value !== undefined);
}

/** One `invoke()` call as the run reads it. */
interface InvokeCall<Mapped> {
  named: NamedCall;
  /** The starting view selection, as the caller passed it. */
  view: StartingView | undefined;
  failure: InvokeOptions<Mapped>['failure'];
  signal: AbortSignal | undefined;
  onProgress: InvokeOptions<Mapped>['onProgress'];
}

/**
 * Reads one `invoke()` call where it entered. The path and the passthrough tail are copied and
 * each record's defined entries read once, so a later change to the caller's values changes
 * nothing the run lowers. The types state each slot's kind.
 */
function readCall<Mapped>(call: {
  path: readonly string[];
  values: InvocationValues;
  options: InvokeOptions<Mapped> | undefined;
}): InvokeCall<Mapped> {
  const { options, values } = call;
  return {
    failure: options?.failure,
    named: {
      args: definedEntries(values.args),
      options: definedEntries(values.options),
      passthrough: [...(values.passthrough ?? [])],
      path: [...call.path],
    },
    onProgress: options?.onProgress,
    signal: options?.signal,
    view: options?.view === undefined ? undefined : { name: options.view },
  };
}

/** A call's progress observer as its run calls it, and the step that ends the call once it settles. */
interface GuardedObserver {
  /** Hands one event to the caller's observer, unless an earlier event made it throw. */
  observe: ((event: ProgressEvent) => void) | undefined;
  /** Throws what the observer threw, once the run has settled, so `invoke` rejects with it. */
  settle: () => void;
}

/**
 * The caller's progress observer, guarded so a throw never reaches the run: the observer is
 * called no more, and the call rejects with the throw once its run settles. No observer leaves the
 * run with none, so it collects nothing.
 */
function guardedObserver(onProgress: InvokeOptions['onProgress']): GuardedObserver {
  if (onProgress === undefined) {
    return { observe: undefined, settle: () => undefined };
  }
  let broken: { thrown: unknown } | undefined = undefined;
  return {
    observe: (event) => {
      if (broken !== undefined) {
        return;
      }
      try {
        onProgress(event);
      } catch (error) {
        broken = { thrown: error };
      }
    },
    settle: () => {
      if (broken !== undefined) {
        throw broken.thrown;
      }
    },
  };
}

/**
 * The five fields `app.invoke` captures at entry, unless the caller replaces one. The working
 * directory and the release facts are read through the steps `run()` shares, the application's
 * name finding its installation record.
 */
function processFields(application: string, overrides: Partial<InvocationFields>): CapturedFields {
  const env = overrides.env ?? process.env;
  const platform = overrides.platform ?? process.platform;
  return {
    directory: captureWorkingDirectory(overrides.cwd),
    env,
    platform,
    program: captureProgram(undefined),
    readSource: overrides.readSource ?? readSourceFile,
    release: captureRelease(overrides.release, { application, env, platform }),
    timeZone: captureTimeZone(undefined),
  };
}

/**
 * The five fields an action's call reads from its run's host, which it never reads again, and the
 * run's program.
 */
function fieldsOf(host: Host): CapturedFields {
  const { cwd, env, platform, program, readSource, timeZone } = host;
  const captured = {
    directory: { cwd },
    env,
    platform,
    program,
    release: { facts: host.release },
    timeZone,
  };
  return readSource === undefined ? captured : { ...captured, readSource };
}

/** A stream that keeps every byte written to it, decoded as UTF-8 when the run has ended. */
function captureSink(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: unknown, encoding: BufferEncoding, callback: () => void) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
      callback();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

/**
 * Every terminal fact of an invocation by name: not a TTY, with no width or height, and a
 * background that never settles.
 */
const noTerminal = (): Host['terminal'] =>
  settlingTerminal({
    stderr: { columns: undefined, isTTY: false, rows: undefined },
    stdin: { isTTY: false },
    stdout: { columns: undefined, isTTY: false, rows: undefined },
  });

/**
 * The host an invocation by name runs on: the five fields it reads, capture sinks for stdout and
 * stderr, an empty stdin, no argv, and no terminal. Nothing in it is the process's own stream.
 * Malformed release facts, or a working directory its capture could not read, is the failure in
 * its place.
 */
function invocationHost(
  fields: CapturedFields,
  sinks: { stderr: Writable; stdout: Writable },
): HostCapture {
  const facts = {
    argv: [],
    env: { ...fields.env },
    platform: fields.platform,
    program: fields.program,
    stderr: sinks.stderr,
    stdin: Readable.from([]),
    stdout: sinks.stdout,
    terminal: noTerminal(),
    timeZone: fields.timeZone,
  };
  return capturedHost(
    fields.readSource === undefined ? facts : { ...facts, readSource: fields.readSource },
    fields,
  );
}

/**
 * The failure a failed outcome holds: what the caller's handler returned, or the failure itself
 * when the caller passed none.
 */
function mappedFailure<Mapped>(
  failure: LoomError,
  handler: InvokeOptions<Mapped>['failure'],
  context: Parameters<NonNullable<InvokeOptions<Mapped>['failure']>>[1],
): Mapped {
  if (handler !== undefined) {
    return handler(failure, context);
  }
  // Last resort: no typed path exists.
  // With no handler, nothing of type Mapped exists to return, so the failure stands in for it.
  // It holds because Mapped is inferred from the handler, and a call that passes none infers the default.
  // That default is LoomError, the failure itself; an explicit type argument with no handler is the caller's own claim.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return failure as Mapped;
}

export type { CapturedFields, InvocationFields, InvokeCall };
export {
  captureSink,
  fieldsOf,
  guardedObserver,
  invocationHost,
  mappedFailure,
  processFields,
  readCall,
};
