import type { LoggingError } from './error.js';
import type { OpenTelemetryLogger } from './otel.js';
import type { WrittenLevel } from './record.js';

/** The default size past which the file rotates, and the default number of rotated copies kept. */
const defaultMaxBytes = 10_000_000;
const defaultKeep = 5;

/**
 * The settings of one file, console, or OpenTelemetry destination.
 *
 * @public
 */
type LoggingDestinationSettings =
  | {
      readonly to: 'otel';
      readonly logger: OpenTelemetryLogger;
      readonly level?: WrittenLevel;
    }
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

/**
 * One destination, or a list written in declaration order. With no settings, one default file is used.
 *
 * @public
 */
type LoggingSettings =
  | (Exclude<LoggingDestinationSettings, { readonly to: 'otel' }> & {
      readonly destinations?: never;
    })
  | {
      readonly destinations: readonly LoggingDestinationSettings[];
      readonly to?: never;
      readonly file?: never;
      readonly level?: never;
      readonly maxBytes?: never;
      readonly keep?: never;
      readonly onError?: never;
    };

/** The settings with their defaults filled: where the records go and what the destination needs. */
type LoggingPlan =
  | { readonly to: 'otel'; readonly logger: OpenTelemetryLogger; readonly level: WrittenLevel }
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
function planOf(settings: LoggingDestinationSettings | undefined): LoggingPlan {
  if (settings?.to === 'otel') {
    return { level: settings.level ?? 'info', logger: settings.logger, to: 'otel' };
  }
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

/** Fills defaults for each destination, retaining the single-destination shorthand. */
function plansOf(settings: LoggingSettings | undefined): readonly LoggingPlan[] {
  return settings !== undefined && 'destinations' in settings
    ? settings.destinations.map(planOf)
    : [planOf(settings)];
}

export type { LoggingDestinationSettings, LoggingPlan, LoggingSettings };
export { plansOf };
