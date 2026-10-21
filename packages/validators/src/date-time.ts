import { dateTimeIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { isRealDay } from './date.js';
import { fault } from './faults.js';
import { reject } from './issues.js';
import { timeZone as timeZoneRule } from './rules.js';
import { hour, minute } from './time-units.js';
import { instantOfLocal, isKnownZone } from './zone.js';

interface DateTimeOptions {
  timeZone?: string;
}

const factory = 'dateTime';

/**
 * The published pattern, which is looser than the validator: it admits both forms and every offset
 * spelling and states no range. A `format: 'date-time'` would demand an offset the validator does
 * not.
 */
const layoutPattern = String.raw`^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?(?:[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?)?$`;

const layout =
  /^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})[Tt ](?<hour>[0-9]{2}):(?<minute>[0-9]{2})(?::(?<second>[0-9]{2})(?:\.(?<fraction>[0-9]+))?)?(?:(?<zulu>[Zz])|(?<sign>[+-])(?<offsetHour>[0-9]{2})(?::?(?<offsetMinute>[0-9]{2}))?)?$/u;

const none = 0;
const january = 1;
const lastHour = 23;
const lastMinute = 59;
const lastSecond = 59;

/** The digits of milliseconds a `Date` keeps. */
const millisecondDigits = 3;

/** What one named group of the layout read: its digits, or undefined for a part the token left out. */
type Groups = Readonly<Record<string, string | undefined>>;

/** A group's digits as a number, zero for a group the token left out. */
function numberOf(groups: Groups, name: string): number {
  return Number(groups[name] ?? '0');
}

/** The token's wall time counted as if it were UTC, or undefined when a field is out of range. */
function wallTime(groups: Groups): number | undefined {
  const year = numberOf(groups, 'year');
  const month = numberOf(groups, 'month');
  const day = numberOf(groups, 'day');
  const inRange =
    isRealDay(year, month, day) &&
    numberOf(groups, 'hour') <= lastHour &&
    numberOf(groups, 'minute') <= lastMinute &&
    numberOf(groups, 'second') <= lastSecond;
  if (!inRange) {
    return undefined;
  }
  const moment = new Date(none);
  // `Date.UTC` maps a year below 100 to the 1900s, so the year is set on its own.
  moment.setUTCFullYear(year, month - january, day);
  moment.setUTCHours(
    numberOf(groups, 'hour'),
    numberOf(groups, 'minute'),
    numberOf(groups, 'second'),
    Number((groups.fraction ?? '').slice(none, millisecondDigits).padEnd(millisecondDigits, '0')),
  );
  return moment.getTime();
}

/**
 * The offset the token names in milliseconds, zero for `Z`, undefined when it names none, and
 * `invalid` when its hour or minute is out of range. A missing minute, as in `+05`, counts as zero.
 */
function offsetOf(groups: Groups): number | undefined | 'invalid' {
  if (groups.zulu !== undefined) {
    return none;
  }
  if (groups.sign === undefined) {
    return undefined;
  }
  const hours = numberOf(groups, 'offsetHour');
  const minutes = numberOf(groups, 'offsetMinute');
  if (hours > lastHour || minutes > lastMinute) {
    return 'invalid';
  }
  const magnitude = hours * hour + minutes * minute;
  return groups.sign === '-' ? -magnitude : magnitude;
}

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
 * An ISO 8601 or RFC 3339 date and time, output as a `Date`. A token with an offset or `Z` names
 * that instant. A token with neither is read in `timeZone` when given, else in the host's time
 * zone; a time a clock change skips moves forward, and one it repeats takes the earlier instant.
 * Fractions beyond milliseconds are dropped.
 */
function dateTime(options?: DateTimeOptions): Validator<Date> {
  const pinned = readZone(options);
  const issue = dateTimeIssue.issue({});
  return createValidator({
    inputSchema: { type: 'string', pattern: layoutPattern },
    parse: (raw, context): ParseResult<Date> => {
      const groups = layout.exec(raw)?.groups;
      const wall = groups === undefined ? undefined : wallTime(groups);
      const offset = groups === undefined ? undefined : offsetOf(groups);
      if (groups === undefined || wall === undefined || offset === 'invalid') {
        return reject(issue);
      }
      const instant =
        offset === undefined
          ? instantOfLocal(pinned ?? context.host.timeZone, wall)
          : wall - offset;
      return { value: new Date(instant) };
    },
  });
}

export { dateTime };
export type { DateTimeOptions };
