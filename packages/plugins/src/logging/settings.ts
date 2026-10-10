import { DeclarationError } from '@loomcli/core';

import { packageName } from '../constants.js';
import { loggingSettings } from '../rules.js';
import type { LoggingError } from './error.js';
import { isWrittenLevel } from './record.js';
import type { WrittenLevel } from './record.js';

const identity = `${packageName}/logging`;

/** The default size past which the file rotates, and the default number of rotated copies kept. */
const defaultMaxBytes = 10_000_000;
const defaultKeep = 5;

/** The smallest `maxBytes` or `keep` that means anything. */
const SMALLEST = 1;

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
      /** How many rotated copies are kept, 5 by default. */
      readonly keep?: number;
      /** Called for each failure to resolve, create, append to, or rotate the file. Absent, a failure is ignored. */
      readonly onError?: (error: LoggingError) => undefined;
    }
  | {
      readonly to: 'console';
      readonly level?: WrittenLevel;
    };

/** The settings judged and defaulted: where the records go and what the destination needs. */
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

/** One key's rule: what it accepts, and the two sentences a fault in it carries. */
interface KeyRule {
  readonly key: string;
  readonly accepts: (value: unknown) => boolean;
  readonly problem: string;
  readonly correction: string;
}

/** Whether a value is a whole number from 1 through the largest a number holds exactly. */
function isPositiveWhole(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= SMALLEST;
}

/** Whether a value is a nonempty string that holds no control character. */
function isFileName(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && !/\p{Cc}/u.test(value);
}

const wholeNumber: Omit<KeyRule, 'key'> = {
  accepts: isPositiveWhole,
  correction: 'Supply a whole number of 1 or more.',
  problem: 'is not a positive whole number.',
};

/** The destination's rule, judged first because the console limits the keys after it. */
const destinationRule: KeyRule = {
  accepts: (value) => value === 'file' || value === 'console',
  correction: 'Supply "file" or "console", or omit the setting.',
  key: 'to',
  problem: 'is not "file" or "console".',
};

/** The rest of the keys, in the order the contract lists them. */
const keyRules: readonly KeyRule[] = [
  {
    accepts: isFileName,
    correction: 'Supply a file name, an absolute path, or a path under "~/", or omit the setting.',
    key: 'file',
    problem: 'is not a nonempty string without a control character.',
  },
  {
    accepts: isWrittenLevel,
    correction: 'Supply "trace", "debug", "info", "warn", or "error", or omit the setting.',
    key: 'level',
    problem: 'is not a written level.',
  },
  { ...wholeNumber, key: 'maxBytes' },
  { ...wholeNumber, key: 'keep' },
  {
    accepts: (value) => typeof value === 'function',
    correction: 'Supply a function, or omit the setting.',
    key: 'onError',
    problem: 'is not a function.',
  },
];

/** The keys the console destination cannot use, because they describe the file. */
const fileOnlyKeys = new Set(['file', 'maxBytes', 'keep', 'onError']);

/** The fault in one key of the `logging()` call's settings. */
function settingFault(
  settings: unknown,
  { correction, key, problem }: Omit<KeyRule, 'accepts'>,
): DeclarationError {
  return new DeclarationError(loggingSettings, {
    correction,
    findings: [{ arguments: [settings], call: 'logging', mark: `0.${key}` }],
    sentence: `Plugin "${identity}" setting "${key}" ${problem}`,
  });
}

/** Throws the fault for one key whose value is set and is not one its rule accepts. */
function judgeKey(settings: Readonly<Record<string, unknown>>, rule: KeyRule): void {
  const value = settings[rule.key];
  if (value !== undefined && !rule.accepts(value)) {
    throw settingFault(settings, rule);
  }
}

/**
 * Throws the fault for the first key at fault, walking the keys in the order the contract lists
 * them. Beside `to: 'console'`, a key that describes the file is judged by that conflict before
 * its own rule. An omitted key, or one that is `undefined`, is not set.
 */
function judgeKeys(settings: Readonly<Record<string, unknown>>): void {
  const toConsole = settings.to === 'console';
  for (const rule of [destinationRule, ...keyRules]) {
    if (toConsole && fileOnlyKeys.has(rule.key) && settings[rule.key] !== undefined) {
      throw settingFault(settings, {
        correction: 'Remove the setting, or set "to" to "file".',
        key: rule.key,
        problem: 'is not accepted when "to" is "console".',
      });
    }
    judgeKey(settings, rule);
  }
}

/**
 * Judges the settings' own keys, after core's rules for any plugin's settings, and fills the
 * defaults. The keys are judged through an untyped view of the same object, so the typed reads
 * after it hold because the judgment passed.
 */
function planOf(settings: LoggingSettings | undefined): LoggingPlan {
  if (settings === undefined) {
    return {
      file: undefined,
      keep: defaultKeep,
      level: 'info',
      maxBytes: defaultMaxBytes,
      onError: undefined,
      to: 'file',
    };
  }
  judgeKeys(settings);
  if (settings.to === 'console') {
    return { level: settings.level ?? 'info', to: 'console' };
  }
  return {
    file: settings.file,
    keep: settings.keep ?? defaultKeep,
    level: settings.level ?? 'info',
    maxBytes: settings.maxBytes ?? defaultMaxBytes,
    onError: settings.onError,
    to: 'file',
  };
}

export type { LoggingPlan, LoggingSettings };
export { planOf };
