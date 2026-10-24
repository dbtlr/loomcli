import type { Writable } from 'node:stream';

import { defectDetail } from './defect.js';
import type { LogDefect } from './defect.js';
import { isAuthorFault } from './errors.js';
import type { LoomError } from './errors.js';
import type { FailureForm } from './form.js';

/** The levels a log event carries. `fatal` is core's alone: `Log` has no method for it. */
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** The levels an author's `log` call can name. */
type CallLevel = Exclude<LogLevel, 'fatal'>;

/** Plain JSON data, which a log event's fields are copied into. */
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** The fields of a `log` call: any values, which the copy turns into JSON. */
type LogFields = Readonly<Record<string, unknown>>;

/** One log event as an `onLog` hook receives it, frozen with everything it holds. */
interface LogEvent {
  /** ISO 8601 UTC with milliseconds, read at the call. */
  readonly time: string;
  readonly level: LogLevel;
  readonly message: string;
  /** The frozen copy of the call's fields. */
  readonly fields: Readonly<Record<string, JsonValue>>;
  readonly application: { readonly name: string; readonly version: string };
  /** 32 lowercase hexadecimal characters, one per run. */
  readonly run: string;
  readonly path: readonly string[];
  /** The identity of the plugin whose `log` it is, or `null`. */
  readonly plugin: string | null;
  /** Core's failure events alone. */
  readonly failure?: FailureForm;
  /** Fatal events alone. */
  readonly defect?: LogDefect;
}

/** What a `log` call on a context of the run does: one method for each author-callable level. */
interface Log {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/**
 * Where a hook writes: the outermost run's environment, home, platform, and stderr, which is
 * `null` under an invocation by name, because that writes to no process stream.
 */
interface LogDestination {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The outermost run's `host.home`. */
  readonly home: string;
  readonly platform: string;
  readonly stderr: Writable | null;
}

/** A plugin's `onLog` hook: it observes one event and returns nothing. */
type LogHook = (event: LogEvent, destination: LogDestination) => undefined;

/** Gives one context its `log`, bound to the plugin core is calling, or to none. */
type LogBinder = (plugin: string | null) => Log;

/** What one run's events read beside the call itself. */
interface LogScene {
  readonly application: { readonly name: string; readonly version: string };
  readonly destination: LogDestination;
  /** The path a failure view reads, which routing publishes as it walks. */
  readonly path: () => readonly string[];
}

const circular = '[Circular]';

/** What the copy leaves out of an object: `undefined`, a function, and a symbol. */
const omitted = Symbol('omitted');

/** The members of an Error the copy keeps, `cause` copied by the same rule. */
const errorKeys = ['name', 'message', 'stack', 'cause'] as const;

type Copied = JsonValue | typeof omitted;

/** The copy of one property of `holder`. */
function copyProperty(holder: object, key: string, ancestors: Set<object>): Copied {
  return copyValue(Reflect.get(holder, key), key, ancestors);
}

/** The copy of an array: each index in order, an omitted one reading `null`. */
function copyArray(value: readonly unknown[], ancestors: Set<object>): JsonValue {
  const items: JsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = copyProperty(value, String(index), ancestors);
    items.push(item === omitted ? null : item);
  }
  return Object.freeze(items);
}

