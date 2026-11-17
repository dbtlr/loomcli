import { plugin } from '@loomcli/core';
import type { LogDestination, LogHook, Plugin } from '@loomcli/core';

import { packageName } from '../constants.js';
import { resolveLogFile } from './directory.js';
import { LoggingError } from './error.js';
import { writeRecord } from './file.js';
import type { Report, Written } from './file.js';
import { loggingTo, rotated } from './messages.js';
import { isWritten, recordOf } from './record.js';
import { planOf } from './settings.js';
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
    destination.log.trace(rotated, { path });
  }
  if (written.appended && !announced.has(destination)) {
    announced.add(destination);
    destination.log.debug(loggingTo, { path });
  }
}

/** The hook that writes each record, from the settings with their defaults filled. */
function hookOf(plan: LoggingPlan): LogHook {
  if (plan.to === 'console') {
    return (event, destination) => {
      if (isWritten(event.level, plan.level)) {
        destination.stderr?.write(recordOf(event));
      }
      return undefined;
    };
  }
  const { keep, maxBytes } = plan;
  const report = reportTo(plan.onError);
  const announced = new WeakSet<LogDestination>();
  return (event, destination) => {
    if (!isWritten(event.level, plan.level)) {
      return undefined;
    }
    const path = resolveLogFile(plan.file, event.application.name, destination);
    if (path instanceof LoggingError) {
      report(path);
    } else {
      const written = writeRecord({ keep, maxBytes, path, report }, recordOf(event));
      sayWritten(path, written, { announced, destination });
    }
    return undefined;
  };
}

/**
 * A plugin that writes each log event as one JSON record, appended to a size-rotated file in the
 * platform's state or log directory, or written to stderr. It is an `onLog` hook and nothing else.
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
  return plugin(identity, { onLog: hookOf(planOf(settings)) });
}

export { LoggingError } from './error.js';
export type { LoggingErrorKind } from './error.js';
export type { WrittenLevel } from './record.js';
export type { LoggingSettings } from './settings.js';
