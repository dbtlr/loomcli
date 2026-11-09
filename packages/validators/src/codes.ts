import { formatBytes } from './bytes-grammar.js';
import { formatDuration } from './duration-grammar.js';
import { issueCode } from './issue-code.js';
import type { IssueCode } from './issue-code.js';
import { listing } from './issues.js';
import {
  formsParams,
  isCount,
  isFiniteNumber,
  isTimeOfDay,
  kindParams,
  lengthParams,
  maxParams,
  messageParams,
  minParams,
  noParams,
  protocolsParams,
  rangeParams,
  separatorParams,
  valuesParams,
} from './params.js';
import type { NoParams } from './params.js';
import type { PathKind } from './probe.js';
import { formatTimeOfDay } from './time-grammar.js';

/**
 * The catalog's issue codes, one for each sentence a catalog validator prints. Each code's
 * parameters are that sentence's blanks and hold the rule's settings, never the rejected value.
 */

const oneCharacter = 1;

/** A count of characters, reading `character` for a count of 1. */
function characters(count: number): string {
  return count === oneCharacter ? '1 character' : `${String(count)} characters`;
}

/** The catalog's own code for a rule: the package name, `/`, and the rule name. */
function catalogCode(rule: string): string {
  return `@loomcli/validators/${rule}`;
}

const textNonemptyIssue = issueCode(catalogCode('text-nonempty'), {
  message: () => 'Expected a nonempty value.',
  schema: noParams,
});

const textMinLengthIssue = issueCode(catalogCode('text-min-length'), {
  message: ({ min }) => `Expected at least ${characters(min)}.`,
  schema: minParams(isCount),
});

const textMaxLengthIssue = issueCode(catalogCode('text-max-length'), {
  message: ({ max }) => `Expected at most ${characters(max)}.`,
  schema: maxParams(isCount),
});

const textExactLengthIssue = issueCode(catalogCode('text-exact-length'), {
  message: ({ length }) => `Expected exactly ${characters(length)}.`,
  schema: lengthParams,
});

const textLengthRangeIssue = issueCode(catalogCode('text-length-range'), {
  message: ({ max, min }) => `Expected from ${String(min)} through ${characters(max)}.`,
  schema: rangeParams(isCount),
});

/** The author's own sentence for a `text()` pattern, which is the code's one blank. */
const textPatternIssue = issueCode(catalogCode('text-pattern'), {
  message: ({ message }) => message,
  schema: messageParams,
});

const integerIssue = issueCode(catalogCode('integer'), {
  message: () => 'Expected a whole number.',
  schema: noParams,
});

const integerRangeIssue = issueCode(catalogCode('integer-range'), {
  message: ({ max, min }) => `Expected a whole number from ${String(min)} through ${String(max)}.`,
  schema: rangeParams(isFiniteNumber),
});

const integerMinIssue = issueCode(catalogCode('integer-min'), {
  message: ({ min }) => `Expected a whole number of at least ${String(min)}.`,
  schema: minParams(isFiniteNumber),
});

const integerMaxIssue = issueCode(catalogCode('integer-max'), {
  message: ({ max }) => `Expected a whole number of at most ${String(max)}.`,
  schema: maxParams(isFiniteNumber),
});

const numberIssue = issueCode(catalogCode('number'), {
  message: () => 'Expected a number.',
  schema: noParams,
});

const numberRangeIssue = issueCode(catalogCode('number-range'), {
  message: ({ max, min }) => `Expected a number from ${String(min)} through ${String(max)}.`,
  schema: rangeParams(isFiniteNumber),
});

const numberMinIssue = issueCode(catalogCode('number-min'), {
  message: ({ min }) => `Expected a number of at least ${String(min)}.`,
  schema: minParams(isFiniteNumber),
});

const numberMaxIssue = issueCode(catalogCode('number-max'), {
  message: ({ max }) => `Expected a number of at most ${String(max)}.`,
  schema: maxParams(isFiniteNumber),
});

const portIssue = issueCode(catalogCode('port'), {
  message: () => 'Expected a port number from 1 through 65535.',
  schema: noParams,
});

const oneOfIssue = issueCode(catalogCode('one-of'), {
  message: ({ values }) => `Expected one of: ${values.join(', ')}.`,
  schema: valuesParams,
});

const urlIssue = issueCode(catalogCode('url'), {
  message: () => 'Expected an absolute URL, such as https://example.com.',
  schema: noParams,
});

const urlSchemeIssue = issueCode(catalogCode('url-scheme'), {
  message: ({ protocols }) => `Expected an absolute URL with the scheme ${listing(protocols)}.`,
  schema: protocolsParams,
});

