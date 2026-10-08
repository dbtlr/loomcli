import { Readable, Writable } from 'node:stream';

import { InternalError } from './errors.js';
import type { LoomError } from './errors.js';
import { capturedHost, captureWorkingDirectory, readSourceFile } from './host.js';
import type { CapturedFacts, HostCapture } from './host.js';
import type { NamedCall } from './lower.js';
import { isPlainObject } from './plain.js';
import { captureRelease } from './release.js';
import { invokeOptions } from './rules.js';
import type { Host, InvokeOptions } from './types.js';

/** The host fields an invocation by name reads, which `app.invoke` replaces whole. */
type InvocationFields = Required<Pick<Host, 'cwd' | 'env' | 'platform' | 'release'>> &
  Pick<Host, 'readSource'>;

/**
 * The five fields one invocation by name runs on, its working directory and its release facts as
 * its capture read them.
 */
type CapturedFields = Omit<InvocationFields, 'cwd' | 'release'> & CapturedFacts;

/** The five host fields by name, the only keys `app.invoke` accepts under `host`. */
const hostFields = new Set(['cwd', 'env', 'platform', 'readSource', 'release']);

/** The keys `values` may hold. */
const valueKeys = new Set(['args', 'options', 'passthrough']);

/** The defect one malformed slot of an `invoke()` call reports, before the graph is built. */
function callFault(sentence: string, correction: string): InternalError {
  return new InternalError(invokeOptions, { cause: undefined, correction, sentence });
}

/** Whether a value is an array of strings alone. */
function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** The entries of one `args` or `options` record, a key whose value is `undefined` left out. */
function definedEntries(
  record: unknown,
  slot: 'args' | 'options',
  noun: string,
): (readonly [string, unknown])[] {
  if (record === undefined) {
    return [];
  }
  if (!isPlainObject(record)) {
    throw callFault(
      `invoke() received ${slot} that are not an object.`,
      `Supply ${slot} as an object keyed by ${noun} name.`,
    );
  }
  return Object.entries(record).filter(([, value]) => value !== undefined);
}

/** The path, read where the call entered: an array of Command names, `[]` for the root. */
function readPath(path: unknown): readonly string[] {
  if (!isStringList(path)) {
    throw callFault(
      'invoke() received a path that is not an array of Command names.',
      'Supply the path as an array of Command names, [] for the root.',
    );
  }
  return [...path];
}

/** The values record itself: a plain object that holds `args`, `options`, and `passthrough` alone. */
function valuesRecord(values: unknown): Record<string, unknown> {
  if (!isPlainObject(values)) {
    throw callFault(
      'invoke() received values that are not an object.',
      'Supply values as an object that holds args, options, and passthrough.',
    );
  }
  if (Object.keys(values).some((key) => !valueKeys.has(key))) {
    throw callFault(
      'invoke() received values that hold a key other than args, options, and passthrough.',
      'Supply values with args, options, and passthrough alone.',
    );
  }
  return values;
}

/** The passthrough tail, copied: an array of strings, delivered unchanged. */
function readPassthrough(passthrough: unknown): readonly string[] {
  if (passthrough === undefined) {
    return [];
  }
  if (!isStringList(passthrough)) {
    throw callFault(
      'invoke() received a passthrough that is not an array of strings.',
      'Supply passthrough as an array of strings.',
    );
  }
  return [...passthrough];
}

/** The values, read where the call entered, into the named call the run lowers. */
function readValues(path: readonly string[], values: unknown): NamedCall {
  const record = valuesRecord(values);
  return {
    args: definedEntries(record.args, 'args', 'argument'),
    options: definedEntries(record.options, 'options', 'option'),
    passthrough: readPassthrough(record.passthrough),
    path,
  };
}

/** The caller's own signal, read where the call entered. */
function readSignal(signal: unknown): AbortSignal | undefined {
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw callFault(
      'invoke() received a signal that is not an AbortSignal.',
      'Supply the signal of an AbortController.',
    );
  }
  return signal;
}

/**
 * The host overrides `app.invoke` reads: whole replacements of the five fields, and nothing else.
 * The types state each field's kind, and the call's rule covers a field outside the five.
 */
