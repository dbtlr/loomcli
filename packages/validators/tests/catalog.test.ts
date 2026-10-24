/*
 * Acceptance plan for the validators reference (docs/libs/validators.md).
 *
 * - Soundness. For each factory, a table of accepted tokens validates, under Ajv's draft 2020-12
 *   validator with `ajv-formats` in full mode and `unicodeRegExp` on, the value the token stands
 *   for against the published schema: the number for `integer`, `number`, and `port`, and the token
 *   for every other factory. A test fails when any accepted token breaks the schema. The table
 *   includes each factory's edges: code points outside the Basic Multilingual Plane for `text`,
 *   `-0`, leading zeros, and safe-integer limits for the numbers, the leap day for `date`,
 *   including `0000-02-29` accepted and `0100-02-29` rejected, since a `Date.UTC` check maps years
 *   below 100 to the 1900s, mixed case for `uuid` and a `protocols` scheme, a `protocols` scheme
 *   containing `+`, `-`, or `.`, and for `url` the tokens RFC 3986 rejects and the WHATWG parser
 *   repairs.
 * - Rejection. For each factory, a table of rejected tokens pins the one message and shows the
 *   token is absent from it.
 * - Issue codes. Each rejected token's issue carries the code and parameters the table under Issue
 *   codes names, and the code's `read` returns those parameters for it and `undefined` for every
 *   other code's issue, a Zod issue, and an issue whose parameters fail the schema. An `InputError`
 *   override that reads `integerRangeIssue` rewrites that sentence through `run()` and leaves every
 *   other issue's sentence as the catalog wrote it. Each listed `issueCode` fault throws a
 *   `DeclarationError`, and `text({ pattern })` without `message` is a type error.
 * - Faults. Each listed fault throws `DeclarationError` from the factory call, under the rule
 *   Shared rules names, and each rule pins its rendered Developer Diagnostic.
 * - Context. A context-free factory validates when called directly; `path` called directly throws
 *   the context sentence; `path` inside a run resolves against a handle's `cwd`, using
 *   temporary directories for the `read` and `write` checks.
 * - Multiple options and variadic arguments. Core runs the validator once per value, reports each
 *   issue at its position, validates each default value, publishes the validator's schema
 *   unchanged, and calls nothing when no value is supplied, under ADR-0036. Core's multiple.test.ts
 *   and input-sources.test.ts prove this bullet.
 * - Help. A `oneOf` input of at most eight values prints `One of: ...` with no authored `accepts`,
 *   under help's limit of eight. The plugins' help-accepted.test.ts proves this bullet.
 */

import { expect, test } from 'vite-plus/test';

const catalog = await import('../src/index.js');

test('the root export holds the eleven factories, createValidator, issueCode, and the catalog codes', () => {
  expect(Object.keys(catalog).toSorted()).toEqual([
    'createValidator',
    'date',
    'dateIssue',
    'dateTime',
    'dateTimeIssue',
    'duration',
    'durationCapitalMIssue',
    'durationIssue',
    'durationMaxIssue',
    'durationMinIssue',
    'durationRangeIssue',
    'integer',
    'integerIssue',
    'integerMaxIssue',
    'integerMinIssue',
    'integerRangeIssue',
    'issueCode',
    'number',
    'numberIssue',
    'numberMaxIssue',
    'numberMinIssue',
    'numberRangeIssue',
    'oneOf',
    'oneOfIssue',
    'path',
    'pathIssue',
    'pathReadableIssue',
    'pathWritableIssue',
    'port',
    'portIssue',
    'text',
    'textExactLengthIssue',
    'textLengthRangeIssue',
    'textMaxLengthIssue',
    'textMinLengthIssue',
    'textNonemptyIssue',
    'textPatternIssue',
    'url',
    'urlIssue',
    'urlSchemeIssue',
    'uuid',
    'uuidIssue',
  ]);
});

test.each([
  ['text', catalog.text()],
  ['integer', catalog.integer()],
  ['number', catalog.number()],
  ['port', catalog.port()],
  ['oneOf', catalog.oneOf(['a'])],
  ['url', catalog.url()],
  ['uuid', catalog.uuid()],
  ['date', catalog.date()],
  ['dateTime', catalog.dateTime()],
  ['duration', catalog.duration()],
  ['path', catalog.path()],
])('%s() returns a value from the package that publishes an input schema', (_name, value) => {
  expect(value['~standard'].vendor).toBe('@loomcli/validators');
  expect(value['~standard'].jsonSchema.input).toBeTypeOf('function');
});

// A projection prints the published schema as it is, so its key order is part of the contract.
test.each([
  [
    'text',
    catalog.text({ maxLength: 8, message: 'Expected a leading a.', pattern: /^a/u }),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1,"maxLength":8,"pattern":"^a"}',
  ],
  [
    'integer',
    catalog.integer({ min: 1, max: 9 }),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"integer","minimum":1,"maximum":9}',
  ],
  [
    'oneOf',
    catalog.oneOf(['b', 'a']),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["b","a"]}',
  ],
  [
    'url',
    catalog.url({ protocols: ['https'] }),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"uri","pattern":"^(?:[hH][tT][tT][pP][sS]):"}',
  ],
  [
    'uuid',
    catalog.uuid(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"uuid"}',
  ],
  [
    'date',
    catalog.date(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"date"}',
  ],
  [
    'dateTime',
    catalog.dateTime(),
    String.raw`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\\.[0-9]+)?)?(?:[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?)?$"}`,
  ],
  [
    'duration',
    catalog.duration(),
    String.raw`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^\\s*(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:\\s*(?:minutes|seconds|minute|second|hours|weeks|days|hour|msec|week|day|min|sec|hr|ms|d|h|m|s|w)(?:\\s*(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)\\s*(?:minutes|seconds|minute|second|hours|weeks|days|hour|msec|week|day|min|sec|hr|ms|d|h|m|s|w))*)?\\s*$"}`,
  ],
  [
    'path',
    catalog.path(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1}',
  ],
  [
    'number',
    catalog.number({ min: 0 }),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number","minimum":0}',
  ],
  [
    'port',
    catalog.port(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"integer","minimum":1,"maximum":65535}',
  ],
])(
  '%s() publishes $schema, then type, then its keywords in the documented order',
  (_name, value, printed) => {
    expect(JSON.stringify(value['~standard'].jsonSchema.input({ target: 'draft-2020-12' }))).toBe(
      printed,
    );
  },
);
