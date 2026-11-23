import { day, second } from './time-units.js';

/**
 * Zone arithmetic over `Intl.DateTimeFormat`, which every supported runtime ships, so a local
 * time reads as an instant without `Temporal`.
 */

const none = 0;

/** The first month's number, which `Date` counts from zero. */
const january = 1;

/** The parts a formatter reports, read by name. */
type PartName = 'day' | 'era' | 'hour' | 'minute' | 'month' | 'second' | 'year';

/** A formatter for a zone, or undefined when the runtime does not know the name. */
function formatterFor(timeZone: string): Intl.DateTimeFormat | undefined {
  try {
    return new Intl.DateTimeFormat('en-US', {
      calendar: 'gregory',
      day: 'numeric',
      era: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
      minute: 'numeric',
      month: 'numeric',
      numberingSystem: 'latn',
      second: 'numeric',
      timeZone,
      year: 'numeric',
    });
  } catch {
    return undefined;
  }
}

/** Whether the runtime knows the name as a time zone. */
function isKnownZone(timeZone: string): boolean {
  return formatterFor(timeZone) !== undefined;
}

/** One part of a formatted instant, read as a number. */
function partOf(parts: readonly Intl.DateTimeFormatPart[], name: PartName): number {
  return Number(parts.find((part) => part.type === name)?.value);
}

/** Whether the formatted instant falls before the common era. */
function isBeforeCommonEra(parts: readonly Intl.DateTimeFormatPart[]): boolean {
  return parts.some((part) => part.type === 'era' && part.value.startsWith('B'));
}

/** The milliseconds a zone's wall clock is ahead of UTC at an instant. */
function offsetAt(formatter: Intl.DateTimeFormat, instant: number): number {
  const parts = formatter.formatToParts(instant);
  const year = partOf(parts, 'year');
  const wall = new Date(none);
  // A year before the common era counts down from 1 BC, so astronomical year 0 reads as 1 BC.
  wall.setUTCFullYear(
    isBeforeCommonEra(parts) ? january - year : year,
    partOf(parts, 'month') - january,
    partOf(parts, 'day'),
  );
  wall.setUTCHours(partOf(parts, 'hour'), partOf(parts, 'minute'), partOf(parts, 'second'), none);
  // The parts hold whole seconds, so the instant's own milliseconds are put back before comparing.
  const milliseconds = ((instant % second) + second) % second;
  return wall.getTime() + milliseconds - instant;
}

/**
 * The instant a zone's wall clock reads `local`, a wall time counted as if it were UTC, under
 * Temporal's `compatible` disambiguation: a time repeated by a clock set back takes the earlier
 * instant, and a time skipped by a clock set forward moves forward by the length of the gap.
 */
function instantOfLocal(timeZone: string, local: number): number {
  const formatter = formatterFor(timeZone);
  if (formatter === undefined) {
    throw new RangeError(`Unknown time zone ${timeZone}.`);
  }
  // Two transitions are never within a day of each other.
  // So the zone's offsets a day either side of the wall time are the only two that can apply.
  const before = offsetAt(formatter, local - day);
  const after = offsetAt(formatter, local + day);
  const candidates = [...new Set([local - before, local - after])].filter(
    (instant) => offsetAt(formatter, instant) === local - instant,
  );
  return candidates.length > none ? Math.min(...candidates) : local - before;
}

export { instantOfLocal, isKnownZone };
