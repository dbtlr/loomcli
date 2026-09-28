import { issueCode } from './issue-code.js';
import type { IssueCode } from './issue-code.js';
import { listing } from './issues.js';
import {
  isCount,
  isFiniteNumber,
  isSafeInteger,
  kindParams,
  lengthParams,
  maxParams,
  messageParams,
  minParams,
  noParams,
  protocolsParams,
  rangeParams,
  valuesParams,
} from './params.js';
import type { NoParams } from './params.js';
import type { PathKind } from './probe.js';

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
  schema: rangeParams(isSafeInteger),
});

const integerMinIssue = issueCode(catalogCode('integer-min'), {
  message: ({ min }) => `Expected a whole number of at least ${String(min)}.`,
  schema: minParams(isSafeInteger),
});

const integerMaxIssue = issueCode(catalogCode('integer-max'), {
  message: ({ max }) => `Expected a whole number of at most ${String(max)}.`,
  schema: maxParams(isSafeInteger),
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

export {
  dateIssue,
  integerCodes,
  integerIssue,
  integerMaxIssue,
  integerMinIssue,
  integerRangeIssue,
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
  urlIssue,
  urlSchemeIssue,
  uuidIssue,
};
export type { BoundCodes };
