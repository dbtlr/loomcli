// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { DeclarationError } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import {
  findingsOf,
  registeredRules,
  ruleContract,
  ruleParts,
} from '../../../scripts/test-rules.js';
import {
  bytes,
  createValidator,
  date,
  dateTime,
  duration,
  integer,
  issueCode,
  keyValue,
  oneOf,
  text,
  time,
  url,
} from '../src/index.js';

const parse = (raw: unknown) => ({ value: raw });

/** The parameters of the fixture issue code, whatever a call passes. */
interface Shout {
  readonly word: unknown;
}

/** A Standard Schema over the issue code's parameters that answers each value with `answer`. */
function schema(
  answer: (value: unknown) => StandardSchemaV1.Result<Shout>,
): StandardSchemaV1<Shout, Shout> {
  return { '~standard': { validate: answer, vendor: 'fixture', version: 1 } };
}

const message = ({ word }: Shout) => `Expected ${String(word)} in capitals.`;

/** One faulty factory call per scenario, each reachable from JavaScript alone. */
const scenarios: Record<string, () => unknown> = {
  'bound-value': () => integer({ min: Number.POSITIVE_INFINITY }),
  'bounds-order': () => integer({ max: 1, min: 5 }),
  'bytes-bound-value': () => bytes({ max: '10M' }),
  'bytes-bounds-order': () => bytes({ max: '1MB', min: '10GiB' }),
  'bytes-min-bound-value': () => bytes({ min: '1.5B' }),
  'context-outside-run': () =>
    createValidator({ parse: (_raw, context) => ({ value: context.host }) })['~standard'].validate(
      'x',
    ),
  'duration-bound-value': () => duration({ min: 'abc' }),
  'duration-bounds-order': () => duration({ max: '30s', min: '1h' }),
  'input-schema': () => createValidator({ inputSchema: { $schema: 'x', type: 'string' }, parse }),
  'issue-code-name': () =>
    issueCode('Bad Code', { message, schema: schema((value) => ({ value: { word: value } })) }),
  'issue-parameters': () =>
    issueCode('@acme/checks/shout', {
      message,
      schema: schema(() => ({ issues: [{ message: 'Expected a string.' }] })),
    }).issue({ word: 7 }),
  'key-value-separator': () => keyValue({ separator: ' ' }),
  'key-value-separator-empty': () => keyValue({ separator: '' }),
  'layout-empty': () => date({ layouts: [''] }),
  'layout-literal-zone': () => dateTime({ layouts: ['%d/%m/%Y %H:%M', '%Y%m%dT%H%M%SZ'] }),
  'layout-lone-percent': () => time({ layouts: ['%H:%M%'] }),
  'layout-meridiem-alone': () => time({ layouts: ['%H:%M%p'] }),
  'layout-missing-field': () => date({ layouts: ['%d/%m'] }),
  'layout-twelve-hour-alone': () => time({ layouts: ['%I:%M'] }),
  'layout-twice': () => date({ layouts: ['%d/%m/%Y/%d'] }),
  'layout-unknown-directive': () => date({ layouts: ['%d/%m/%Y', '%d %b %Y'] }),
  'layout-unread-directive': () => time({ layouts: ['%d %H:%M'] }),
  'one-of-twice': () => oneOf(['dev', 'prod', 'dev']),
  'text-bounds-order': () => text({ maxLength: 0 }),
  'text-pattern': () => text({ message: 'Expected letters.', pattern: /[a-z]+/g }),
  'time-bound-value': () => time({ max: '24:00' }),
  'time-bounds-order': () => time({ max: '09:00', min: '17:00' }),
  'time-zone': () => dateTime({ timeZone: 'Mars/Olympus' }),
  'url-protocols': () => url({ protocols: ['https', 'https:'] }),
};

/** The Developer Diagnostic the scenario's call throws as a declaration fault. */
function diagnosticOf(scenario: string): string {
  try {
    scenarios[scenario]?.();
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    return `${error.message}\n`;
  }
  return 'returned\n';
}

/** One fault by the parts its rule's test pins: the rule under the catalog's name, the sentence, the fix. */
interface Expected {
  readonly rule: string;
  readonly sentence: string;
  readonly correction: string;
}

