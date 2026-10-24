import { Readable, Writable } from 'node:stream';

import type { StartingView } from './chain.js';
import type { LoomError } from './errors.js';
import { capturedHost, settlingTerminal } from './host.js';
import type { HandleFacts, HostCapture } from './host.js';
import type { NamedCall } from './lower.js';
import type { Host, InvocationValues, InvokeOptions, ProgressEvent } from './types.js';

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
 * each record's defined entries read once, so a later change to the caller's path or passthrough array
 * changes nothing the run lowers. The types state each slot's kind.
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
 * The facts an action's call reads from its run's host, which it never reads again, as the facts
 * another call copies from its handle.
 */
function fieldsOf(host: Host): HandleFacts {
  const { arch, cwd, env, home, platform, program, readSource, timeZone, tmpdir, uid } = host;
  const captured = {
    arch,
    directory: { cwd },
    env,
    home,
    // The call reads its run's C library only when its own code reads it.
    libc: () => host.libc,
    platform,
    program,
    release: { facts: host.release },
    // The call's children start through its run's host, which fills nothing the call filled.
    spawn: host.spawn,
    timeZone,
    tmpdir,
    uid,
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
 * The host an invocation by name runs on: the facts it reads, capture sinks for stdout and
 * stderr, an empty stdin, no argv, and no terminal. Nothing in it is the process's own stream.
 * Malformed release facts, or a working directory its capture could not read, is the failure in
 * its place.
 */
function invocationHost(
  fields: HandleFacts,
  sinks: { stderr: Writable; stdout: Writable },
): HostCapture {
  return capturedHost(
    {
      argv: [],
      // Its stdin is no terminal's, so a raw-mode reader raises nothing and cancels the call itself.
      raise: () => false,
      stderr: sinks.stderr,
      stdin: Readable.from([]),
      stdout: sinks.stdout,
      terminal: noTerminal(),
    },
    { ...fields, env: { ...fields.env } },
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

export type { InvokeCall };
export { captureSink, fieldsOf, guardedObserver, invocationHost, mappedFailure, readCall };
