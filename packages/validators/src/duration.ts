import { boundsIssue, withinBounds } from './bounds.js';
import type { Bounds } from './bounds.js';
import { durationCapitalMIssue, durationCodes } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import {
  durationPattern,
  formatDuration,
  readDuration,
  spellsMinutesAsCapitalM,
} from './duration-grammar.js';
import { fault } from './faults.js';
import { reject } from './issues.js';
import { boundsOrder, boundValue } from './rules.js';

/** Inclusive bounds, each a duration spelled in the operator's grammar, such as `30`, `24h`, or `1 day`. */
interface DurationOptions {
  min?: string;
  max?: string;
}

const factory = 'duration';

/** One bound as milliseconds, or undefined when the factory declares none; a bad bound faults. */
function boundOf(
  options: DurationOptions | undefined,
  name: 'min' | 'max',
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const milliseconds = readDuration(value);
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
function readDurationBounds(options: DurationOptions | undefined): Bounds {
  const min = boundOf(options, 'min', options?.min);
  const max = boundOf(options, 'max', options?.max);
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
 * `max`, both inclusive. A bare number counts seconds, and a unit is a systemd.time(7) spelling
 * such as `ms`, `sec`, `min`, `hr`, `day`, or `weeks`. Whitespace may separate the parts.
 */
function duration(options?: DurationOptions): Validator<number> {
  const bounds = readDurationBounds(options);
  const issue = boundsIssue(durationCodes, bounds);
  const capitalMIssue = durationCapitalMIssue.issue({});
  return createValidator({
    inputSchema: { type: 'string', pattern: durationPattern },
    parse: (raw): ParseResult<number> => {
      const value = readDuration(raw);
      if (value === undefined && spellsMinutesAsCapitalM(raw)) {
        return reject(capitalMIssue);
      }
      return value !== undefined && withinBounds(value, bounds) ? { value } : reject(issue);
    },
  });
}

export { duration };
export type { DurationOptions };