const cases: Record<string, Expected> = {
  'bound-value': {
    correction: 'Supply a finite number.',
    rule: 'bound-value',
    sentence: 'integer() min is not a finite number.',
  },
  'bounds-order': {
    correction: 'Supply a min at or below max.',
    rule: 'bounds-order',
    sentence: 'integer() min 5 is above max 1.',
  },
  'bytes-bound-value': {
    correction: 'Supply a size such as "1MB" or "10GiB".',
    rule: 'bound-value',
    sentence: 'bytes() max is not a size.',
  },
  'bytes-bounds-order': {
    correction: 'Supply a min at or below max.',
    rule: 'bounds-order',
    sentence: 'bytes() min 10GiB is above max 1MB.',
  },
  'bytes-min-bound-value': {
    correction: 'Supply a size such as "1MB" or "10GiB".',
    rule: 'bound-value',
    sentence: 'bytes() min is not a size.',
  },
  'context-outside-run': {
    correction:
      'Call the validator through an Application run or with the options validationOptions builds, or leave the context unread.',
    rule: 'context-outside-run',
    sentence: 'This validator reads the validation context, which only exists during a Loom run.',
  },
  'duration-bound-value': {
    correction: 'Supply a duration such as "30s" or "2h30m".',
    rule: 'bound-value',
    sentence: 'duration() min is not a duration.',
  },
  'duration-bounds-order': {
    correction: 'Supply a min at or below max.',
    rule: 'bounds-order',
    sentence: 'duration() min 1h is above max 30s.',
  },
  'input-schema': {
    correction: 'Leave out $schema, which the validator publishes itself.',
    rule: 'input-schema',
    sentence: 'createValidator() inputSchema declares its own $schema.',
  },
  'issue-code-name': {
    correction:
      'Supply a code such as "@acme/validators/port-range", with each subpath segment and the rule of lowercase letters and digits in words joined by single hyphens.',
    rule: 'issue-code-name',
    sentence:
      'issueCode() code "Bad Code" is not a package name, any subpath segments, and a rule name joined by slashes.',
  },
  'issue-parameters': {
    correction: 'Supply parameters its schema accepts.',
    rule: 'issue-parameters',
    sentence: 'Issue code "@acme/checks/shout" rejects the parameters passed to issue().',
  },
  'key-value-separator': {
    correction: 'Supply one character or more with no whitespace, such as "=" or ":".',
    rule: 'key-value-separator',
    sentence: 'keyValue() separator holds whitespace.',
  },
  'key-value-separator-empty': {
    correction: 'Supply one character or more with no whitespace, such as "=" or ":".',
    rule: 'key-value-separator',
    sentence: 'keyValue() separator is empty.',
  },
  'layout-empty': {
    correction: 'Supply a layout such as "%d/%m/%Y".',
    rule: 'layout',
    sentence: 'date() layouts lists an empty layout.',
  },
  'layout-literal-zone': {
    correction: 'Write %z, which reads Z as UTC and every other offset as that offset.',
    rule: 'layout',
    sentence:
      'dateTime() layout "%Y%m%dT%H%M%SZ" holds a literal Z, which would read a UTC time as local time.',
  },
  'layout-lone-percent': {
    correction: 'Write %% for a percent sign.',
    rule: 'layout',
    sentence: 'time() layout "%H:%M%" ends with a lone %.',
  },
  'layout-meridiem-alone': {
    correction: 'Write %I for an hour from 1 through 12, or leave out %p.',
    rule: 'layout',
    sentence: 'time() layout "%H:%M%p" holds %p without %I.',
  },
  'layout-missing-field': {
    correction: 'Add %Y.',
    rule: 'layout',
    sentence: 'date() layout "%d/%m" holds no year.',
  },
  'layout-twelve-hour-alone': {
    correction: 'Add %p, or write %H for an hour from 0 through 23.',
    rule: 'layout',
    sentence: 'time() layout "%I:%M" holds %I without %p.',
  },
  'layout-twice': {
    correction: 'Write each field once.',
    rule: 'layout',
    sentence: 'date() layout "%d/%m/%Y/%d" holds the day twice.',
  },
  'layout-unknown-directive': {
    correction: 'Use only %Y, %m, and %d, with %% for a percent sign.',
    rule: 'layout',
    sentence: 'date() layout "%d %b %Y" holds %b, which no layout reads.',
  },
  'layout-unread-directive': {
    correction: 'Use only %H, %I, %M, %S, and %p, with %% for a percent sign.',
    rule: 'layout',
    sentence: 'time() layout "%d %H:%M" holds %d, which time() does not read.',
  },
  'one-of-twice': {
    correction: 'List each value once.',
    rule: 'one-of-values',
    sentence: 'oneOf() lists "dev" twice.',
  },
  'text-bounds-order': {
    correction: 'Supply a minLength at or below maxLength.',
    rule: 'bounds-order',
    sentence: 'text() minLength 1 is above maxLength 0.',
  },
  'text-pattern': {
    correction: 'Supply a pattern with no flag other than u.',
    rule: 'invalid-pattern',
    sentence: 'text() pattern carries the flag g.',
  },
  'time-bound-value': {
    correction: 'Supply a time of day such as "09:00" or "17:30".',
    rule: 'bound-value',
    sentence: 'time() max is not a time of day.',
  },
  'time-bounds-order': {
    correction: 'Supply a min at or below max.',
    rule: 'bounds-order',
    sentence: 'time() min 17:00 is above max 09:00.',
  },
  'time-zone': {
    correction: 'Supply a name such as America/New_York.',
    rule: 'time-zone',
    sentence: 'dateTime() timeZone is not an IANA time zone name.',
  },
  'url-protocols': {
    correction: 'List a letter followed by letters, digits, +, -, or ., with no trailing colon.',
    rule: 'url-protocols',
    sentence: 'url() protocols lists "https:", which is not a scheme name.',
  },
};

