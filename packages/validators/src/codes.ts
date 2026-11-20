import { catalogIssueCode, issueCode } from './issue-code.js';
import type { IssueCode } from './issue-code.js';
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
import { validatorPhrase } from './phrases.js';

/**
 * The catalog's issue codes, one for each sentence a catalog validator prints. Each code's
 * parameters are that sentence's blanks and hold the rule's settings, never the rejected value.
 * Each code's sentence is a function of the internal `messages.ts`, and `text-pattern`'s is the
 * author's own, which it passes through unchanged.
 */

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
const textNonemptyIssue = catalogIssueCode(catalogCode('text-nonempty'), {
  phrase: () => validatorPhrase('expectedNonempty'),
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
const textMinLengthIssue = catalogIssueCode(catalogCode('text-min-length'), {
  phrase: ({ min }) => validatorPhrase('expectedMinLength', min),
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
const textMaxLengthIssue = catalogIssueCode(catalogCode('text-max-length'), {
  phrase: ({ max }) => validatorPhrase('expectedMaxLength', max),
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
const textExactLengthIssue = catalogIssueCode(catalogCode('text-exact-length'), {
  phrase: ({ length }) => validatorPhrase('expectedExactLength', length),
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
const textLengthRangeIssue = catalogIssueCode(catalogCode('text-length-range'), {
  phrase: ({ max, min }) => validatorPhrase('expectedLengthRange', min, max),
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
const integerIssue = catalogIssueCode(catalogCode('integer'), {
  phrase: () => validatorPhrase('expectedInteger'),
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
const integerRangeIssue = catalogIssueCode(catalogCode('integer-range'), {
  phrase: ({ max, min }) => validatorPhrase('expectedIntegerRange', min, max),
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
const integerMinIssue = catalogIssueCode(catalogCode('integer-min'), {
  phrase: ({ min }) => validatorPhrase('expectedIntegerMin', min),
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
const integerMaxIssue = catalogIssueCode(catalogCode('integer-max'), {
  phrase: ({ max }) => validatorPhrase('expectedIntegerMax', max),
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
const numberIssue = catalogIssueCode(catalogCode('number'), {
  phrase: () => validatorPhrase('expectedNumber'),
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
const numberRangeIssue = catalogIssueCode(catalogCode('number-range'), {
  phrase: ({ max, min }) => validatorPhrase('expectedNumberRange', min, max),
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
const numberMinIssue = catalogIssueCode(catalogCode('number-min'), {
  phrase: ({ min }) => validatorPhrase('expectedNumberMin', min),
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
const numberMaxIssue = catalogIssueCode(catalogCode('number-max'), {
  phrase: ({ max }) => validatorPhrase('expectedNumberMax', max),
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
const portIssue = catalogIssueCode(catalogCode('port'), {
  phrase: () => validatorPhrase('expectedPort'),
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
const oneOfIssue = catalogIssueCode(catalogCode('one-of'), {
  phrase: ({ values }) => validatorPhrase('expectedOneOf', values),
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
const urlIssue = catalogIssueCode(catalogCode('url'), {
  phrase: () => validatorPhrase('expectedUrl'),
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
const urlSchemeIssue = catalogIssueCode(catalogCode('url-scheme'), {
  phrase: ({ protocols }) => validatorPhrase('expectedUrlScheme', protocols),
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
const uuidIssue = catalogIssueCode(catalogCode('uuid'), {
  phrase: () => validatorPhrase('expectedUuid'),
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
const dateIssue = catalogIssueCode(catalogCode('date'), {
  phrase: () => validatorPhrase('expectedDate'),
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
const dateTimeIssue = catalogIssueCode(catalogCode('date-time'), {
  phrase: () => validatorPhrase('expectedDateTime'),
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
const dateLayoutsIssue = catalogIssueCode(catalogCode('date-layouts'), {
  phrase: ({ forms }) => validatorPhrase('expectedDateLayouts', forms),
  schema: formsParams,
});

/**
 * The issue code for the `date-time-layouts` rejection.
 *
 * @example
 * ```ts
 * import { dateTimeLayoutsIssue } from '@loomcli/validators';
 *
 * const issue = dateTimeLayoutsIssue.issue({ forms: ['YYYY-MM-DDThh:mm', 'DD/MM/YYYY hh:mm'] });
 * const params = dateTimeLayoutsIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const dateTimeLayoutsIssue = catalogIssueCode(catalogCode('date-time-layouts'), {
  phrase: ({ forms }) => validatorPhrase('expectedDateTimeLayouts', forms),
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
const timeIssue = catalogIssueCode(catalogCode('time'), {
  phrase: () => validatorPhrase('expectedTime'),
  schema: noParams,
});

/**
 * The issue code for the `time-layouts` rejection.
 *
 * @example
 * ```ts
 * import { timeLayoutsIssue } from '@loomcli/validators';
 *
 * const issue = timeLayoutsIssue.issue({ forms: ['hh:mm', 'hh:mmAM'] });
 * const params = timeLayoutsIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const timeLayoutsIssue = catalogIssueCode(catalogCode('time-layouts'), {
  phrase: ({ forms }) => validatorPhrase('expectedTimeLayouts', forms),
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
const timeRangeIssue = catalogIssueCode(catalogCode('time-range'), {
  phrase: ({ max, min }) => validatorPhrase('expectedTimeRange', min, max),
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
const timeMinIssue = catalogIssueCode(catalogCode('time-min'), {
  phrase: ({ min }) => validatorPhrase('expectedTimeMin', min),
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
const timeMaxIssue = catalogIssueCode(catalogCode('time-max'), {
  phrase: ({ max }) => validatorPhrase('expectedTimeMax', max),
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
const durationIssue = catalogIssueCode(catalogCode('duration'), {
  phrase: () => validatorPhrase('expectedDuration'),
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
const durationCapitalMIssue = catalogIssueCode(catalogCode('duration-capital-m'), {
  phrase: () => validatorPhrase('expectedDurationMinutes'),
  schema: noParams,
});

/**
 * The issue code for the `duration-range` rejection.
 *
 * @example
 * ```ts
 * import { durationRangeIssue } from '@loomcli/validators';
 *
 * const issue = durationRangeIssue.issue({ max: 3_600_000, min: 30_000 });
 * const params = durationRangeIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const durationRangeIssue = catalogIssueCode(catalogCode('duration-range'), {
  phrase: ({ max, min }) => validatorPhrase('expectedDurationRange', min, max),
  schema: rangeParams(isFiniteNumber),
});

/**
 * The issue code for the `duration-min` rejection.
 *
 * @example
 * ```ts
 * import { durationMinIssue } from '@loomcli/validators';
 *
 * const issue = durationMinIssue.issue({ min: 30_000 });
 * const params = durationMinIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const durationMinIssue = catalogIssueCode(catalogCode('duration-min'), {
  phrase: ({ min }) => validatorPhrase('expectedDurationMin', min),
  schema: minParams(isFiniteNumber),
});

/**
 * The issue code for the `duration-max` rejection.
 *
 * @example
 * ```ts
 * import { durationMaxIssue } from '@loomcli/validators';
 *
 * const issue = durationMaxIssue.issue({ max: 3_600_000 });
 * const params = durationMaxIssue.read(issue);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md#issue-codes
 * @public
 */
const durationMaxIssue = catalogIssueCode(catalogCode('duration-max'), {
  phrase: ({ max }) => validatorPhrase('expectedDurationMax', max),
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
const pathIssue = catalogIssueCode(catalogCode('path'), {
  phrase: () => validatorPhrase('expectedPath'),
  schema: noParams,
});

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
const pathReadableIssue = catalogIssueCode(catalogCode('path-readable'), {
  phrase: ({ kind }) => validatorPhrase('expectedReadablePath', kind),
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
const pathWritableIssue = catalogIssueCode(catalogCode('path-writable'), {
  phrase: ({ kind }) => validatorPhrase('expectedWritablePath', kind),
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
const bytesIssue = catalogIssueCode(catalogCode('bytes'), {
  phrase: () => validatorPhrase('expectedSize'),
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
const bytesRangeIssue = catalogIssueCode(catalogCode('bytes-range'), {
  phrase: ({ max, min }) => validatorPhrase('expectedSizeRange', min, max),
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
const bytesMinIssue = catalogIssueCode(catalogCode('bytes-min'), {
  phrase: ({ min }) => validatorPhrase('expectedSizeMin', min),
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
const bytesMaxIssue = catalogIssueCode(catalogCode('bytes-max'), {
  phrase: ({ max }) => validatorPhrase('expectedSizeMax', max),
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
const hostIssue = catalogIssueCode(catalogCode('host'), {
  phrase: () => validatorPhrase('expectedHost'),
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
const hostOrIpIssue = catalogIssueCode(catalogCode('host-or-ip'), {
  phrase: () => validatorPhrase('expectedHostOrIp'),
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
const ipIssue = catalogIssueCode(catalogCode('ip'), {
  phrase: () => validatorPhrase('expectedIp'),
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
const ipV4Issue = catalogIssueCode(catalogCode('ip-v4'), {
  phrase: () => validatorPhrase('expectedIpV4'),
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
const ipV6Issue = catalogIssueCode(catalogCode('ip-v6'), {
  phrase: () => validatorPhrase('expectedIpV6'),
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
const cidrIssue = catalogIssueCode(catalogCode('cidr'), {
  phrase: () => validatorPhrase('expectedCidr'),
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
const cidrV4Issue = catalogIssueCode(catalogCode('cidr-v4'), {
  phrase: () => validatorPhrase('expectedCidrV4'),
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
const cidrV6Issue = catalogIssueCode(catalogCode('cidr-v6'), {
  phrase: () => validatorPhrase('expectedCidrV6'),
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
const cidrHostBitsIssue = catalogIssueCode(catalogCode('cidr-host-bits'), {
  phrase: () => validatorPhrase('expectedNetworkAddress'),
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
const keyValueIssue = catalogIssueCode(catalogCode('key-value'), {
  phrase: ({ separator }) => validatorPhrase('expectedKeyValue', separator),
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
const emailIssue = catalogIssueCode(catalogCode('email'), {
  phrase: () => validatorPhrase('expectedEmail'),
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
