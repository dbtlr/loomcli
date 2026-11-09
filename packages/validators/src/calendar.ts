import { hour, minute, second } from './time-units.js';

/**
 * The fields the date and time validators read, shared by each default grammar and every layout.
 * A grammar or a layout captures each field under one group name, `year`, `month`, `day`, `hour`,
 * `minute`, `second`, `fraction`, `meridiem`, and the offset's `zulu`, `sign`, `offsetHour`, and
 * `offsetMinute`, so one reading checks each field's range and turns the fields into a value.
 */

/** An offset as a pattern states it: `Z`, `z`, or a sign and `hh`, `hhmm`, or `hh:mm`, with no range. */
const offsetPattern = String.raw`[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?`;

/** The same offset with each part captured under the group name `offsetOf` reads. */
const offsetGroups = String.raw`(?<zulu>[Zz])|(?<sign>[+-])(?<offsetHour>[0-9]{2})(?::?(?<offsetMinute>[0-9]{2}))?`;

/** What one match captured: each group's text, or undefined for a part the token left out. */
type Groups = Readonly<Record<string, string | undefined>>;

const none = 0;

/** The number of the first month, which `Date` counts from zero. */
const january = 1;

const lastHour = 23;
const lastMinute = 59;
const lastSecond = 59;

/** The hours a 12-hour clock reads, before its `AM` or `PM` applies. */
const firstClockHour = 1;
const lastClockHour = 12;
const halfDay = 12;

/** The digits of milliseconds a `Date` keeps. */
const millisecondDigits = 3;

/** The width a month or a day prints in. */
const twoDigits = 2;

/**
 * Five 400-year Gregorian cycles.
 * The calendar repeats every cycle, so a shifted year keeps its leap days, and the shift moves
 * years below 100 out of the range `Date.UTC` maps to the 1900s.
 */
const cycleShift = 2000;

/** Whether the parts name a real day of the proleptic Gregorian calendar. */
function isRealDay(year: number, month: number, day: number): boolean {
  const monthIndex = month - january;
  const probe = new Date(Date.UTC(year + cycleShift, monthIndex, day));
  return probe.getUTCMonth() === monthIndex && probe.getUTCDate() === day;
}

/** A group's digits as a number, zero for a group the token left out. */
function numberOf(groups: Groups, name: string): number {
  return Number(groups[name] ?? '0');
}

/** The date the groups name as `YYYY-MM-DD`, or undefined when it is not a real day. */
function calendarDate(groups: Groups): string | undefined {
  const { day = '', month = '', year = '' } = groups;
  return isRealDay(Number(year), Number(month), Number(day))
    ? `${year}-${month.padStart(twoDigits, '0')}-${day.padStart(twoDigits, '0')}`
    : undefined;
}

/**
 * The hour from 0 through 23, or undefined when it is out of range. With a `meridiem`, the hour is
 * a 12-hour clock's, 1 through 12, so `12AM` is midnight and `12PM` noon.
 */
function hourOf(groups: Groups): number | undefined {
  const value = numberOf(groups, 'hour');
  const { meridiem } = groups;
  if (meridiem === undefined) {
    return value <= lastHour ? value : undefined;
  }
  if (value < firstClockHour || value > lastClockHour) {
    return undefined;
  }
  const afternoon = meridiem.toUpperCase() === 'PM' ? halfDay : none;
  return (value % halfDay) + afternoon;
}

/** A fraction of a second as milliseconds, truncated rather than rounded. */
function millisecondsOf(fraction: string | undefined): number {
  return Number((fraction ?? '').slice(none, millisecondDigits).padEnd(millisecondDigits, '0'));
}

/** The milliseconds since midnight the groups name, or undefined when a field is out of range. */
function timeOfDay(groups: Groups): number | undefined {
  const hours = hourOf(groups);
  const minutes = numberOf(groups, 'minute');
  const seconds = numberOf(groups, 'second');
  if (hours === undefined || minutes > lastMinute || seconds > lastSecond) {
    return undefined;
  }
  return hours * hour + minutes * minute + seconds * second + millisecondsOf(groups.fraction);
}

/** The wall time the groups name, counted as if it were UTC, or undefined when a field is out of range. */
function wallTime(groups: Groups): number | undefined {
  const year = numberOf(groups, 'year');
  const month = numberOf(groups, 'month');
  const day = numberOf(groups, 'day');
  const sinceMidnight = timeOfDay(groups);
  if (!isRealDay(year, month, day) || sinceMidnight === undefined) {
    return undefined;
  }
  const midnight = new Date(none);
  // `Date.UTC` maps a year below 100 to the 1900s, so the year is set on its own.
  midnight.setUTCFullYear(year, month - january, day);
  return midnight.getTime() + sinceMidnight;
}

/**
 * The offset the groups name in milliseconds, zero for `Z`, undefined when they name none, and
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

export {
  calendarDate,
  isRealDay,
  millisecondDigits,
  offsetGroups,
  offsetOf,
  offsetPattern,
  timeOfDay,
  twoDigits,
  wallTime,
};
export type { Groups };