function readHost(host: Partial<InvocationFields> | undefined): Partial<InvocationFields> {
  const supplied: unknown = host;
  if (supplied === undefined) {
    return {};
  }
  const correction = 'Supply host with env, cwd, platform, readSource, or release alone.';
  if (!isPlainObject(supplied)) {
    throw callFault('invoke() received a host that is not an object.', correction);
  }
  if (Object.keys(supplied).some((key) => !hostFields.has(key))) {
    throw callFault(
      'invoke() received a host that holds a field other than env, cwd, platform, readSource, and release.',
      correction,
    );
  }
  return host ?? {};
}

/** One `invoke()` call as the run reads it, every slot checked where the call entered. */
interface InvokeCall<Mapped> {
  named: NamedCall;
  /** The starting view selection, kept as the caller passed it. */
  view: { name: unknown } | undefined;
  failure: InvokeOptions<Mapped>['failure'];
  signal: AbortSignal | undefined;
}

/**
 * Reads the slots of one `invoke()` call after its host, in the order they are listed: the path,
 * the values and each record they hold, the signal, and the failure handler. A malformed slot
 * throws the `invoke-options` defect, which the run reports before it builds the graph.
 */
function readInvokeCall<Mapped>(call: {
  path: unknown;
  values: unknown;
  options: (InvokeOptions<Mapped> & { readonly host?: Partial<InvocationFields> }) | undefined;
}): InvokeCall<Mapped> {
  const { options } = call;
  const named = readValues(readPath(call.path), call.values);
  const signal = readSignal(options?.signal);
  const failure = options?.failure;
  const handler: unknown = failure;
  if (handler !== undefined && typeof handler !== 'function') {
    throw callFault(
      'invoke() received a failure handler that is not a function.',
      'Supply the failure handler as a function.',
    );
  }
  const view: unknown = options?.view;
  return { failure, named, signal, view: view === undefined ? undefined : { name: view } };
}

/**
 * One `invoke()` call as read where it entered, or the fault reading it raised, which the run
 * reports through its failure path before it builds the graph. The fault is the primary failure,
 * so it keeps the caller's failure handler whenever that slot holds a function. Either way it
 * holds the host overrides the call supplied, which a fault in a later slot reports through.
 */
type ReadCall<Mapped> = { host: Partial<InvocationFields> } & (
  | { call: InvokeCall<Mapped> }
  | { fault: unknown; failure: InvokeOptions<Mapped>['failure'] }
);

/**
 * Reads one `invoke()` call and keeps a fault as a value, so the call itself never throws. On
 * `app.invoke` the host is read first, because its fields, the release facts among them, decide
 * how a fault in any later slot reports; a host that cannot be read leaves the captured fields. An
 * action's call reads no `host`, because its five fields are its run's.
 */
function readCall<Mapped>(
  call: Parameters<typeof readInvokeCall<Mapped>>[0],
  door: 'action' | 'application',
): ReadCall<Mapped> {
  let host: Partial<InvocationFields> = {};
  try {
    host = door === 'application' ? readHost(call.options?.host) : {};
    return { call: readInvokeCall(call), host };
  } catch (error) {
    const failure = call.options?.failure;
    return { failure: typeof failure === 'function' ? failure : undefined, fault: error, host };
  }
}

/**
 * The five fields `app.invoke` captures at entry, unless the caller replaces one. The working
 * directory and the release facts are read through the steps `run()` shares.
 */
function processFields(overrides: Partial<InvocationFields>): CapturedFields {
  return {
    directory: captureWorkingDirectory(overrides.cwd),
    env: overrides.env ?? process.env,
    platform: overrides.platform ?? process.platform,
    readSource: overrides.readSource ?? readSourceFile,
    release: captureRelease(overrides.release),
  };
}

/** The five fields an action's call reads from its run's host, which it never reads again. */
function fieldsOf(host: Host): CapturedFields {
  const { cwd, env, platform, readSource } = host;
  const captured = { directory: { cwd }, env, platform, release: { facts: host.release } };
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

/** Every terminal fact of an invocation by name: not a TTY, with no width or height. */
const noTerminal = (): Host['terminal'] => ({
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
    stderr: sinks.stderr,
    stdin: Readable.from([]),
    stdout: sinks.stdout,
    terminal: noTerminal(),
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

export type { CapturedFields, InvocationFields, InvokeCall, ReadCall };
export { captureSink, fieldsOf, invocationHost, mappedFailure, processFields, readCall };
