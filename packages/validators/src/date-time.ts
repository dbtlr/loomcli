import { offsetGroups, offsetOf, offsetPattern, wallTime } from './calendar.js';
import { dateTimeIssue, dateTimeLayoutsIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault } from './faults.js';
import { reject } from './issues.js';
import { dateTimeRules, firstReading, readingOf } from './layout.js';
import { timeZone as timeZoneRule } from './rules.js';
import { instantOfLocal, isKnownZone } from './zone.js';

/**
 * The options of `dateTime()`: inclusive bounds, layouts, and the time zone it reads in.
 *
 * @public
 */
interface DateTimeOptions {
  timeZone?: string;
  layouts?: readonly [string, ...string[]];
}

const factory = 'dateTime';

/**
 * The published pattern, which is looser than the validator: it admits both forms and every offset
 * spelling and states no range. A `format: 'date-time'` would demand an offset the validator does
 * not.
 */
const defaultPattern = `${String.raw`^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?`}(?:${offsetPattern})?$`;

/** The default grammar: an ISO 8601 or RFC 3339 date and time, published as its pattern. */
const grammar = {
  expression: new RegExp(
    `${String.raw`^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})[Tt ](?<hour>[0-9]{2}):(?<minute>[0-9]{2})(?::(?<second>[0-9]{2})(?:\.(?<fraction>[0-9]+))?)?`}(?:${offsetGroups})?$`,
    'u',
  ),
  form: 'YYYY-MM-DDThh:mm',
  schema: { pattern: defaultPattern },
};

/** Checks a pinned zone, which must be an IANA name the runtime knows. */
function readZone(options: DateTimeOptions | undefined): string | undefined {
  const declared = options?.timeZone;
  if (declared === undefined) {
    return undefined;
  }
  if (!isKnownZone(declared)) {
    throw fault(
      timeZoneRule,
      { arguments: [options], factory, mark: '0.timeZone' },
      {
        correction: 'Supply a name such as America/New_York.',
        sentence: 'dateTime() timeZone is not an IANA time zone name.',
      },
    );
  }
  return declared;
}

/**
 * An ISO 8601 or RFC 3339 date and time, or a token one of the layouts reads, output as a `Date`.
 * A token with an offset or `Z` names that instant. A token with neither is read in `timeZone`
 * when given, else in the host's time zone; a time a clock change skips moves forward, and one it
 * repeats takes the earlier instant. Fractions beyond milliseconds are dropped.
 *
 * @public
 */
function dateTime(options?: DateTimeOptions): Validator<Date> {
  const pinned = readZone(options);
  const { expressions, forms, inputSchema } = readingOf(dateTimeRules, options, grammar);
  const issue =
    forms === undefined ? dateTimeIssue.issue({}) : dateTimeLayoutsIssue.issue({ forms });
  return createValidator({
    inputSchema,
    parse: (raw, context): ParseResult<Date> => {
      const instant = firstReading(raw, expressions, (groups) => {
        const wall = wallTime(groups);
        const offset = offsetOf(groups);
        if (wall === undefined || offset === 'invalid') {
          return undefined;
        }
        return offset === undefined
          ? instantOfLocal(pinned ?? context.host.timeZone, wall)
          : wall - offset;
      });
      return instant === undefined ? reject(issue) : { value: new Date(instant) };
    },
  });
}

export { dateTime };
export type { DateTimeOptions };
