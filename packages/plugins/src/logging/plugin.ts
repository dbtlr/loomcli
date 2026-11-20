import { DeclarationError, InternalError, UsageError, plugin, readExtension } from '@loomcli/core';
import type {
  FailureHook,
  LogDestination,
  LogEvent,
  LogHook,
  LoomError,
  Plugin,
} from '@loomcli/core';

import { packageName } from '../constants.js';
import type { LoggingError } from './error.js';
import { loggingFiles } from './extension.js';
import { writeRecord } from './file.js';
import type { Report, Written } from './file.js';
import { emitEvent } from './otel.js';
import type { OpenTelemetryLogger } from './otel.js';
import { loggingPhrase } from './phrases.js';
import { isWritten, recordOf } from './record.js';
import type { WrittenLevel } from './record.js';
import { resolveLoggingFiles } from './resolution.js';
import type { LogFilesHost, LoggingFilesFacts, ResolvedLogFiles } from './resolution.js';
import { plansOf } from './settings.js';
import type { LoggingPlan, LoggingSettings } from './settings.js';

const identity = `${packageName}/logging`;

/** Where a failure goes: the author's `onError`, or nowhere when there is none. */
function reportTo(onError: ((error: LoggingError) => undefined) | undefined): Report {
  return (error) => {
    onError?.(error);
  };
}

/** What the lines of one record's write read: the runs already told, and this run's destination. */
interface Telling {
  /** The outermost runs whose `Logging to` line is written, so each run says it once. */
  readonly announced: WeakSet<LogDestination>;
  /** The outermost run's destination, one object for that run and every run nested in it. */
  readonly destination: LogDestination;
}

/**
 * Logs the lines one record's write earns through the destination's `log`, which every other hook
 * hears and this one never does: `Rotated` at `trace` for a rotation that moved the file, and
 * `Logging to` at `debug` after the first record of that run lands.
 */
function sayWritten(path: string, written: Written, { announced, destination }: Telling): void {
  if (written.rotated) {
    destination.log.trace(loggingPhrase('rotated'), { path });
  }
  if (written.appended && !announced.has(destination)) {
    announced.add(destination);
    destination.log.debug(loggingPhrase('loggingTo'), { path });
  }
}

/** The facts of one run's latest failure event: its run, its host, and the files it reached. */
interface FailureRecord {
  readonly run: string;
  readonly host: LogFilesHost;
  readonly appended: ReadonlySet<string>;
}

/** What the hook shares with the failure hint: the latest failure event's record. */
interface Failures {
  latest: FailureRecord | undefined;
}

/** What one destination's write reads: the event, the run's destination, and the resolved files. */
interface Writing {
  readonly event: LogEvent;
  readonly destination: LogDestination;
  readonly resolved: ResolvedLogFiles;
  /** The record's bytes, serialized on the first destination that writes them. */
  readonly record: () => string;
}

/** Writes one event to one destination when its level admits it, and answers the file it appended. */
type Write = (writing: Writing) => string | undefined;

/** The console writer, which writes the record to the destination's stderr. */
function consoleWriterOf(level: WrittenLevel): Write {
  return ({ destination, event, record }) => {
    if (isWritten(event.level, level)) {
      destination.stderr?.write(record());
    }
    return undefined;
  };
}

/** The OpenTelemetry writer, filtered by its own declared level. */
function otelWriterOf(logger: OpenTelemetryLogger, level: WrittenLevel): Write {
  return ({ event }) => {
    if (isWritten(event.level, level)) {
      emitEvent(logger, event);
    }
    return undefined;
  };
}

/**
 * The writer and run-local announcement state of the file destination at `index` among the files,
 * which writes to the path the resolution gave it at the level the resolution gave it.
 */
function fileWriterOf(plan: LoggingPlan & { to: 'file' }, index: number): Write {
  const { keep, maxBytes } = plan;
  const report = reportTo(plan.onError);
  const announced = new WeakSet<LogDestination>();
  return ({ destination, event, record, resolved }) => {
    const file = resolved.files[index];
    if (file === undefined || !isWritten(event.level, file.level)) {
      return undefined;
    }
    if ('error' in file) {
      report(file.error);
      return undefined;
    }
    const written = writeRecord({ keep, maxBytes, path: file.path, report }, record());
    sayWritten(file.path, written, { announced, destination });
    return written.appended ? file.path : undefined;
  };
}

/** One writer per destination, in declaration order, each file knowing its place among the files. */
function writersOf(plans: readonly LoggingPlan[]): readonly Write[] {
  const files = plans.filter((plan) => plan.to === 'file');
  return plans.map((plan) => {
    if (plan.to === 'otel') {
      return otelWriterOf(plan.logger, plan.level);
    }
    return plan.to === 'console'
      ? consoleWriterOf(plan.level)
      : fileWriterOf(plan, files.indexOf(plan));
  });
}

