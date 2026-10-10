import { checkPluginSettings, plugin } from '@loomcli/core';
import type { LogHook, Plugin } from '@loomcli/core';

import { packageName } from '../constants.js';
import { resolveLogFile } from './directory.js';
import { LoggingError } from './error.js';
import { writeRecord } from './file.js';
import type { Report } from './file.js';
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

/** The hook that writes each record, from the settings judged at the call. */
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
  return (event, destination) => {
    if (!isWritten(event.level, plan.level)) {
      return undefined;
    }
    const path = resolveLogFile(plan.file, event.application.name, destination);
    if (path instanceof LoggingError) {
      report(path);
    } else {
      writeRecord({ keep, maxBytes, path, report }, recordOf(event));
    }
    return undefined;
  };
}

/**
 * A plugin that writes each log event as one JSON record, appended to a size-rotated file in the
 * platform's state or log directory, or written to stderr. It is an `onLog` hook and nothing else.
 * It judges the settings at the call, their shape under core's rules and then its own keys.
 */
export function logging(settings?: LoggingSettings): Plugin {
  checkPluginSettings(settings, { call: 'logging', plugin: identity });
  return plugin(identity, { onLog: hookOf(planOf(settings)) });
}

export { LoggingError } from './error.js';
export type { LoggingSettings } from './settings.js';
