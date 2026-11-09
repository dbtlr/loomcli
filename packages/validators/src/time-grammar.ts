import { timeOfDay } from './calendar.js';
import { hour, minute, second } from './time-units.js';

/**
 * The default grammar of `time()`: RFC 3339's partial time with the seconds optional, as ISO 8601
 * writes a local time. Two-digit hours from 00 through 23, `:`, two-digit minutes, then optional
 * `:` and two-digit seconds and, after seconds, an optional fraction.
 */
const timeGrammar =
  /^(?<hour>[0-9]{2}):(?<minute>[0-9]{2})(?::(?<second>[0-9]{2})(?:\.(?<fraction>[0-9]+))?)?$/u;

/** The published pattern, the grammar whole with each field's range. */
const timePattern = String.raw`^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]+)?)?$`;

/** The width each printed field takes. */
const twoDigits = 2;
const millisecondDigits = 3;

const none = 0;

/** The milliseconds since midnight a token in the default grammar names, or undefined for any other token. */
function readTimeOfDay(raw: string): number | undefined {
  const groups = timeGrammar.exec(raw)?.groups;
  return groups === undefined ? undefined : timeOfDay(groups);
}

/** One field printed with its leading zeros. */
function padded(value: number, width = twoDigits): string {
  return String(value).padStart(width, '0');
}

/**
 * A time of day as a message prints it: `hh:mm`, with `:ss` when the seconds or milliseconds are
 * not zero, and a fraction of the milliseconds with its trailing zeros dropped when they are not.
 */
function formatTimeOfDay(milliseconds: number): string {
  const hours = Math.floor(milliseconds / hour);
  const minutes = Math.floor((milliseconds % hour) / minute);
  const seconds = Math.floor((milliseconds % minute) / second);
  const fraction = milliseconds % second;
  const clock = `${padded(hours)}:${padded(minutes)}`;
  if (seconds === none && fraction === none) {
    return clock;
  }
  const withSeconds = `${clock}:${padded(seconds)}`;
  return fraction === none
    ? withSeconds
    : `${withSeconds}.${padded(fraction, millisecondDigits).replace(/0+$/u, '')}`;
}

export { formatTimeOfDay, readTimeOfDay, timeGrammar, timePattern };
