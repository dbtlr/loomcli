import type { LoggingError } from './error.js';
import type { WrittenLevel } from './record.js';

/** The default size past which the file rotates, and the default number of rotated copies kept. */
const defaultMaxBytes = 10_000_000;
const defaultKeep = 5;

/** What the application tells the logging plugin. */
type LoggingSettings =
  | {
      readonly to?: 'file';
      /** The log file: a name inside the default directory, an absolute path, or a path under ~/. */
      readonly file?: string;
      /** The lowest level written, info by default. A fatal event is never filtered by level. */
      readonly level?: WrittenLevel;
      /** The size in bytes past which the file rotates, 10_000_000 by default. */
      readonly maxBytes?: number;
      /** How many rotated copies are kept, 5 by default. With 0, a rotation deletes the file. */
      readonly keep?: number;
      /** Called for each failure to resolve, create, append to, or rotate the file. Absent, a failure is ignored. */
      readonly onError?: (error: LoggingError) => undefined;
    }
  | {
      readonly to: 'console';
      readonly level?: WrittenLevel;
    };

/** The settings with their defaults filled: where the records go and what the destination needs. */
type LoggingPlan =
  | { readonly to: 'console'; readonly level: WrittenLevel }
  | {
      readonly to: 'file';
      readonly level: WrittenLevel;
      readonly file: string | undefined;
      readonly maxBytes: number;
      readonly keep: number;
      readonly onError: ((error: LoggingError) => undefined) | undefined;
    };

/** Fills each omitted setting with its default. */
function planOf(settings: LoggingSettings | undefined): LoggingPlan {
  if (settings?.to === 'console') {
    return { level: settings.level ?? 'info', to: 'console' };
  }
  return {
    file: settings?.file,
    keep: settings?.keep ?? defaultKeep,
    level: settings?.level ?? 'info',
    maxBytes: settings?.maxBytes ?? defaultMaxBytes,
    onError: settings?.onError,
    to: 'file',
  };
}

export type { LoggingPlan, LoggingSettings };
export { planOf };
