import { boundsIssue, readSpelledBounds, withinBounds } from './bounds.js';
import type { SpelledBoundOptions } from './bounds.js';
import { durationCapitalMIssue, durationCodes } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import {
  durationPattern,
  formatDuration,
  readDuration,
  spellsMinutesAsCapitalM,
} from './duration-grammar.js';
import { reject } from './issues.js';

/**
 * Inclusive bounds, each a duration spelled in the operator's grammar, such as `30`, `24h`, or `1 day`.
 *
 * @public
 */
type DurationOptions = SpelledBoundOptions;

const factory = 'duration';

/**
 * A length of time in the operator's grammar, output as a number of milliseconds within `min` and
 * `max`, both inclusive. A bare number counts seconds, and a unit is a systemd.time(7) spelling
 * such as `ms`, `sec`, `min`, `hr`, `day`, or `weeks`. Whitespace may separate the parts.
 *
 * @example
 * ```ts
 * import { duration } from '@loomcli/validators';
 *
 * const timeout = duration({ min: '1s', max: '1h' });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#duration
 *
 * @public
 */
function duration(options?: DurationOptions): Validator<number> {
  const bounds = readSpelledBounds(factory, options, {
    examples: '"30s" or "2h30m"',
    format: formatDuration,
    noun: 'a duration',
    read: readDuration,
  });
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
