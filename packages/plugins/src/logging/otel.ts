import type { JsonValue, LogEvent, LogLevel } from '@loomcli/core';

/**
 * The JSON subset of OpenTelemetry's AnyValue, copied into mutable SDK-owned containers.
 *
 * @public
 */
type OpenTelemetryLogValue =
  | null
  | boolean
  | number
  | string
  | OpenTelemetryLogValue[]
  | { [key: string]: OpenTelemetryLogValue };

/**
 * The record Loom hands to the author's OpenTelemetry logger. The body keeps the message template.
 *
 * @public
 * @sealed
 */
interface OpenTelemetryLogRecord {
  /** The event time, without changing its instant. */
  readonly timestamp: Date;
  /** The base severity of the event's OpenTelemetry range. */
  // These numeric literals are the OpenTelemetry severity scale.
  // oxlint-disable-next-line no-magic-numbers
  readonly severityNumber: 1 | 5 | 9 | 13 | 17 | 21;
  /** The original lowercase level. */
  readonly severityText: LogLevel;
  /** The message template as written. */
  readonly body: string;
  /** The copied fields and run facts, with exception semantics for defect detail. */
  readonly attributes: Record<string, OpenTelemetryLogValue>;
}

/**
 * The structural emit contract of an OpenTelemetry Logger. The author configures its SDK,
 * exporters, resource, and shutdown; Loom installs no OpenTelemetry dependency.
 *
 * @public
 */
interface OpenTelemetryLogger {
  /** Emits one record synchronously; a throw takes the ordinary hook failure path. */
  emit(record: OpenTelemetryLogRecord): void;
}

const severity: Record<LogLevel, OpenTelemetryLogRecord['severityNumber']> = {
  debug: 5,
  error: 17,
  fatal: 21,
  info: 9,
  trace: 1,
  warn: 13,
};

/** SDKs may mutate containers; the frozen event remains the source for every destination. */
function copyValue(value: JsonValue): OpenTelemetryLogValue {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Array.isArray(value)
    ? value.map(copyValue)
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]));
}

/** Maps only the event's facts, leaving trace context to the author's SDK. */
function emitEvent(logger: OpenTelemetryLogger, event: LogEvent): void {
  const attributes: Record<string, OpenTelemetryLogValue> = {
    'loom.fields': copyValue(event.fields),
    'loom.path': [...event.path],
    'loom.plugin': event.plugin,
    'loom.run': event.run,
    'service.name': event.application.name,
    'service.version': event.application.version,
  };
  if (event.failure !== undefined) {
    attributes['loom.failure'] = copyValue({ ...event.failure });
  }
  if (event.defect !== undefined) {
    attributes['exception.type'] = event.defect.name;
    attributes['exception.message'] = event.defect.message;
    if (event.defect.stack !== undefined) {
      attributes['exception.stacktrace'] = event.defect.stack;
    }
  }
  logger.emit({
    attributes,
    body: event.message,
    severityNumber: severity[event.level],
    severityText: event.level,
    timestamp: new Date(event.time),
  });
}

export type { OpenTelemetryLogger, OpenTelemetryLogRecord, OpenTelemetryLogValue };
export { emitEvent };