/** Tells the operator, once per outermost run, of each variable value the run could not use. */
function warnRejected(
  rejected: ResolvedLogFiles['rejected'],
  { destination, warned }: { destination: LogDestination; warned: WeakSet<LogDestination> },
): void {
  if ((rejected.level === undefined && rejected.file === undefined) || warned.has(destination)) {
    return;
  }
  warned.add(destination);
  if (rejected.level !== undefined) {
    void destination.out.warn(
      loggingPhrase('badLevel', rejected.level.variable, rejected.level.value),
    );
  }
  if (rejected.file !== undefined) {
    void destination.out.warn(
      loggingPhrase('badFile', rejected.file.variable, rejected.file.value),
    );
  }
}

/**
 * One hook shares the record bytes across destinations, filtering each independently. Each event
 * resolves the files through the fact the plugin publishes, so the operator's variables reach every
 * record, a configuration source's included. A failure event's files are kept for the hint.
 */
function hookOf(
  plans: readonly LoggingPlan[],
  shared: { facts: LoggingFilesFacts; failures: Failures },
): LogHook {
  const writers = writersOf(plans);
  const warned = new WeakSet<LogDestination>();
  return (event, destination) => {
    const resolved = resolveLoggingFiles(shared.facts, {
      application: event.application.name,
      host: destination,
    });
    warnRejected(resolved.rejected, { destination, warned });
    let bytes: string | undefined = undefined;
    const record = (): string => (bytes ??= recordOf(event));
    const appended = new Set(
      writers.flatMap((write) => write({ destination, event, record, resolved }) ?? []),
    );
    if (event.failure !== undefined) {
      shared.failures.latest = { appended, host: destination, run: event.run };
    }
    return undefined;
  };
}

/** Whether `failureHint` names the log for a failure of this kind. */
function hinted(mode: NonNullable<LoggingSettings['failureHint']>, failure: Readonly<LoomError>) {
  if (mode === false) {
    return false;
  }
  if (mode === 'defects') {
    return failure instanceof InternalError || failure instanceof DeclarationError;
  }
  return mode === 'always' || !(failure instanceof UsageError);
}

/**
 * The hint that names each log file the failure's own event reached, and the run, for the failures
 * `failureHint` selects. It resolves the fact on the run's graph for the host the event was written
 * on, so it names the files as the writer resolved them, in declaration order, each once.
 */
function hintOf(
  mode: NonNullable<LoggingSettings['failureHint']>,
  failures: Failures,
): FailureHook {
  return (failure, context) => {
    const latest = failures.latest;
    if (latest?.run !== context.run || !hinted(mode, failure)) {
      return undefined;
    }
    const facts = readExtension(context.graph.root, loggingFiles);
    if (facts === undefined) {
      return undefined;
    }
    const resolved = resolveLoggingFiles(facts, {
      application: context.application,
      host: latest.host,
    });
    const paths = new Set(
      resolved.files.flatMap((file) =>
        'path' in file && latest.appended.has(file.path) ? [file.path] : [],
      ),
    );
    return [...paths].map((path) => loggingPhrase('failureLog', path, context.run));
  };
}

/** The fact the plugin publishes: each file destination's declared file and level, and the variables. */
function factsOf(plans: readonly LoggingPlan[], settings: LoggingSettings | undefined) {
  const facts: LoggingFilesFacts = {
    fileEnv: settings?.fileEnv,
    files: plans.flatMap((plan) =>
      plan.to === 'file' ? [{ file: plan.file, level: plan.level }] : [],
    ),
    levelEnv: settings?.levelEnv,
  };
  return facts;
}

/**
 * A plugin that writes log events to independently filtered destinations: size-rotated files,
 * stderr, and the author's OpenTelemetry logger. An operator sets the
 * files' level and the first file's path through two variables named after the application. The
 * plugin publishes its files as a fact on the root Command and names the log file under a failure.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { logging } from '@loomcli/plugins/logging';
 *
 * export const app = new Application('notes', { plugins: [logging({ level: 'warn', maxBytes: 1_000_000 })] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/logging.md
 *
 * @public
 */
export function logging(settings?: LoggingSettings): Plugin {
  const plans = plansOf(settings);
  const facts = factsOf(plans, settings);
  const failures: Failures = { latest: undefined };
  return plugin(identity, {
    extensions: [loggingFiles],
    onCommandAttach: (command) =>
      command.name === null ? command.extend(loggingFiles(facts)) : command,
    onFailure: hintOf(settings?.failureHint ?? 'runtime', failures),
    onLog: hookOf(plans, { facts, failures }),
  });
}

export { LoggingError } from './error.js';
export type { LoggingErrorKind } from './error.js';
export type { WrittenLevel } from './record.js';
export type { LoggingDestinationSettings, LoggingSettings } from './settings.js';

export type { OpenTelemetryLogger, OpenTelemetryLogRecord, OpenTelemetryLogValue } from './otel.js';

// The plugin pack's member of MessagePackages, which this entry's declarations load.
export type {} from '../registry.js';
