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

/**
 * The issue code for the `text-nonempty` rejection.
 *
 * @example
 * ```ts
 * import { textNonemptyIssue } from '@loomcli/validators';
 *
 * const issue = textNonemptyIssue.issue({});
 * const params = textNonemptyIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const textNonemptyIssue = issueCode(catalogCode('text-nonempty'), {
  message: () => 'Expected a nonempty value.',
  schema: noParams,
});

/**
 * The issue code for the `text-min-length` rejection.
 *
 * @example
 * ```ts
 * import { textMinLengthIssue } from '@loomcli/validators';
 *
 * const issue = textMinLengthIssue.issue({ min: 1 });
 * const params = textMinLengthIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const textMinLengthIssue = issueCode(catalogCode('text-min-length'), {
  message: ({ min }) => `Expected at least ${characters(min)}.`,
  schema: minParams(isCount),
});

/**
 * The issue code for the `text-max-length` rejection.
 *
 * @example
 * ```ts
 * import { textMaxLengthIssue } from '@loomcli/validators';
 *
 * const issue = textMaxLengthIssue.issue({ max: 64 });
 * const params = textMaxLengthIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const textMaxLengthIssue = issueCode(catalogCode('text-max-length'), {
  message: ({ max }) => `Expected at most ${characters(max)}.`,
  schema: maxParams(isCount),
});

/**
 * The issue code for the `text-exact-length` rejection.
 *
 * @example
 * ```ts
 * import { textExactLengthIssue } from '@loomcli/validators';
 *
 * const issue = textExactLengthIssue.issue({ length: 8 });
 * const params = textExactLengthIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const textExactLengthIssue = issueCode(catalogCode('text-exact-length'), {
  message: ({ length }) => `Expected exactly ${characters(length)}.`,
  schema: lengthParams,
});

/**
 * The issue code for the `text-length-range` rejection.
 *
 * @example
 * ```ts
 * import { textLengthRangeIssue } from '@loomcli/validators';
 *
 * const issue = textLengthRangeIssue.issue({ max: 64, min: 1 });
 * const params = textLengthRangeIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const textLengthRangeIssue = issueCode(catalogCode('text-length-range'), {
  message: ({ max, min }) => `Expected from ${String(min)} through ${characters(max)}.`,
  schema: rangeParams(isCount),
});

/**
 * The author's own sentence for a `text()` pattern, which is the code's one blank.
 *
 * @example
 * ```ts
 * import { textPatternIssue } from '@loomcli/validators';
 *
 * const issue = textPatternIssue.issue({ message: 'Expected lowercase letters, digits, and hyphens.' });
 * const params = textPatternIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const textPatternIssue = issueCode(catalogCode('text-pattern'), {
  message: ({ message }) => message,
  schema: messageParams,
});

/**
 * The issue code for the `integer` rejection.
 *
 * @example
 * ```ts
 * import { integerIssue } from '@loomcli/validators';
 *
 * const issue = integerIssue.issue({});
 * const params = integerIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const integerIssue = issueCode(catalogCode('integer'), {
  message: () => 'Expected a whole number.',
  schema: noParams,
});

/**
 * The issue code for the `integer-range` rejection.
 *
 * @example
 * ```ts
 * import { integerRangeIssue } from '@loomcli/validators';
 *
 * const issue = integerRangeIssue.issue({ max: 64, min: 1 });
 * const params = integerRangeIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const integerRangeIssue = issueCode(catalogCode('integer-range'), {
  message: ({ max, min }) => `Expected a whole number from ${String(min)} through ${String(max)}.`,
  schema: rangeParams(isFiniteNumber),
});

/**
 * The issue code for the `integer-min` rejection.
 *
 * @example
 * ```ts
 * import { integerMinIssue } from '@loomcli/validators';
 *
 * const issue = integerMinIssue.issue({ min: 1 });
 * const params = integerMinIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const integerMinIssue = issueCode(catalogCode('integer-min'), {
  message: ({ min }) => `Expected a whole number of at least ${String(min)}.`,
  schema: minParams(isFiniteNumber),
});

/**
 * The issue code for the `integer-max` rejection.
 *
 * @example
 * ```ts
 * import { integerMaxIssue } from '@loomcli/validators';
 *
 * const issue = integerMaxIssue.issue({ max: 64 });
 * const params = integerMaxIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const integerMaxIssue = issueCode(catalogCode('integer-max'), {
  message: ({ max }) => `Expected a whole number of at most ${String(max)}.`,
  schema: maxParams(isFiniteNumber),
});

/**
 * The issue code for the `number` rejection.
 *
 * @example
 * ```ts
 * import { numberIssue } from '@loomcli/validators';
 *
 * const issue = numberIssue.issue({});
 * const params = numberIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const numberIssue = issueCode(catalogCode('number'), {
  message: () => 'Expected a number.',
  schema: noParams,
});

/**
 * The issue code for the `number-range` rejection.
 *
 * @example
 * ```ts
 * import { numberRangeIssue } from '@loomcli/validators';
 *
 * const issue = numberRangeIssue.issue({ max: 64, min: 1 });
 * const params = numberRangeIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const numberRangeIssue = issueCode(catalogCode('number-range'), {
  message: ({ max, min }) => `Expected a number from ${String(min)} through ${String(max)}.`,
  schema: rangeParams(isFiniteNumber),
});

/**
 * The issue code for the `number-min` rejection.
 *
 * @example
 * ```ts
 * import { numberMinIssue } from '@loomcli/validators';
 *
 * const issue = numberMinIssue.issue({ min: 1 });
 * const params = numberMinIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const numberMinIssue = issueCode(catalogCode('number-min'), {
  message: ({ min }) => `Expected a number of at least ${String(min)}.`,
  schema: minParams(isFiniteNumber),
});

/**
 * The issue code for the `number-max` rejection.
 *
 * @example
 * ```ts
 * import { numberMaxIssue } from '@loomcli/validators';
 *
 * const issue = numberMaxIssue.issue({ max: 64 });
 * const params = numberMaxIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const numberMaxIssue = issueCode(catalogCode('number-max'), {
  message: ({ max }) => `Expected a number of at most ${String(max)}.`,
  schema: maxParams(isFiniteNumber),
});

/**
 * The issue code for the `port` rejection.
 *
 * @example
 * ```ts
 * import { portIssue } from '@loomcli/validators';
 *
 * const issue = portIssue.issue({});
 * const params = portIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const portIssue = issueCode(catalogCode('port'), {
  message: () => 'Expected a port number from 1 through 65535.',
  schema: noParams,
});

/**
 * The issue code for the `one-of` rejection.
 *
 * @example
 * ```ts
 * import { oneOfIssue } from '@loomcli/validators';
 *
 * const issue = oneOfIssue.issue({ values: ['dev', 'prod'] });
 * const params = oneOfIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const oneOfIssue = issueCode(catalogCode('one-of'), {
  message: ({ values }) => `Expected one of: ${values.join(', ')}.`,
  schema: valuesParams,
});

/**
 * The issue code for the `url` rejection.
 *
 * @example
 * ```ts
 * import { urlIssue } from '@loomcli/validators';
 *
 * const issue = urlIssue.issue({});
 * const params = urlIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const urlIssue = issueCode(catalogCode('url'), {
  message: () => 'Expected an absolute URL, such as https://example.com.',
  schema: noParams,
});

/**
 * The issue code for the `url-scheme` rejection.
 *
 * @example
 * ```ts
 * import { urlSchemeIssue } from '@loomcli/validators';
 *
 * const issue = urlSchemeIssue.issue({ protocols: ['https'] });
 * const params = urlSchemeIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const urlSchemeIssue = issueCode(catalogCode('url-scheme'), {
  message: ({ protocols }) => `Expected an absolute URL with the scheme ${listing(protocols)}.`,
  schema: protocolsParams,
});

/**
 * The issue code for the `uuid` rejection.
 *
 * @example
 * ```ts
 * import { uuidIssue } from '@loomcli/validators';
 *
 * const issue = uuidIssue.issue({});
 * const params = uuidIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const uuidIssue = issueCode(catalogCode('uuid'), {
  message: () => 'Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.',
  schema: noParams,
});

/**
 * The issue code for the `date` rejection.
 *
 * @example
 * ```ts
 * import { dateIssue } from '@loomcli/validators';
 *
 * const issue = dateIssue.issue({});
 * const params = dateIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const dateIssue = issueCode(catalogCode('date'), {
  message: () => 'Expected a date as YYYY-MM-DD, such as 2026-09-25.',
  schema: noParams,
});

/**
 * The issue code for the `date-time` rejection.
 *
 * @example
 * ```ts
 * import { dateTimeIssue } from '@loomcli/validators';
 *
 * const issue = dateTimeIssue.issue({});
 * const params = dateTimeIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const dateTimeIssue = issueCode(catalogCode('date-time'), {
  message: () => 'Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.',
  schema: noParams,
});

/**
 * The issue code for the `date-layouts` rejection.
 *
 * @example
 * ```ts
 * import { dateLayoutsIssue } from '@loomcli/validators';
 *
 * const issue = dateLayoutsIssue.issue({ forms: ['YYYY-MM-DD'] });
 * const params = dateLayoutsIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const dateLayoutsIssue = issueCode(catalogCode('date-layouts'), {
  message: ({ forms }) => `Expected a date as ${listing(forms)}, such as 2026-09-25.`,
  schema: formsParams,
});

/**
 * The issue code for the `date-time-layouts` rejection.
 *
 * @example
 * ```ts
 * import { dateTimeLayoutsIssue } from '@loomcli/validators';
 *
 * const issue = dateTimeLayoutsIssue.issue({ forms: ['YYYY-MM-DD'] });
 * const params = dateTimeLayoutsIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const dateTimeLayoutsIssue = issueCode(catalogCode('date-time-layouts'), {
  message: ({ forms }) =>
    `Expected a date and time as ${listing(forms)}, such as 2026-09-25T14:30:00Z.`,
  schema: formsParams,
});

/**
 * The issue code for the `time` rejection.
 *
 * @example
 * ```ts
 * import { timeIssue } from '@loomcli/validators';
 *
 * const issue = timeIssue.issue({});
 * const params = timeIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const timeIssue = issueCode(catalogCode('time'), {
  message: () => 'Expected a time of day, such as 09:30 or 17:45:30.',
  schema: noParams,
});

/**
 * The issue code for the `time-layouts` rejection.
 *
 * @example
 * ```ts
 * import { timeLayoutsIssue } from '@loomcli/validators';
 *
 * const issue = timeLayoutsIssue.issue({ forms: ['YYYY-MM-DD'] });
 * const params = timeLayoutsIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const timeLayoutsIssue = issueCode(catalogCode('time-layouts'), {
  message: ({ forms }) => `Expected a time of day as ${listing(forms)}, such as 09:30.`,
  schema: formsParams,
});

/**
 * The issue code for the `time-range` rejection.
 *
 * @example
 * ```ts
 * import { timeRangeIssue } from '@loomcli/validators';
 *
 * const issue = timeRangeIssue.issue({ max: 61_200_000, min: 32_400_000 });
 * const params = timeRangeIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const timeRangeIssue = issueCode(catalogCode('time-range'), {
  message: ({ max, min }) =>
    `Expected a time from ${formatTimeOfDay(min)} through ${formatTimeOfDay(max)}.`,
  schema: rangeParams(isTimeOfDay),
});

/**
 * The issue code for the `time-min` rejection.
 *
 * @example
 * ```ts
 * import { timeMinIssue } from '@loomcli/validators';
 *
 * const issue = timeMinIssue.issue({ min: 32_400_000 });
 * const params = timeMinIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const timeMinIssue = issueCode(catalogCode('time-min'), {
  message: ({ min }) => `Expected a time of at least ${formatTimeOfDay(min)}.`,
  schema: minParams(isTimeOfDay),
});

/**
 * The issue code for the `time-max` rejection.
 *
 * @example
 * ```ts
 * import { timeMaxIssue } from '@loomcli/validators';
 *
 * const issue = timeMaxIssue.issue({ max: 61_200_000 });
 * const params = timeMaxIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const timeMaxIssue = issueCode(catalogCode('time-max'), {
  message: ({ max }) => `Expected a time of at most ${formatTimeOfDay(max)}.`,
  schema: maxParams(isTimeOfDay),
});

/**
 * The issue code for the `duration` rejection.
 *
 * @example
 * ```ts
 * import { durationIssue } from '@loomcli/validators';
 *
 * const issue = durationIssue.issue({});
 * const params = durationIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const durationIssue = issueCode(catalogCode('duration'), {
  message: () => 'Expected a duration, such as 90s, 2h30m, or 1.5h.',
  schema: noParams,
});

/**
 * The issue code for the `duration-capital-m` rejection.
 *
 * @example
 * ```ts
 * import { durationCapitalMIssue } from '@loomcli/validators';
 *
 * const issue = durationCapitalMIssue.issue({});
 * const params = durationCapitalMIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const durationCapitalMIssue = issueCode(catalogCode('duration-capital-m'), {
  message: () => 'Expected a duration; write minutes as m or min, because M is ambiguous.',
  schema: noParams,
});

/**
 * The issue code for the `duration-range` rejection.
 *
 * @example
 * ```ts
 * import { durationRangeIssue } from '@loomcli/validators';
 *
 * const issue = durationRangeIssue.issue({ max: 64, min: 1 });
 * const params = durationRangeIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const durationRangeIssue = issueCode(catalogCode('duration-range'), {
  message: ({ max, min }) =>
    `Expected a duration from ${formatDuration(min)} through ${formatDuration(max)}.`,
  schema: rangeParams(isFiniteNumber),
});

/**
 * The issue code for the `duration-min` rejection.
 *
 * @example
 * ```ts
 * import { durationMinIssue } from '@loomcli/validators';
 *
 * const issue = durationMinIssue.issue({ min: 1 });
 * const params = durationMinIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const durationMinIssue = issueCode(catalogCode('duration-min'), {
  message: ({ min }) => `Expected a duration of at least ${formatDuration(min)}.`,
  schema: minParams(isFiniteNumber),
});

/**
 * The issue code for the `duration-max` rejection.
 *
 * @example
 * ```ts
 * import { durationMaxIssue } from '@loomcli/validators';
 *
 * const issue = durationMaxIssue.issue({ max: 64 });
 * const params = durationMaxIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const durationMaxIssue = issueCode(catalogCode('duration-max'), {
  message: ({ max }) => `Expected a duration of at most ${formatDuration(max)}.`,
  schema: maxParams(isFiniteNumber),
});

/**
 * The issue code for the `path` rejection.
 *
 * @example
 * ```ts
 * import { pathIssue } from '@loomcli/validators';
 *
 * const issue = pathIssue.issue({});
 * const params = pathIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
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

/**
 * The issue code for the `path-readable` rejection.
 *
 * @example
 * ```ts
 * import { pathReadableIssue } from '@loomcli/validators';
 *
 * const issue = pathReadableIssue.issue({ kind: 'file' });
 * const params = pathReadableIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const pathReadableIssue = issueCode(catalogCode('path-readable'), {
  message: ({ kind }) => `Expected a readable ${readableKinds[kind]} that exists.`,
  schema: kindParams,
});

/**
 * The issue code for the `path-writable` rejection.
 *
 * @example
 * ```ts
 * import { pathWritableIssue } from '@loomcli/validators';
 *
 * const issue = pathWritableIssue.issue({ kind: 'file' });
 * const params = pathWritableIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const pathWritableIssue = issueCode(catalogCode('path-writable'), {
  message: ({ kind }) =>
    `Expected a writable ${writableKinds[kind]}, or a new ${writableKinds[kind]} in a writable directory.`,
  schema: kindParams,
});

/**
 * The issue code for the `bytes` rejection.
 *
 * @example
 * ```ts
 * import { bytesIssue } from '@loomcli/validators';
 *
 * const issue = bytesIssue.issue({});
 * const params = bytesIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const bytesIssue = issueCode(catalogCode('bytes'), {
  message: () => 'Expected a size, such as 512KiB, 10MB, or 1.5GB.',
  schema: noParams,
});

/**
 * The issue code for the `bytes-range` rejection.
 *
 * @example
 * ```ts
 * import { bytesRangeIssue } from '@loomcli/validators';
 *
 * const issue = bytesRangeIssue.issue({ max: 64, min: 1 });
 * const params = bytesRangeIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const bytesRangeIssue = issueCode(catalogCode('bytes-range'), {
  message: ({ max, min }) =>
    `Expected a size from ${formatBytes(min)} through ${formatBytes(max)}.`,
  schema: rangeParams(isCount),
});

/**
 * The issue code for the `bytes-min` rejection.
 *
 * @example
 * ```ts
 * import { bytesMinIssue } from '@loomcli/validators';
 *
 * const issue = bytesMinIssue.issue({ min: 1 });
 * const params = bytesMinIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const bytesMinIssue = issueCode(catalogCode('bytes-min'), {
  message: ({ min }) => `Expected a size of at least ${formatBytes(min)}.`,
  schema: minParams(isCount),
});

/**
 * The issue code for the `bytes-max` rejection.
 *
 * @example
 * ```ts
 * import { bytesMaxIssue } from '@loomcli/validators';
 *
 * const issue = bytesMaxIssue.issue({ max: 64 });
 * const params = bytesMaxIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const bytesMaxIssue = issueCode(catalogCode('bytes-max'), {
  message: ({ max }) => `Expected a size of at most ${formatBytes(max)}.`,
  schema: maxParams(isCount),
});

/**
 * The issue code for the `host` rejection.
 *
 * @example
 * ```ts
 * import { hostIssue } from '@loomcli/validators';
 *
 * const issue = hostIssue.issue({});
 * const params = hostIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const hostIssue = issueCode(catalogCode('host'), {
  message: () => 'Expected a host name, such as example.com.',
  schema: noParams,
});

/**
 * The issue code for the `host-or-ip` rejection.
 *
 * @example
 * ```ts
 * import { hostOrIpIssue } from '@loomcli/validators';
 *
 * const issue = hostOrIpIssue.issue({});
 * const params = hostOrIpIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const hostOrIpIssue = issueCode(catalogCode('host-or-ip'), {
  message: () =>
    'Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1].',
  schema: noParams,
});

/**
 * The issue code for the `ip` rejection.
 *
 * @example
 * ```ts
 * import { ipIssue } from '@loomcli/validators';
 *
 * const issue = ipIssue.issue({});
 * const params = ipIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const ipIssue = issueCode(catalogCode('ip'), {
  message: () => 'Expected an IP address, such as 192.0.2.1 or 2001:db8::1.',
  schema: noParams,
});

/**
 * The issue code for the `ip-v4` rejection.
 *
 * @example
 * ```ts
 * import { ipV4Issue } from '@loomcli/validators';
 *
 * const issue = ipV4Issue.issue({});
 * const params = ipV4Issue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const ipV4Issue = issueCode(catalogCode('ip-v4'), {
  message: () => 'Expected an IPv4 address, such as 192.0.2.1.',
  schema: noParams,
});

/**
 * The issue code for the `ip-v6` rejection.
 *
 * @example
 * ```ts
 * import { ipV6Issue } from '@loomcli/validators';
 *
 * const issue = ipV6Issue.issue({});
 * const params = ipV6Issue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const ipV6Issue = issueCode(catalogCode('ip-v6'), {
  message: () => 'Expected an IPv6 address, such as 2001:db8::1.',
  schema: noParams,
});

/**
 * The issue code for the `cidr` rejection.
 *
 * @example
 * ```ts
 * import { cidrIssue } from '@loomcli/validators';
 *
 * const issue = cidrIssue.issue({});
 * const params = cidrIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const cidrIssue = issueCode(catalogCode('cidr'), {
  message: () => 'Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.',
  schema: noParams,
});

/**
 * The issue code for the `cidr-v4` rejection.
 *
 * @example
 * ```ts
 * import { cidrV4Issue } from '@loomcli/validators';
 *
 * const issue = cidrV4Issue.issue({});
 * const params = cidrV4Issue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const cidrV4Issue = issueCode(catalogCode('cidr-v4'), {
  message: () => 'Expected an IPv4 CIDR block, such as 192.0.2.0/24.',
  schema: noParams,
});

/**
 * The issue code for the `cidr-v6` rejection.
 *
 * @example
 * ```ts
 * import { cidrV6Issue } from '@loomcli/validators';
 *
 * const issue = cidrV6Issue.issue({});
 * const params = cidrV6Issue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const cidrV6Issue = issueCode(catalogCode('cidr-v6'), {
  message: () => 'Expected an IPv6 CIDR block, such as 2001:db8::/32.',
  schema: noParams,
});

/**
 * The issue code for the `cidr-host-bits` rejection.
 *
 * @example
 * ```ts
 * import { cidrHostBitsIssue } from '@loomcli/validators';
 *
 * const issue = cidrHostBitsIssue.issue({});
 * const params = cidrHostBitsIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const cidrHostBitsIssue = issueCode(catalogCode('cidr-host-bits'), {
  message: () => 'Expected a network address with no bits set below the prefix.',
  schema: noParams,
});

/**
 * The issue code for the `key-value` rejection.
 *
 * @example
 * ```ts
 * import { keyValueIssue } from '@loomcli/validators';
 *
 * const issue = keyValueIssue.issue({ separator: ':' });
 * const params = keyValueIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const keyValueIssue = issueCode(catalogCode('key-value'), {
  message: ({ separator }) => `Expected a key and a value as key${separator}value.`,
  schema: separatorParams,
});

/**
 * The issue code for the `email` rejection.
 *
 * @example
 * ```ts
 * import { emailIssue } from '@loomcli/validators';
 *
 * const issue = emailIssue.issue({});
 * const params = emailIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
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
