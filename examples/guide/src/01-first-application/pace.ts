// The arithmetic of a running pace. The module knows nothing of Loom, so an action stays short.

const metresPerKilometre = 1000;
const metresPerMile = 1609.344;
const secondsPerMinute = 60;
const secondsPerHour = 3600;

/** The metres in one of each unit. */
const metresPer: Readonly<Record<Unit, number>> = { km: metresPerKilometre, mi: metresPerMile };

/** The metres each distance suffix stands for. */
const suffixes: ReadonlyMap<string, number> = new Map([
  ['k', metresPerKilometre],
  ['km', metresPerKilometre],
  ['m', 1],
  ['mi', metresPerMile],
]);

/** The races a runner names rather than measures. `5k` and `10k` already read as distances. */
const races: ReadonlyMap<string, number> = new Map([
  ['half', 21_097.5],
  ['marathon', 42_195],
]);

const distancePattern = /^(?<amount>\d+(?:\.\d+)?)(?<suffix>[a-z]+)$/u;

/** `h:mm:ss`, whose minutes stay below 60, or `mm:ss`, whose minutes may run past 59. */
const timePattern =
  /^(?:(?<hours>\d+):(?<hourMinutes>[0-5]\d)|(?<minutes>\d+)):(?<seconds>[0-5]\d)$/u;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** The unit a pace is measured per: kilometres or miles. */
export type Unit = 'km' | 'mi';

/** A pace: the seconds a runner takes to cover one unit. */
export interface Pace {
  readonly seconds: number;
  readonly unit: Unit;
}

/** Reads a distance such as `10k`, `5mi`, `400m`, or `half` as metres, or `undefined`. */
export function parseDistance(text: string): number | undefined {
  const race = races.get(text);
  if (race !== undefined) {
    return race;
  }
  const groups = distancePattern.exec(text)?.groups;
  const perSuffix = suffixes.get(groups?.suffix ?? '');
  if (groups === undefined || perSuffix === undefined) {
    return undefined;
  }
  const metres = Number(groups.amount) * perSuffix;
  return metres > 0 ? metres : undefined;
}

/** Reads a time such as `25:30` or `1:45:00` as seconds, or `undefined`. */
export function parseTime(text: string): number | undefined {
  const groups = timePattern.exec(text)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const hours = Number(groups.hours ?? 0);
  const minutes = Number(groups.hourMinutes ?? groups.minutes);
  const seconds = hours * secondsPerHour + minutes * secondsPerMinute + Number(groups.seconds);
  return seconds > 0 ? seconds : undefined;
}

/** The pace of a run of `metres` that took `seconds`, per `unit`, to the nearest second. */
export function paceOf(metres: number, seconds: number, unit: Unit): Pace {
  return { seconds: Math.round((seconds * metresPer[unit]) / metres), unit };
}

/** Writes a duration in seconds as `m:ss`, or `h:mm:ss` from an hour up. */
export function formatDuration(duration: number): string {
  const whole = Math.round(duration);
  const hours = Math.floor(whole / secondsPerHour);
  const minutes = Math.floor((whole % secondsPerHour) / secondsPerMinute);
  const seconds = twoDigits(whole % secondsPerMinute);
  return hours > 0
    ? `${String(hours)}:${twoDigits(minutes)}:${seconds}`
    : `${String(minutes)}:${seconds}`;
}

/** Writes a pace as `m:ss /km` or `m:ss /mi`. */
export function formatPace(pace: Pace): string {
  return `${formatDuration(pace.seconds)} /${pace.unit}`;
}
