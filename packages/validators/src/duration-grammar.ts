import { day, hour, millisecond, minute, second, week } from './time-units.js';

/**
 * The operator's duration grammar: systemd.time(7) spans without a sign. A token is a sequence of
 * decimal numbers each followed by a unit, in any order and repeatable, or one bare number, which
 * counts seconds. Whitespace may sit around the token, between a number and its unit, and between
 * parts. Units are lowercase, and months and years are left out because they have no fixed length.
 */

const none = 0;

/**
 * Each unit's spelling and length in milliseconds. A spelling comes after any longer spelling it
 * begins, so the pattern built from this order matches greedily.
 */
const unitLengths: ReadonlyMap<string, number> = new Map([
  ['minutes', minute],
  ['seconds', second],
  ['minute', minute],
  ['second', second],
  ['hours', hour],
  ['weeks', week],
  ['days', day],
  ['hour', hour],
  ['msec', millisecond],
  ['week', week],
  ['day', day],
  ['min', minute],
  ['sec', second],
  ['hr', hour],
  ['ms', millisecond],
  ['d', day],
  ['h', hour],
  ['m', minute],
  ['s', second],
  ['w', week],
]);

/** The units a message prints a whole number of milliseconds in, longest first. */
const printedUnits: readonly (readonly [string, number])[] = [
  ['d', day],
  ['h', hour],
  ['m', minute],
  ['s', second],
  ['ms', millisecond],
];

const decimal = String.raw`(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)`;

const space = String.raw`\s*`;

const unitSpellings = [...unitLengths.keys()];

const unit = `(?:${unitSpellings.join('|')})`;

/** The grammar as one pattern whose units are the given alternatives. */
function grammarOf(units: string): string {
  const part = `${decimal}${space}${units}`;
  return `^${space}${decimal}(?:${space}${units}(?:${space}${part})*)?${space}$`;
}

/** The pattern the validator publishes, which is the grammar whole. */
const durationPattern = grammarOf(unit);

const grammar = new RegExp(durationPattern, 'u');

/** The grammar with a capital `M` as one more unit, which tells a token that only misspells minutes. */
const grammarWithCapitalM = new RegExp(grammarOf(`(?:M|${unitSpellings.join('|')})`), 'u');

const component = new RegExp(`${space}(?<number>${decimal})${space}(?<unit>${unit})`, 'uy');

const bareNumber = new RegExp(`^${space}${decimal}${space}$`, 'u');

const radix = 10;

/**
 * The milliseconds one decimal number spells in a unit of `length` milliseconds. The digits are
 * scaled to a whole number first, so `1.1s` is 1100 and not 1100.0000000000002.
 */
function scaled(spelled: string, length: number): number {
  const [integral = '', fraction = ''] = spelled.split('.');
  return (Number(`${integral}${fraction}`) * length) / radix ** fraction.length;
}

/**
 * The milliseconds a duration token spells, or undefined when it is outside the grammar or too
 * long to count in safe integers.
 */
function readDuration(raw: string): number | undefined {
  if (!grammar.test(raw)) {
    return undefined;
  }
  let total = none;
  if (bareNumber.test(raw)) {
    total = scaled(raw.trim(), second);
  } else {
    component.lastIndex = none;
    for (let found = component.exec(raw); found !== null; found = component.exec(raw)) {
      total += scaled(
        found.groups?.number ?? '',
        unitLengths.get(found.groups?.unit ?? '') ?? none,
      );
    }
  }
  return Number.isFinite(total) && total <= Number.MAX_SAFE_INTEGER ? total : undefined;
}

/** Whether a token is a duration except that it spells minutes with a capital `M`. */
function spellsMinutesAsCapitalM(raw: string): boolean {
  return raw.includes('M') && grammarWithCapitalM.test(raw);
}

/**
 * A count of milliseconds as the grammar spells it, such as `1h30m` for 5400000. A count that is
 * not a whole number of milliseconds prints as milliseconds alone.
 */
function formatDuration(milliseconds: number): string {
  if (milliseconds === none) {
    return '0s';
  }
  if (!Number.isInteger(milliseconds)) {
    return `${String(milliseconds)}ms`;
  }
  return spelledIn(milliseconds);
}

/** A whole number of milliseconds as each unit's count, longest unit first, empty counts left out. */
function spelledIn(milliseconds: number): string {
  let rest = milliseconds;
  let printed = '';
  for (const [name, length] of printedUnits) {
    const count = Math.floor(rest / length);
    if (count > none) {
      printed += `${String(count)}${name}`;
      rest -= count * length;
    }
  }
  return printed;
}

export { durationPattern, formatDuration, readDuration, spellsMinutesAsCapitalM };