test.each(Object.entries(cases))(
  'the %s fault throws its rule’s diagnostic',
  (scenario, expected) => {
    expect(ruleParts(diagnosticOf(scenario))).toEqual({
      correction: expected.correction,
      identity: `@loomcli/validators/${expected.rule}`,
      sentence: expected.sentence,
    });
  },
);

test.each([
  ['bytes-bound-value', "    bytes({ max: '10M' })\n            ^^^^^^^^^^"],
  ['bytes-min-bound-value', "    bytes({ min: '1.5B' })\n            ^^^^^^^^^^^"],
  [
    'bytes-bounds-order',
    "    bytes({ max: '1MB', min: '10GiB' })\n                        ^^^^^^^^^^^^",
  ],
  ['key-value-separator', "    keyValue({ separator: ' ' })\n               ^^^^^^^^^^^^^^"],
  ['layout-empty', "    date({ layouts: [''] })\n                     ^^"],
  [
    'layout-literal-zone',
    "    dateTime({ layouts: ['%d/%m/%Y %H:%M', '%Y%m%dT%H%M%SZ'] })\n                                           ^^^^^^^^^^^^^^^^",
  ],
  [
    'layout-unknown-directive',
    "    date({ layouts: ['%d/%m/%Y', '%d %b %Y'] })\n                                 ^^^^^^^^^^",
  ],
  ['time-bound-value', "    time({ max: '24:00' })\n           ^^^^^^^^^^^^"],
])('the %s fault rebuilds the call and marks the argument at fault', (scenario, finding) => {
  expect(findingsOf(diagnosticOf(scenario))).toEqual([finding]);
});

/** Every rule the catalog's registry declares, under the catalog's name. */
const declared = registeredRules(
  new URL('../src/rules.ts', import.meta.url),
  /catalogRule\('(?<name>[a-z0-9-]+)', \{/gu,
);

test('every rule of the catalog has a pinned diagnostic', () => {
  const pinned = new Set(Object.values(cases).map((expected) => expected.rule));
  expect(declared.map((rule) => rule.name).toSorted()).toEqual([...pinned].toSorted());
});

// Each explanation lives in the registry alone; a rule's own test pins its sentence and correction.
test('every rule of the catalog has a one-line headline and an explanation of whole sentences', () => {
  const names = declared.map((rule) => rule.name);
  expect(names).toEqual([...new Set(names)]);
  expect(declared).toEqual(names.map((name) => ruleContract(name)));
});
