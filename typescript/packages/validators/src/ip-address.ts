/**
 * The IP address grammar `ip()`, `cidr()`, and `host()` share. IPv4 is four decimal parts with no
 * leading zero; IPv6 is a text form of RFC 4291 with no zone and no brackets. Each reads into its
 * parts, and the canonical text is the form RFC 5952 recommends.
 */

/**
 * One IP address family.
 *
 * @public
 */
// The two families are the contract's own literal type, which names no constant.
// oxlint-disable-next-line eslint/no-magic-numbers
type IpVersion = 4 | 6;

const ipv4Version = 4;
const ipv6Version = 6;

/** One address: its family, its bits, its parts and each part's width in bits, and its canonical text. */
interface IpAddress {
  readonly version: IpVersion;
  readonly bits: number;
  readonly parts: readonly number[];
  readonly width: number;
  readonly canonical: string;
}

const ipv4Bits = 32;
const ipv6Bits = 128;
const byteWidth = 8;
const groupWidth = 16;
const ipv4Parts = 4;
const ipv6Groups = 8;
const hexRadix = 16;
const none = 0;
const byteMask = 0xff;
const mappedMarker = 0xff_ff;
const lastPiece = -1;

/** The leading groups of an address in `::ffff:0:0/96`, every one zero but the last. */
const mappedPrefixGroups = 5;

/** The trailing groups that hold the last 32 bits of an IPv6 address. */
const embeddedGroups = -2;

/** The step from one group to the next. */
const nextGroup = 1;

/** The shortest run of zero groups that RFC 5952 compresses. */
const shortestRun = 2;

/** The sides of an IPv6 address with one `::`, before and after it. */
const sides = 2;

const decimalPart = /^(?:0|[1-9][0-9]{0,2})$/u;
const hexGroup = /^[0-9A-Fa-f]{1,4}$/u;
const largestPart = 255;

/** The four parts of an IPv4 address, each from 0 through 255 with no leading zero, or undefined. */
function ipv4Of(text: string): readonly number[] | undefined {
  const pieces = text.split('.');
  if (pieces.length !== ipv4Parts || !pieces.every((piece) => decimalPart.test(piece))) {
    return undefined;
  }
  const parts = pieces.map(Number);
  return parts.every((part) => part <= largestPart) ? parts : undefined;
}

/** The two groups an IPv4 address fills as the last 32 bits of an IPv6 address, or undefined. */
function embeddedOf(text: string): readonly number[] | undefined {
  const parts = ipv4Of(text);
  if (parts === undefined) {
    return undefined;
  }
  const [first = none, second = none, third = none, fourth = none] = parts;
  return [(first << byteWidth) | second, (third << byteWidth) | fourth];
}

/** The groups hexadecimal pieces spell, each of one to four digits, or undefined. */
function hexGroupsOf(pieces: readonly string[]): readonly number[] | undefined {
  return pieces.every((piece) => hexGroup.test(piece))
    ? pieces.map((piece) => Number.parseInt(piece, hexRadix))
    : undefined;
}

/**
 * The groups one side of `::` spells: hexadecimal groups joined by `:`, the last of which may be
 * an IPv4 address when the side ends the address. An empty side spells none.
 */
function groupsOf(side: string, endsAddress: boolean): readonly number[] | undefined {
  if (side === '') {
    return [];
  }
  const pieces = side.split(':');
  const tail = pieces.at(lastPiece) ?? '';
  if (!endsAddress || !tail.includes('.')) {
    return hexGroupsOf(pieces);
  }
  const head = hexGroupsOf(pieces.slice(none, lastPiece));
  const embedded = embeddedOf(tail);
  return head === undefined || embedded === undefined ? undefined : [...head, ...embedded];
}

/** The eight groups the sides of `::` spell, the run between them one zero group or more. */
function expanded(
  before: readonly number[] | undefined,
  after: readonly number[] | undefined,
): readonly number[] | undefined {
  if (before === undefined || after === undefined) {
    return undefined;
  }
  const missing = ipv6Groups - before.length - after.length;
  return missing > none
    ? [...before, ...Array.from({ length: missing }, () => none), ...after]
    : undefined;
}

/** The eight groups of an IPv6 address in a text form of RFC 4291, or undefined. */
function ipv6Of(text: string): readonly number[] | undefined {
  const halves = text.split('::');
  const [head = '', tail] = halves;
  if (halves.length > sides) {
    return undefined;
  }
  if (tail === undefined) {
    const groups = groupsOf(head, true);
    return groups?.length === ipv6Groups ? groups : undefined;
  }
  return expanded(groupsOf(head, false), groupsOf(tail, true));
}

/** The first longest run of two or more zero groups, as its start and length, or undefined. */
function longestZeroRun(groups: readonly number[]) {
  let best = { length: none, start: none };
  let start = none;
  for (const [index, group] of [...groups, Number.NaN].entries()) {
    if (group !== none) {
      const length = index - start;
      if (length > best.length) {
        best = { length, start };
      }
      start = index + nextGroup;
    }
  }
  return best.length >= shortestRun ? best : undefined;
}

/** Eight groups as hexadecimal, lowercase with no leading zeros, the first longest zero run as `::`. */
function hexText(groups: readonly number[]): string {
  const hex = groups.map((group) => group.toString(hexRadix));
  const run = longestZeroRun(groups);
  if (run === undefined) {
    return hex.join(':');
  }
  const before = hex.slice(none, run.start).join(':');
  const after = hex.slice(run.start + run.length).join(':');
  return `${before}::${after}`;
}

/** Whether eight groups are an IPv4-mapped address, in `::ffff:0:0/96`. */
function isMapped(groups: readonly number[]): boolean {
  return (
    groups.slice(none, mappedPrefixGroups).every((group) => group === none) &&
    groups[mappedPrefixGroups] === mappedMarker
  );
}

/** Eight groups in the form RFC 5952 recommends, an IPv4-mapped address with its last 32 bits dotted. */
function ipv6Text(groups: readonly number[]): string {
  if (!isMapped(groups)) {
    return hexText(groups);
  }
  const bytes = groups
    .slice(embeddedGroups)
    .flatMap((group) => [group >> byteWidth, group & byteMask]);
  return `::ffff:${bytes.join('.')}`;
}

/** An IPv4 or IPv6 address as `ip()` reads it, or undefined. */
function readIpAddress(text: string): IpAddress | undefined {
  const ipv4 = ipv4Of(text);
  if (ipv4 !== undefined) {
    return { bits: ipv4Bits, canonical: text, parts: ipv4, version: ipv4Version, width: byteWidth };
  }
  const ipv6 = ipv6Of(text);
  return ipv6 === undefined
    ? undefined
    : {
        bits: ipv6Bits,
        canonical: ipv6Text(ipv6),
        parts: ipv6,
        version: ipv6Version,
        width: groupWidth,
      };
}

/** Whether every bit of the address below the first `prefix` bits is zero. */
function hasNoHostBits({ parts, width }: IpAddress, prefix: number): boolean {
  return parts.every((part, index) => {
    const hostBits = width - Math.min(Math.max(prefix - index * width, none), width);
    return (part >>> hostBits) << hostBits === part;
  });
}

export { hasNoHostBits, ipv4Version, ipv6Version, readIpAddress };
export type { IpAddress, IpVersion };
