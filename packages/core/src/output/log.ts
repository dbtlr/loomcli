import type { Writable } from 'node:stream';

import { defectDetail } from '../diagnostics/defect.js';
import type { LogDefect } from '../diagnostics/defect.js';
import { isAuthorFault } from '../failures/errors.js';
import type { LoomError } from '../failures/errors.js';
import type { FailureForm } from '../failures/form.js';
import type { LogLineLevel } from './log-line.js';
import { redactedValue } from './redaction.js';
import type { Redaction } from './redaction.js';

/**
 * The levels a log event carries. `fatal` is core's alone: `Log` has no method for it.
 *
 * @public
 * @sealed
 */
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** The levels an author's `log` call can name. */
type CallLevel = Exclude<LogLevel, 'fatal'>;

/**
 * Plain JSON data, which a log event's fields are copied into.
 *
 * @public
 */
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * The fields of a `log` call: any values, which the copy turns into JSON.
 *
 * @public
 */
type LogFields = Readonly<Record<string, unknown>>;

/**
 * One log event as an `onLog` hook receives it, frozen with everything it holds.
 *
 * @public
 * @sealed
 */
interface LogEvent {
  /** ISO 8601 UTC with milliseconds, read at the call. */
  readonly time: string;
  /** The event's severity. `fatal` is core's alone, for a defect. */
  readonly level: LogLevel;
  /** The message the `log` call passed, or for an event core logs, the message core gives it. */
  readonly message: string;
  /** The frozen copy of the call's fields. */
  readonly fields: Readonly<Record<string, JsonValue>>;
  /** The name and version of the Application the run belongs to. */
  readonly application: { readonly name: string; readonly version: string };
  /** 32 lowercase hexadecimal characters, one per run. */
  readonly run: string;
  /** The canonical Command names routing had walked when the event was written. */
  readonly path: readonly string[];
  /** The identity of the plugin whose `log` it is, or `null`. */
  readonly plugin: string | null;
  /** Core's failure events alone. */
  readonly failure?: FailureForm;
  /** Fatal events alone. */
  readonly defect?: LogDefect;
}

/**
 * What a `log` call on a context of the run does: one method for each author-callable level.
 *
 * @public
 * @sealed
 */
interface Log {
  /** Logs a `trace` event with a message and optional fields. */
  trace(message: string, fields?: LogFields): void;
  /** Logs a `debug` event with a message and optional fields. */
  debug(message: string, fields?: LogFields): void;
  /** Logs an `info` event with a message and optional fields. */
  info(message: string, fields?: LogFields): void;
  /** Logs a `warn` event with a message and optional fields. */
  warn(message: string, fields?: LogFields): void;
  /** Logs an `error` event with a message and optional fields. */
  error(message: string, fields?: LogFields): void;
  /**
   * A `log` whose every event also carries `fields`, copied now, beside its own: a call's own field
   * wins over a bound one of the same name, and a nested `with` wins over the one it is called on.
   * The receiver is unchanged.
   */
  with(fields: LogFields): Log;
}

/**
 * Where a hook writes: the outermost run's environment, home, platform, and stderr, which is
 * `null` under an invocation by name, because that writes to no process stream, and a `log` that
 * records under the hook's own plugin.
 *
 * @public
 * @sealed
 */
interface LogDestination {
  /** The outermost run's environment variables. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The outermost run's `host.home`. */
  readonly home: string;
  /** The outermost run's platform name. */
  readonly platform: string;
  /** The outermost run's stderr stream, or `null` under an invocation by name. */
  readonly stderr: Writable | null;
  /**
   * Records a log event under the identity of the plugin whose hook receives this destination. The
   * event reaches every other installed `onLog` hook, and shows as a log line when the outermost
   * run's verbosity shows its level, but never reaches this hook, so a hook that says what it did
   * does not recurse into itself.
   */
  readonly log: Log;
}

/** The outermost run's facts every hook's destination shares, before each hook's own `log`. */
type DestinationFacts = Omit<LogDestination, 'log'>;

/** Where the outermost run shows a log event as a log line, at its verbosity. */
interface LogScreen {
  /** Whether the outermost run's verbosity shows an event at `level`, read at each call. */
  readonly shows: (level: LogLineLevel) => boolean;
  /** Shows one event as a log line, unless the verbosity hides it or it is a failure event. */
  readonly show: (event: LogEvent) => void;
}

/** One installed `onLog` hook with the identity of the plugin that declares it. */
interface PluginLogHook {
  readonly hook: LogHook;
  readonly plugin: string;
}

/** One hook and the destination it receives, whose `log` reaches every hook but this one. */
interface Receiver {
  readonly hook: LogHook;
  readonly destination: LogDestination;
}

