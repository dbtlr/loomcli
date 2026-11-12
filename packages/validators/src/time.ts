import { boundsIssue, readSpelledBounds, withinBounds } from './bounds.js';
import type { SpelledBoundOptions } from './bounds.js';
import { timeOfDay } from './calendar.js';
import { timeCodes, timeLayoutsIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { reject } from './issues.js';
import { firstReading, readingOf, timeRules } from './layout.js';
import { formatTimeOfDay, readTimeOfDay, timeGrammar, timePattern } from './time-grammar.js';

/**
 * Inclusive bounds, each a time of day in the default grammar, such as `'09:00'`, and layouts.
 *
 * @public
 */
interface TimeOptions extends SpelledBoundOptions {
  layouts?: readonly [string, ...string[]];
}

const factory = 'time';

/** The default grammar, published whole as its pattern. */
const grammar = { expression: timeGrammar, form: 'hh:mm', schema: { pattern: timePattern } };

/**
 * A time of day, output as the number of milliseconds since midnight, the unit `duration()` uses,
 * within `min` and `max`, both inclusive. The default grammar reads first, then each layout in
 * order. A fraction beyond milliseconds is dropped.
 *
 * @public
 */
function time(options?: TimeOptions): Validator<number> {
  const bounds = readSpelledBounds(factory, options, {
    examples: '"09:00" or "17:30"',
    format: formatTimeOfDay,
    noun: 'a time of day',
    read: readTimeOfDay,
  });
  const { expressions, forms, inputSchema } = readingOf(timeRules, options, grammar);
  const bounded = bounds.min !== undefined || bounds.max !== undefined;
  // A bounded time answers its bounds sentence alone, whatever its layouts.
  const issue =
    bounded || forms === undefined
      ? boundsIssue(timeCodes, bounds)
      : timeLayoutsIssue.issue({ forms });
  return createValidator({
    inputSchema,
    parse: (raw): ParseResult<number> => {
      const value = firstReading(raw, expressions, timeOfDay);
      return value !== undefined && withinBounds(value, bounds) ? { value } : reject(issue);
    },
  });
}

export { time };
export type { TimeOptions };
