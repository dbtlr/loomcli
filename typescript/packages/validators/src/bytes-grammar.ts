/**
 * The operator's size grammar under IEC 80000-13: one decimal number and an optional unit, with
 * whitespace between them and around the token. `B` is a byte, a decimal prefix is a power of 1000
 * and needs its `B`, and a binary prefix is a power of 1024 with or without its `B`. Units are
 * case-sensitive, except that the decimal kilo prefix may be written `k` or `K`.
 */

import { decimal } from './duration-grammar.js';

const byte = 1;
const kilo = 1000;
const mega = kilo * kilo;
const giga = mega * kilo;
const tera = giga * kilo;
const peta = tera * kilo;
const kibi = 1024;
const mebi = kibi * kibi;
const gibi = mebi * kibi;
const tebi = gibi * kibi;
const pebi = tebi * kibi;

/** Each unit a message prints, with its length in bytes: the byte, the decimal, then the binary units. */
const printedUnits: readonly (readonly [string, number])[] = [
  ['B', byte],
  ['kB', kilo],
  ['MB', mega],
  ['GB', giga],
  ['TB', tera],
  ['PB', peta],
  ['KiB', kibi],
  ['MiB', mebi],
  ['GiB', gibi],
  ['TiB', tebi],
  ['PiB', pebi],
];

/** Each spelling the grammar reads, with its length in bytes. */
const unitLengths: ReadonlyMap<string, number> = new Map([
  ...printedUnits,
  ['KB', kilo],
  ['Ki', kibi],
  ['Mi', mebi],
  ['Gi', gibi],
  ['Ti', tebi],
  ['Pi', pebi],
]);

/**
 * The units as alternatives, a binary prefix with its `B` before the same prefix alone, and the
 * kilo prefix as one class for its two cases.
 */
const unit = '(?:KiB|MiB|GiB|TiB|PiB|Ki|Mi|Gi|Ti|Pi|[kK]B|MB|GB|TB|PB|B)';

/** The pattern the validator publishes, which is the grammar whole. */
const bytesPattern = String.raw`^\s*${decimal}\s*${unit}?\s*$`;

const grammar = new RegExp(String.raw`^\s*(?<number>${decimal})\s*(?<unit>${unit})?\s*$`, 'u');

const none = 0n;
const ten = 10n;
const largest = BigInt(Number.MAX_SAFE_INTEGER);
const noRemainder = 0;

/**
 * The whole bytes a decimal number spells in a unit of `length` bytes, or undefined for a fraction
 * of a byte. The digits are read as an exact decimal, so `2.01kB` is 2010 and not
 * 2009.9999999999998.
 */
function wholeBytes(spelled: string, length: number): bigint | undefined {
  const [integral = '', fraction = ''] = spelled.split('.');
  const scaled = BigInt(`${integral}${fraction}`) * BigInt(length);
  const divisor = ten ** BigInt(fraction.length);
  return scaled % divisor === none ? scaled / divisor : undefined;
}

/**
 * The bytes a size token spells, or undefined when it is outside the grammar, spells a fraction of
 * a byte, or is beyond the safe integers.
 */
function readBytes(raw: string): number | undefined {
  const found = grammar.exec(raw);
  const length = unitLengths.get(found?.groups?.unit ?? 'B') ?? byte;
  const bytes = found === null ? undefined : wholeBytes(found.groups?.number ?? '', length);
  return bytes !== undefined && bytes <= largest ? Number(bytes) : undefined;
}

/**
 * A byte count as the grammar spells it in a message: the whole-number spelling with the fewest
 * digits, a decimal unit on a tie, and `0B` for 0, so 1048576 is `1MiB` and 1500 is `1500B`.
 */
function formatBytes(bytes: number): string {
  let best = `${String(bytes)}B`;
  let digits = String(bytes).length;
  for (const [name, length] of printedUnits) {
    const count = String(bytes / length);
    if (bytes % length === noRemainder && count.length < digits) {
      best = `${count}${name}`;
      digits = count.length;
    }
  }
  return best;
}

export { bytesPattern, formatBytes, readBytes };
