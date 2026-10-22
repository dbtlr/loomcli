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

/** A pace given with its unit, such as `5:00/km` or `8:03 /mi`. */
const pacePattern = /^(?<time>[\d:]+) ?\/(?<unit>[a-z]+)$/u;

/** How much slower than the average a negative split runs its first half, and faster its second. */
const negativeShift = 0.02;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function roundTo(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/** The seconds a plan has run when it reaches `at` metres. */
function elapsedAt(plan: SplitPlan, at: number): number {
  const shift = plan.negative ? negativeShift : 0;
  const perMetre = plan.seconds / plan.metres;
  const half = plan.metres / 2;
  const firstHalf = Math.min(at, half) * perMetre * (1 + shift);
  const secondHalf = Math.max(at - half, 0) * perMetre * (1 - shift);
  return firstHalf + secondHalf;
}

/** Where each split ends, in metres: every `every` metres, and the finish. */
function splitEnds(metres: number, every: number): number[] {
  return Array.from({ length: splitCount(metres, every) }, (_entry, index) =>
    Math.min((index + 1) * every, metres),
  );
}

/** The unit a pace is measured per: kilometres or miles. */
export type Unit = 'km' | 'mi';

/** A pace: the seconds a runner takes to cover one unit. */
export interface Pace {
  readonly seconds: number;
  readonly unit: Unit;
}

/** A run to split: its length and time, how often to split it, and in which unit. */
export interface SplitPlan {
  readonly metres: number;
  readonly seconds: number;
  /** The length of each split, in metres. */
  readonly every: number;
  readonly unit: Unit;
  /** Whether to run the second half faster than the first. */
  readonly negative: boolean;
}

/** One split of a run. */
export interface Split {
  /** The split's number, counted from 1. */
  readonly split: number;
  /** Where the split ends, in `unit`, to two decimals. */
  readonly distance: number;
  readonly unit: Unit;
  /** The seconds the split takes. */
  readonly time: number;
  /** The seconds from the start to the end of the split. */
  readonly elapsed: number;
}

// #region domain-error
/** A split longer than the run it splits. */
export class SplitLongerThanRunError extends RangeError {
  /** The split's length, in metres. */
  readonly every: number;
  /** The run's length, in metres. */
  readonly metres: number;
  readonly unit: Unit;

  constructor({ every, metres, unit }: SplitPlan) {
    super('The split is longer than the run.');
    this.name = 'SplitLongerThanRunError';
    this.every = every;
    this.metres = metres;
    this.unit = unit;
  }
}
// #endregion

/** The metres in one `unit`. */
export function unitLength(unit: Unit): number {
  return metresPer[unit];
}

/** Reads a unit, `km` or `mi`, or `undefined`. */
export function parseUnit(text: string): Unit | undefined {
  return text === 'km' || text === 'mi' ? text : undefined;
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

/** Reads a pace such as `5:00/km` or `8:03/mi`, or `undefined`. */
export function parsePace(text: string): Pace | undefined {
  const groups = pacePattern.exec(text)?.groups;
  const seconds = parseTime(groups?.time ?? '');
  const unit = parseUnit(groups?.unit ?? '');
  return seconds === undefined || unit === undefined ? undefined : { seconds, unit };
}

/** The same pace per another unit, to the nearest second. */
export function convertPace(pace: Pace, unit: Unit): Pace {
  return paceOf(metresPer[pace.unit], pace.seconds, unit);
}

/** How many splits of `every` metres a run of `metres` takes, the last one perhaps shorter. */
export function splitCount(metres: number, every: number): number {
  return Math.ceil(roundTo(metres / every, 6));
}

// #region split-run
/** The splits of a run, each with its own time and the time elapsed at its end. */
export function splitRun(plan: SplitPlan): Split[] {
  if (plan.every > plan.metres) {
    throw new SplitLongerThanRunError(plan);
  }
  const ends = splitEnds(plan.metres, plan.every);
  return ends.map((end, index) => {
    const start = ends[index - 1] ?? 0;
    return {
      distance: roundTo(end / metresPer[plan.unit], 2),
      elapsed: Math.round(elapsedAt(plan, end)),
      split: index + 1,
      time: Math.round(elapsedAt(plan, end) - elapsedAt(plan, start)),
      unit: plan.unit,
    };
  });
}
// #endregion

/** The pace of a run of `metres` that took `seconds`, per `unit`, to the nearest second. */
export function paceOf(metres: number, seconds: number, unit: Unit): Pace {
  return { seconds: Math.round((seconds * metresPer[unit]) / metres), unit };
}

/** Writes a distance in metres in `unit`, such as `5 km` or `3.11 mi`. */
export function formatDistance(metres: number, unit: Unit): string {
  return `${String(roundTo(metres / metresPer[unit], 2))} ${unit}`;
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