/**
 * Where every event of the outermost run and the runs nested in it goes: each hook with its
 * destination, and the screen. The outermost run builds it and a nested run takes it whole, so a
 * hook receives one destination object for the outermost run and every run nested in it.
 */
interface LogOutlet {
  readonly receivers: readonly Receiver[];
  readonly screen: LogScreen;
}

/** What the outermost run builds its outlet from. */
interface OutletParts {
  readonly facts: DestinationFacts;
  readonly hooks: readonly PluginLogHook[];
  readonly screen: LogScreen;
}

/**
 * A plugin's `onLog` hook: it observes one event and returns nothing.
 *
 * @public
 */
type LogHook = (event: LogEvent, destination: LogDestination) => undefined;

/** Gives one context its `log`, bound to the plugin core is calling, or to none. */
type LogBinder = (plugin: string | null) => Log;

/** What one run's events read beside the call itself. */
interface LogScene {
  readonly application: { readonly name: string; readonly version: string };
  /** The field paths the Application redacts from every event's fields, or none. */
  readonly redaction: Redaction | undefined;
  /** The outermost run's outlet, which a nested run takes from its parent, or the parts to build it. */
  readonly outlet: LogOutlet | OutletParts;
  /** The path a failure view reads, which routing publishes as it walks. */
  readonly path: () => readonly string[];
}

const circular = '[Circular]';

/** What the copy leaves out of an object: `undefined`, a function, and a symbol. */
const omitted = Symbol('omitted');

/** The members of an Error the copy keeps, `cause` copied by the same rule. */
const errorKeys = ['name', 'message', 'stack', 'cause'] as const;

type Copied = JsonValue | typeof omitted;

/**
 * Where the copy stands as it walks the fields: the objects that hold the value being copied, and
 * the node of the redaction tree at that value, whose keys below read `"[Redacted]"`, or
 * `undefined` where nothing below is redacted.
 */
interface Place {
  readonly ancestors: Set<object>;
  readonly redaction: Redaction | undefined;
}

/** The copy of one property of `holder`, at the place of `holder`'s own value. */
function copyProperty(holder: object, key: string, at: Place): Copied {
  return copyValue(Reflect.get(holder, key), key, at);
}

/**
 * The copy of an array: each index in order, an omitted one reading `null`. A redaction path steps
 * through an array, so each item copies at the array's place.
 */
function copyArray(value: readonly unknown[], at: Place): JsonValue {
  const items: JsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = copyProperty(value, String(index), at);
    items.push(item === omitted ? null : item);
  }
  return Object.freeze(items);
}

/**
 * The copy of the named properties of an object, a property that copies to nothing left out, and
 * one the redaction tree marks reading `"[Redacted]"` in place of its copy.
 */