const uuidIssue = issueCode(catalogCode('uuid'), {
  message: () => 'Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.',
  schema: noParams,
});

const dateIssue = issueCode(catalogCode('date'), {
  message: () => 'Expected a date as YYYY-MM-DD, such as 2026-09-25.',
  schema: noParams,
});

const dateTimeIssue = issueCode(catalogCode('date-time'), {
  message: () => 'Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.',
  schema: noParams,
});

const dateLayoutsIssue = issueCode(catalogCode('date-layouts'), {
  message: ({ forms }) => `Expected a date as ${listing(forms)}, such as 2026-09-25.`,
  schema: formsParams,
});

const dateTimeLayoutsIssue = issueCode(catalogCode('date-time-layouts'), {
  message: ({ forms }) =>
    `Expected a date and time as ${listing(forms)}, such as 2026-09-25T14:30:00Z.`,
  schema: formsParams,
});

const timeIssue = issueCode(catalogCode('time'), {
  message: () => 'Expected a time of day, such as 09:30 or 17:45:30.',
  schema: noParams,
});

const timeLayoutsIssue = issueCode(catalogCode('time-layouts'), {
  message: ({ forms }) => `Expected a time of day as ${listing(forms)}, such as 09:30.`,
  schema: formsParams,
});

const timeRangeIssue = issueCode(catalogCode('time-range'), {
  message: ({ max, min }) =>
    `Expected a time from ${formatTimeOfDay(min)} through ${formatTimeOfDay(max)}.`,
  schema: rangeParams(isTimeOfDay),
});

const timeMinIssue = issueCode(catalogCode('time-min'), {
  message: ({ min }) => `Expected a time of at least ${formatTimeOfDay(min)}.`,
  schema: minParams(isTimeOfDay),
});

const timeMaxIssue = issueCode(catalogCode('time-max'), {
  message: ({ max }) => `Expected a time of at most ${formatTimeOfDay(max)}.`,
  schema: maxParams(isTimeOfDay),
});

const durationIssue = issueCode(catalogCode('duration'), {
  message: () => 'Expected a duration, such as 90s, 2h30m, or 1.5h.',
  schema: noParams,
});

const durationCapitalMIssue = issueCode(catalogCode('duration-capital-m'), {
  message: () => 'Expected a duration; write minutes as m or min, because M is ambiguous.',
  schema: noParams,
});

const durationRangeIssue = issueCode(catalogCode('duration-range'), {
  message: ({ max, min }) =>
    `Expected a duration from ${formatDuration(min)} through ${formatDuration(max)}.`,
  schema: rangeParams(isFiniteNumber),
});

const durationMinIssue = issueCode(catalogCode('duration-min'), {
  message: ({ min }) => `Expected a duration of at least ${formatDuration(min)}.`,
  schema: minParams(isFiniteNumber),
});

const durationMaxIssue = issueCode(catalogCode('duration-max'), {
  message: ({ max }) => `Expected a duration of at most ${formatDuration(max)}.`,
  schema: maxParams(isFiniteNumber),
});

const pathIssue = issueCode(catalogCode('path'), {
  message: () => 'Expected a nonempty path with no NUL character.',
  schema: noParams,
});

/** How each kind reads in a readable-path sentence. */
const readableKinds: Readonly<Record<PathKind, string>> = {
  any: 'file or directory',
  directory: 'directory',
  file: 'file',
};

/** How each kind reads in a writable-path sentence. */
const writableKinds: Readonly<Record<PathKind, string>> = {
  any: 'path',
  directory: 'directory',
  file: 'file',
};

const pathReadableIssue = issueCode(catalogCode('path-readable'), {
  message: ({ kind }) => `Expected a readable ${readableKinds[kind]} that exists.`,
  schema: kindParams,
});

const pathWritableIssue = issueCode(catalogCode('path-writable'), {
  message: ({ kind }) =>
    `Expected a writable ${writableKinds[kind]}, or a new ${writableKinds[kind]} in a writable directory.`,
  schema: kindParams,
});

const bytesIssue = issueCode(catalogCode('bytes'), {
  message: () => 'Expected a size, such as 512KiB, 10MB, or 1.5GB.',
  schema: noParams,
});

const bytesRangeIssue = issueCode(catalogCode('bytes-range'), {
  message: ({ max, min }) =>
    `Expected a size from ${formatBytes(min)} through ${formatBytes(max)}.`,
  schema: rangeParams(isCount),
});

const bytesMinIssue = issueCode(catalogCode('bytes-min'), {
  message: ({ min }) => `Expected a size of at least ${formatBytes(min)}.`,
  schema: minParams(isCount),
});

