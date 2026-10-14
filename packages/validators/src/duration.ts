import { boundsIssue, withinBounds } from './bounds.js';
import type { Bounds } from './bounds.js';
import { durationCodes } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { durationPattern, formatDuration, readDuration } from './duration-grammar.js';
import { fault, readOptions } from './faults.js';
import { reject } from './issues.js';
import { boundsOrder, boundValue } from './rules.js';

/** Inclusive bounds, each a duration spelled in the operator's grammar, such as `30` or `24h`. */
interface DurationOptions {
  min?: string;
  max?: string;
}

const factory = 'duration';

/** One bound as milliseconds, or undefined when the factory declares none; a bad bound faults. */
function boundOf(options: unknown, name: 'min' | 'max', value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const milliseconds = typeof value === 'string' ? readDuration(value) : undefined;
  if (milliseconds === undefined) {
    throw fault(
      boundValue,
      { arguments: [options], factory, mark: `0.${name}` },
      {
        correction: 'Supply a duration such as "30s" or "2h30m".',
        sentence: `duration() ${name} is not a duration.`,
      },
    );
  }
  return milliseconds;
}

/** Reads `min` and `max`, and faults on a bad bound or a `min` above `max`. */
function readDurationBounds(options: unknown): Bounds {
  const declared = readOptions(factory, options);
  const min = boundOf(options, 'min', declared.min);
  const max = boundOf(options, 'max', declared.max);
  if (min !== undefined && max !== undefined && min > max) {
    throw fault(
      boundsOrder,
      { arguments: [options], factory, mark: '0.min' },
      {
        correction: 'Supply a min at or below max.',
        sentence: `duration() min ${formatDuration(min)} is above max ${formatDuration(max)}.`,
      },
    );
  }
  return { max, min };
}

/**
 * A length of time in the operator's grammar, output as a number of milliseconds within `min` and
 * `max`, both inclusive. A bare number counts seconds, and a unit is `ms`, `s`, `m`, `h`, `d`, or
 * `w`.
 */
function duration(options?: DurationOptions): Validator<number> {
  const bounds = readDurationBounds(options);
  const issue = boundsIssue(durationCodes, bounds);
  return createValidator({
    inputSchema: { type: 'string', pattern: durationPattern },
    parse: (raw): ParseResult<number> => {
      const value = readDuration(raw);
      return value !== undefined && withinBounds(value, bounds) ? { value } : reject(issue);
    },
  });
}

export { duration };
export type { DurationOptions };