function copyKeys(value: object, keys: readonly string[], at: Place): JsonValue {
  const entries: [string, JsonValue][] = [];
  for (const key of keys) {
    const below = at.redaction?.keys.get(key);
    const item = copyProperty(
      value,
      key,
      below === at.redaction ? at : { ...at, redaction: below },
    );
    if (item !== omitted) {
      // An Error's stack repeats its message, so hiding the message also hides the stack.
      const hidesStack =
        value instanceof Error &&
        key === 'stack' &&
        at.redaction?.keys.get('message')?.redacted === true;
      entries.push([key, below?.redacted === true || hidesStack ? redactedValue : item]);
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

/**
 * The copy of an object that holds `ancestors`' chain, or `"[Circular]"` where it repeats one. An
 * object leaves the chain once copied, so a value shared twice without a cycle copies twice.
 */
function copyObject(value: object, at: Place): JsonValue {
  const { ancestors } = at;
  if (ancestors.has(value)) {
    return circular;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return copyArray(value, at);
    }
    return copyKeys(value, value instanceof Error ? errorKeys : Object.keys(value), at);
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
function copyValue(value: unknown, key: string, at: Place): Copied {
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
      return resolved === null ? null : copyObject(resolved, at);
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
 * A call's fields as the frozen JSON copy of the event, each path the redaction tree names reading
 * `"[Redacted]"`. Omitted fields read `{}`, and so does anything that does not copy to an object.
 */
function copyFields(
  fields: LogFields | undefined,
  redaction: Redaction | undefined,
): Readonly<Record<string, JsonValue>> {
  const copied = copyProperty({ fields }, 'fields', { ancestors: new Set(), redaction });
  return isJsonRecord(copied) ? copied : noFields;
}

/** The bound fields with a call's own copied fields beside them, the call's winning a shared name. */
function withBound(
  bound: Readonly<Record<string, JsonValue>>,
  own: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  return bound === noFields ? own : Object.freeze({ ...bound, ...own });
}

/** How many random bytes a run's id holds, and the radix their characters are written in. */
const runIdBytes = 16;
const hexRadix = 16;

/** 16 random bytes as 32 lowercase hexadecimal characters, the format of a trace id. */
function newRunId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(runIdBytes));
  return Array.from(bytes, (byte) => byte.toString(hexRadix).padStart(2, '0')).join('');
}

/** A `Log` whose methods hand each call to `emit`, and whose `with` hands its fields to `bind`. */
function logOf(
  emit: (level: CallLevel, message: string, fields: LogFields | undefined) => void,
  bind: (fields: LogFields) => Log,
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
    with: bind,
  });
}

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
 * screen and to the installed `onLog` hooks in installation order, core's failure events, and the
 * first throw a hook raised. A hook that throws is still called for every later event, and the
 * throw ends neither the delivery of that event to a later hook nor the call that created it.
 */
class RunLog {
  readonly #scene: LogScene;
  readonly #outlet: LogOutlet;
  #thrown: { readonly value: unknown } | undefined = undefined;
  #run: string | undefined = undefined;

  constructor(scene: LogScene) {
    this.#scene = scene;
    this.#outlet = 'receivers' in scene.outlet ? scene.outlet : this.#outletOf(scene.outlet);
  }

  /** Where the run's events go, which the runs nested under it send theirs to as well. */
  get outlet(): LogOutlet {
    return this.#outlet;
  }

  /** The first value a hook threw in the run, which the run reports once after its outcome. */
  get thrown(): { readonly value: unknown } | undefined {
    return this.#thrown;
  }

  /** The `log` of one context, bound to the plugin core is calling, or to none. */
  bind(plugin: string | null): Log {
    return this.#logFor(plugin, undefined, noFields);
  }

  /**
   * Logs one failure the run reports: `error`, or `fatal` with the defect the run caught for an
   * `InternalError`, a `ResultError`, or a `DeclarationError`. It reaches the hooks alone: the run
   * already reports the failure, so it never shows as a log line.
   */
  failure(failure: LoomError, form: FailureForm): void {
    if (this.#outlet.receivers.length === 0) {
      return;
    }
    const base = { failure: form, fields: noFields, message: form.message, plugin: null };
    this.#deliver(
      isAuthorFault(failure)
        ? { ...base, defect: Object.freeze(defectDetail(failure)), level: 'fatal' }
        : { ...base, level: 'error' },
      undefined,
    );
  }

  /** Each hook with its destination, whose `log` this run's events go through. */
  #outletOf({ facts, hooks, screen }: OutletParts): LogOutlet {
    const receivers = hooks.map(({ hook, plugin }) =>
      Object.freeze({
        destination: Object.freeze({ ...facts, log: this.#logFor(plugin, hook, noFields) }),
        hook,
      }),
    );
    return Object.freeze({ receivers: Object.freeze(receivers), screen });
  }

  /**
   * A `log` bound to `plugin` whose events reach every hook but `except` and carry `bound` beside
   * each call's own fields. A call creates an event only when a hook hears it or the verbosity
   * shows its level, and reads nothing otherwise. Its `with` copies the fields it binds at once,
   * redacted as a call's are.
   */
  #logFor(
    plugin: string | null,
    except: LogHook | undefined,
    bound: Readonly<Record<string, JsonValue>>,
  ): Log {
    const { redaction } = this.#scene;
    return logOf(
      (level, message, fields) => {
        const { receivers, screen } = this.#outlet;
        if (!screen.shows(level) && receivers.every(({ hook }) => hook === except)) {
          return;
        }
        const copied = withBound(bound, copyFields(fields, redaction));
        this.#deliver({ fields: copied, level, message, plugin }, except);
      },
      (fields) => this.#logFor(plugin, except, withBound(bound, copyFields(fields, redaction))),
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

  /**
   * Shows one event on the screen, then hands it to every hook but `except`, in installation
   * order, before returning. The screen and every hook read the same frozen event.
   */
  #deliver(parts: EventParts, except: LogHook | undefined): void {
    const event = this.#event(parts);
    this.#outlet.screen.show(event);
    for (const { destination, hook } of this.#outlet.receivers) {
      if (hook !== except) {
        try {
          hook(event, destination);
        } catch (error) {
          this.#thrown ??= { value: error };
        }
      }
    }
  }
}

export type {
  DestinationFacts,
  JsonValue,
  Log,
  LogBinder,
  LogDestination,
  LogEvent,
  LogFields,
  LogHook,
  LogLevel,
  LogOutlet,
  LogScene,
  LogScreen,
  PluginLogHook,
};
export { RunLog };
export type { LogDefect } from '../diagnostics/defect.js';
