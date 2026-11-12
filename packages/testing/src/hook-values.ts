/**
 * The plain values a hook reads whole: the log event and log destination an `onLog` hook takes,
 * and the progress event a progress observer takes. Each member a test does not state takes a
 * fixed default, because a hook that serializes or compares a whole value reads every member, and
 * a member a later release adds must not break the test.
 */
import type { LogDestination, LogEvent, ProgressEvent } from '@loomcli/core';

/**
 * What a test states to build a log event: any member it means the hook to read.
 *
 * @public
 */
type LogEventValues = Partial<LogEvent>;

/**
 * What a test states to build a log destination: any member it means the hook to read.
 *
 * @public
 */
type LogDestinationValues = Partial<LogDestination>;

/**
 * What a test states to build a progress event: any member it means the observer to read.
 *
 * @public
 */
type ProgressEventValues = Partial<ProgressEvent>;

/** The length of a run id: 32 lowercase hexadecimal characters. */
const runIdLength = 32;

/** The members of a log event a test does not state. `failure` and `defect` stay absent. */
const eventDefaults = {
  application: { name: 'app', version: '0.0.0' },
  fields: {},
  level: 'info',
  message: '',
  path: [],
  plugin: null,
  run: '0'.repeat(runIdLength),
  time: '2026-01-01T00:00:00.000Z',
} satisfies LogEvent;

/**
 * The members of a log destination a test does not state: `mockProcess`'s home and platform, and
 * the `null` stderr of an invocation by name. Each
 * call answers its own `env`, because the destination freezes only its top level.
 */
function destinationDefaults(): LogDestination {
  return { env: {}, home: '/loom-test/home', platform: 'linux', stderr: null };
}

/** The members of a progress event a test does not state. `completed` and `total` stay absent. */
const progressDefaults = { id: 1, label: '', state: 'updated' } satisfies ProgressEvent;

/** Freezes a plain value and every object and array it holds, as core freezes a log event. */
function freezeDeep<Value>(value: Value): Value {
  if (typeof value === 'object' && value !== null) {
    for (const member of Object.values(value)) {
      freezeDeep(member);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Builds the log event an `onLog` hook takes first: a frozen copy, with everything it holds, of
 * the members the test states over the fixed defaults.
 *
 * ```ts
 * writeEvent(logEvent({ level: 'error', message: 'Sync failed.' }), logDestination({ stderr }));
 * ```
 *
 * @public
 */
function logEvent(values: LogEventValues = {}): LogEvent {
  return freezeDeep(structuredClone({ ...eventDefaults, ...values }));
}

/**
 * Builds the log destination an `onLog` hook takes second: a copy, frozen at its top level, of
 * the members the test states over the fixed defaults. A stated `stderr` is the test's own stream.
 *
 * ```ts
 * writeEvent(logEvent({ level: 'error', message: 'Sync failed.' }), logDestination({ stderr }));
 * ```
 *
 * @public
 */
function logDestination(values: LogDestinationValues = {}): LogDestination {
  return Object.freeze({ ...destinationDefaults(), ...values });
}

/**
 * Builds the progress event a progress observer takes: a copy, frozen at its top level, of the
 * members the test states over the fixed defaults.
 *
 * ```ts
 * expect(percent(progressEvent({ completed: 3, state: 'ended', total: 4 }))).toBe('75%');
 * ```
 *
 * @public
 */
function progressEvent(values: ProgressEventValues = {}): ProgressEvent {
  return Object.freeze({ ...progressDefaults, ...values });
}

export { logDestination, logEvent, progressEvent };
export type { LogDestinationValues, LogEventValues, ProgressEventValues };
