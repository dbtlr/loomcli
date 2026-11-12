import { calendarDate } from './calendar.js';
import { dateIssue, dateLayoutsIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { reject } from './issues.js';
import { dateRules, firstReading, readingOf } from './layout.js';

/**
 * The options of `date()`: the layouts it accepts beside `YYYY-MM-DD`.
 *
 * @public
 */
interface DateOptions {
  layouts?: readonly [string, ...string[]];
}

/** The default grammar: `YYYY-MM-DD`, published as the date format. */
const grammar = {
  expression: /^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})$/u,
  form: 'YYYY-MM-DD',
  schema: { format: 'date' },
};

/**
 * A calendar date, output as `YYYY-MM-DD` whichever form the token took, because a date has no
 * time or zone. The default grammar reads first, then each layout in order.
 *
 * @public
 */
function date(options?: DateOptions): Validator<string> {
  const { expressions, forms, inputSchema } = readingOf(dateRules, options, grammar);
  const issue = forms === undefined ? dateIssue.issue({}) : dateLayoutsIssue.issue({ forms });
  return createValidator({
    inputSchema,
    parse: (raw): ParseResult<string> => {
      const value = firstReading(raw, expressions, calendarDate);
      return value === undefined ? reject(issue) : { value };
    },
  });
}

export { date };
export type { DateOptions };
