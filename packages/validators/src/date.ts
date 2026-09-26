import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { reject } from './issues.js';

const layout = /^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})$/u;

/**
 * Five 400-year Gregorian cycles.
 * The calendar repeats every cycle, so a shifted year keeps its leap days, and the shift moves
 * years below 100 out of the range `Date.UTC` maps to the 1900s.
 */
const cycleShift = 2000;

/** The number of the first month, which `Date.UTC` counts from zero. */
const january = 1;

/** Whether the parts name a real day of the proleptic Gregorian calendar. */
function isRealDay(year: number, month: number, day: number): boolean {
  const monthIndex = month - january;
  const probe = new Date(Date.UTC(year + cycleShift, monthIndex, day));
  return probe.getUTCMonth() === monthIndex && probe.getUTCDate() === day;
}

/** A calendar date as `YYYY-MM-DD`, kept as the token because a date has no time or zone. */
function date(): Validator<string> {
  return createValidator({
    inputSchema: { format: 'date', type: 'string' },
    parse: (raw): ParseResult<string> => {
      const parts = layout.exec(raw)?.groups;
      const real =
        parts !== undefined &&
        isRealDay(Number(parts.year), Number(parts.month), Number(parts.day));
      return real ? { value: raw } : reject('Expected a date as YYYY-MM-DD, such as 2026-09-25.');
    },
  });
}

export { date };