const bytesMaxIssue = issueCode(catalogCode('bytes-max'), {
  message: ({ max }) => `Expected a size of at most ${formatBytes(max)}.`,
  schema: maxParams(isCount),
});

const hostIssue = issueCode(catalogCode('host'), {
  message: () => 'Expected a host name, such as example.com.',
  schema: noParams,
});

const hostOrIpIssue = issueCode(catalogCode('host-or-ip'), {
  message: () =>
    'Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1].',
  schema: noParams,
});

const ipIssue = issueCode(catalogCode('ip'), {
  message: () => 'Expected an IP address, such as 192.0.2.1 or 2001:db8::1.',
  schema: noParams,
});

const ipV4Issue = issueCode(catalogCode('ip-v4'), {
  message: () => 'Expected an IPv4 address, such as 192.0.2.1.',
  schema: noParams,
});

const ipV6Issue = issueCode(catalogCode('ip-v6'), {
  message: () => 'Expected an IPv6 address, such as 2001:db8::1.',
  schema: noParams,
});

const cidrIssue = issueCode(catalogCode('cidr'), {
  message: () => 'Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.',
  schema: noParams,
});

const cidrV4Issue = issueCode(catalogCode('cidr-v4'), {
  message: () => 'Expected an IPv4 CIDR block, such as 192.0.2.0/24.',
  schema: noParams,
});

const cidrV6Issue = issueCode(catalogCode('cidr-v6'), {
  message: () => 'Expected an IPv6 CIDR block, such as 2001:db8::/32.',
  schema: noParams,
});

const cidrHostBitsIssue = issueCode(catalogCode('cidr-host-bits'), {
  message: () => 'Expected a network address with no bits set below the prefix.',
  schema: noParams,
});

const keyValueIssue = issueCode(catalogCode('key-value'), {
  message: ({ separator }) => `Expected a key and a value as key${separator}value.`,
  schema: separatorParams,
});

const emailIssue = issueCode(catalogCode('email'), {
  message: () => 'Expected an email address, such as name@example.com.',
  schema: noParams,
});

/** The four codes a numeric factory rejects with, one for each way its bounds are declared. */
interface BoundCodes {
  unbounded: IssueCode<NoParams>;
  range: IssueCode<{ max: number; min: number }>;
  min: IssueCode<{ min: number }>;
  max: IssueCode<{ max: number }>;
}

const integerCodes: BoundCodes = {
  max: integerMaxIssue,
  min: integerMinIssue,
  range: integerRangeIssue,
  unbounded: integerIssue,
};

const numberCodes: BoundCodes = {
  max: numberMaxIssue,
  min: numberMinIssue,
  range: numberRangeIssue,
  unbounded: numberIssue,
};

const durationCodes: BoundCodes = {
  max: durationMaxIssue,
  min: durationMinIssue,
  range: durationRangeIssue,
  unbounded: durationIssue,
};

const bytesCodes: BoundCodes = {
  max: bytesMaxIssue,
  min: bytesMinIssue,
  range: bytesRangeIssue,
  unbounded: bytesIssue,
};

const timeCodes: BoundCodes = {
  max: timeMaxIssue,
  min: timeMinIssue,
  range: timeRangeIssue,
  unbounded: timeIssue,
};

export {
  bytesCodes,
  bytesIssue,
  bytesMaxIssue,
  bytesMinIssue,
  bytesRangeIssue,
  cidrHostBitsIssue,
  cidrIssue,
  cidrV4Issue,
  cidrV6Issue,
  dateIssue,
  dateLayoutsIssue,
  dateTimeIssue,
  dateTimeLayoutsIssue,
  durationCapitalMIssue,
  durationCodes,
  durationIssue,
  durationMaxIssue,
  durationMinIssue,
  durationRangeIssue,
  emailIssue,
  hostIssue,
  hostOrIpIssue,
  integerCodes,
  integerIssue,
  integerMaxIssue,
  integerMinIssue,
  integerRangeIssue,
  ipIssue,
  ipV4Issue,
  ipV6Issue,
  keyValueIssue,
  numberCodes,
  numberIssue,
  numberMaxIssue,
  numberMinIssue,
  numberRangeIssue,
  oneOfIssue,
  pathIssue,
  pathReadableIssue,
  pathWritableIssue,
  portIssue,
  textExactLengthIssue,
  textLengthRangeIssue,
  textMaxLengthIssue,
  textMinLengthIssue,
  textNonemptyIssue,
  textPatternIssue,
  timeCodes,
  timeIssue,
  timeLayoutsIssue,
  timeMaxIssue,
  timeMinIssue,
  timeRangeIssue,
  urlIssue,
  urlSchemeIssue,
  uuidIssue,
};
export type { BoundCodes };