/** The copy of the named properties of an object, a property that copies to nothing left out. */
function copyKeys(value: object, keys: readonly string[], ancestors: Set<object>): JsonValue {
  const entries: [string, JsonValue][] = [];
  for (const key of keys) {
    const item = copyProperty(value, key, ancestors);
    if (item !== omitted) {
      entries.push([key, item]);
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

/**
 * The copy of an object that holds `ancestors`' chain, or `"[Circular]"` where it repeats one. An
 * object leaves the chain once copied, so a value shared twice without a cycle copies twice.
 */
function copyObject(value: object, ancestors: Set<object>): JsonValue {
  if (ancestors.has(value)) {
    return circular;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return copyArray(value, ancestors);
    }
    return copyKeys(value, value instanceof Error ? errorKeys : Object.keys(value), ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/** `toJSON` applied as `JSON.stringify` applies it, to an object that has one. */
function jsonOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const toJSON: unknown = Reflect.get(value, 'toJSON');
  return typeof toJSON === 'function' ? Reflect.apply(toJSON, value, [key]) : value;
}

/**
 * One value as `JSON.stringify` would write it, except that an Error keeps its name, message,
 * stack, and cause, a `bigint` reads its decimal string, and a value that holds itself reads
 * `"[Circular]"`. `omitted` stands for a value an object leaves out.
 */
function copyValue(value: unknown, key: string, ancestors: Set<object>): Copied {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  const resolved = value instanceof Error ? value : jsonOf(value, key);
  switch (typeof resolved) {
    case 'string':
    case 'boolean': {
      return resolved;
    }
    case 'number': {
      return Number.isFinite(resolved) ? resolved : null;
    }
    case 'bigint': {
      return resolved.toString();
    }
    case 'object': {
      return resolved === null ? null : copyObject(resolved, ancestors);
    }
    default: {
      return omitted;
    }
  }
}

/** Whether a copy is a JSON object, which is what a call's fields must come to. */
function isJsonRecord(copied: Copied): copied is Readonly<Record<string, JsonValue>> {
  return typeof copied === 'object' && copied !== null && !Array.isArray(copied);
}

const noFields: Readonly<Record<string, JsonValue>> = Object.freeze({});

/**
 * A call's fields as the frozen JSON copy of the event. Omitted fields read `{}`, and so does
 * anything that does not copy to an object.
 */
function copyFields(fields: LogFields | undefined): Readonly<Record<string, JsonValue>> {
  const copied = copyProperty({ fields }, 'fields', new Set());
  return isJsonRecord(copied) ? copied : noFields;
}

/** How many random bytes a run's id holds, and the radix their characters are written in. */
const runIdBytes = 16;
const hexRadix = 16;

/** 16 random bytes as 32 lowercase hexadecimal characters, the format of a trace id. */
function newRunId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(runIdBytes));
  return Array.from(bytes, (byte) => byte.toString(hexRadix).padStart(2, '0')).join('');
}

/** A `Log` whose methods hand each call to `emit`. */
function logOf(
  emit: (level: CallLevel, message: string, fields: LogFields | undefined) => void,
): Log {
  const method =
    (level: CallLevel) =>
    (message: string, fields?: LogFields): void => {
      emit(level, message, fields);
    };
  return Object.freeze({
    debug: method('debug'),
    error: method('error'),
    info: method('info'),
    trace: method('trace'),
    warn: method('warn'),
  });
}

/** The `log` of a run with no `onLog` hook: a call creates no event and reads nothing. */
const silentLog: Log = logOf(() => undefined);

/** What the parts of one event are, before the facts every event of the run shares are added. */
interface EventParts {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Readonly<Record<string, JsonValue>>;
  readonly plugin: string | null;
  readonly failure?: FailureForm;
  readonly defect?: LogDefect;
}

/**
 * One run's log events: the `log` each context receives, the delivery of every event to the
 * installed `onLog` hooks in installation order, core's failure events, and the first throw a hook
 * raised. A hook that throws is still called for every later event, and the throw ends neither the
 * delivery of that event to a later hook nor the call that created it.
 */
class RunLog {
  readonly #scene: LogScene;
  readonly #hooks: readonly LogHook[];
  #thrown: { readonly value: unknown } | undefined = undefined;
  #run: string | undefined = undefined;

  constructor(scene: LogScene, hooks: readonly LogHook[]) {
    this.#scene = scene;
    this.#hooks = hooks;
  }

  /** Where the run's events are delivered, which the runs nested under it deliver to as well. */
  get destination(): LogDestination {
    return this.#scene.destination;
  }

  /** The first value a hook threw in the run, which the run reports once after its outcome. */
  get thrown(): { readonly value: unknown } | undefined {
    return this.#thrown;
  }

  /** The `log` of one context, bound to the plugin core is calling, or to none. */
  bind(plugin: string | null): Log {
    if (this.#hooks.length === 0) {
      return silentLog;
    }
    return logOf((level, message, fields) => {
      this.#deliver({ fields: copyFields(fields), level, message, plugin });
    });
  }

  /**
   * Logs one failure the run reports: `error`, or `fatal` with the defect the run caught for an
   * `InternalError`, a `ResultError`, or a `DeclarationError`.
   */
  failure(failure: LoomError, form: FailureForm): void {
    if (this.#hooks.length === 0) {
      return;
    }
    const base = { failure: form, fields: noFields, message: form.message, plugin: null };
    this.#deliver(
      isAuthorFault(failure)
        ? { ...base, defect: Object.freeze(defectDetail(failure)), level: 'fatal' }
        : { ...base, level: 'error' },
    );
  }

  #runId(): string {
    this.#run ??= newRunId();
    return this.#run;
  }

  #event(parts: EventParts): LogEvent {
    return Object.freeze({
      ...parts,
      application: this.#scene.application,
      path: Object.freeze([...this.#scene.path()]),
      run: this.#runId(),
      time: new Date().toISOString(),
    });
  }

  /** Hands one event to every hook, in installation order, before returning. */
  #deliver(parts: EventParts): void {
    const event = this.#event(parts);
    for (const hook of this.#hooks) {
      try {
        hook(event, this.#scene.destination);
      } catch (error) {
        this.#thrown ??= { value: error };
      }
    }
  }
}

export type {
  JsonValue,
  Log,
  LogBinder,
  LogDestination,
  LogEvent,
  LogFields,
  LogHook,
  LogLevel,
  LogScene,
};
export { RunLog, silentLog };
export type { LogDefect } from './defect.js';
