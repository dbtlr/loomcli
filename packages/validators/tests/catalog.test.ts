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
 *   repairs. For `bytes` the table holds a fraction that a float multiply gets wrong (`2.01kB`),
 *   every unit and the bare binary prefixes, the whitespace `String.prototype.trim` removes, and
 *   `7PiB` beside the rejected `8PiB`. For `ip` and `host` it holds mixed case, every compressed
 *   position, an embedded IPv4 address in and outside `::ffff:0:0/96`, and a 253-character name;
 *   for `cidr` each family's widest and narrowest prefix; for `keyValue` a key holding a line
 *   terminator and a separator of each regular-expression syntax character; and for `email` the
 *   forms WHATWG accepts and RFC 5322 rejects, such as `a..b@example.com`. For `time` it holds
 *   midnight, `23:59:59` with a fraction, and each bound's edge. For `date`, `dateTime`, and `time`
 *   with layouts, it holds each directive, a one-digit field, the fixed width after an adjacent
 *   digit directive (`%Y%m%d`), `-` and `%%` literals, a literal of each regular-expression syntax
 *   character, each `%z` spelling, and `%p` in mixed case.
 * - Output. Each accepted token's output is pinned to an independent literal: `512Mi` is
 *   536870912, `2001:DB8:0:0:0:0:0:1` is `2001:db8::1`, `::ffff:c000:201` is `::ffff:192.0.2.1`,
 *   `64:ff9b::192.0.2.33` is `64:ff9b::c000:221`, a host name reads in lowercase, `09:30` is
 *   34200000 and `23:59:59.9999` is 86399999, `25/9/2026` under `%d/%m/%Y` is `2026-09-25`,
 *   `20260304` under `%Y%m%d` is `2026-03-04`, `03/04/2026` and `03/25/2026` under
 *   `['%d/%m/%Y', '%m/%d/%Y']` are `2026-04-03` and `2026-03-25`, `9:30pm` under `%I:%M%p` is
 *   77400000 with `12:00AM` 0 and `12:00PM` 43200000, `20260925T143000Z` under
 *   `%Y%m%dT%H%M%S%z` is `2026-09-25T14:30:00.000Z`, and a layout without `%z` reads a time a
 *   clock change skips or repeats as the default grammar does.
 * - Rejection. For each factory, a table of rejected tokens pins the one message and shows the
 *   token is absent from it, unless the sentence's own example holds it. With layouts, the message
 *   lists each distinct written form once, and `time` with bounds answers its bounds sentence.
 * - Issue codes. Each rejected token's issue carries the code and parameters the table under Issue
 *   codes names, and the code's `read` returns those parameters for it and `undefined` for every
 *   other code's issue, a Zod issue, and an issue whose parameters fail the schema. An `InputError`
 *   override that reads `integerRangeIssue` rewrites that sentence through `run()` and leaves every
 *   other issue's sentence as the catalog wrote it. Each listed `issueCode` fault throws a
 *   `DeclarationError`, and `text({ pattern })` without `message` is a type error.
 * - Faults. Each listed fault throws `DeclarationError` from the factory call, under the rule
 *   Shared rules names, and each rule pins its rendered Developer Diagnostic. Each layout fault,
 *   the literal `Z` included, pins its sentence and correction, and a layout fault marks the entry
 *   of `layouts` at fault.
 * - Context. A context-free factory validates when called directly; `path` called directly throws
 *   the context sentence; `path` inside a run resolves against a handle's `cwd`, using
 *   temporary directories for the `read` and `write` checks.
 * - Multiple options and variadic arguments. Core runs the validator once per value, reports each
 *   issue at its position, validates each default value, publishes the validator's schema
 *   unchanged, and calls nothing when no value is supplied, under ADR-0036. Core's multiple.test.ts
 *   and input-sources.test.ts prove this bullet.
 * - Help. A `oneOf` input of at most eight values prints `One of: ...` with no authored `accepts`,
 *   under help's limit of eight. The plugins' help-accepted.test.ts proves this bullet.
 * - Application run. The manifest and the inspected graph of an Application run read a catalog
 *   factory's published schema, a default passes the validator, the action receives the output,
 *   and a rejection reads its catalog sentence. catalog-run.test.ts proves this for `bytes`, `ip`,
 *   `keyValue`, and `date` and `time` with layouts.
 */

import { expect, test } from 'vite-plus/test';

const catalog = await import('../src/index.js');

test('the root export holds the eighteen factories, createValidator, pipe, issueCode, and the catalog codes', () => {
  expect(Object.keys(catalog).toSorted()).toEqual([
    'bytes',
    'bytesIssue',
    'bytesMaxIssue',
    'bytesMinIssue',
    'bytesRangeIssue',
    'cidr',
    'cidrHostBitsIssue',
    'cidrIssue',
    'cidrV4Issue',
    'cidrV6Issue',
    'createValidator',
    'date',
    'dateIssue',
    'dateLayoutsIssue',
    'dateTime',
    'dateTimeIssue',
    'dateTimeLayoutsIssue',
    'duration',
    'durationCapitalMIssue',
    'durationIssue',
    'durationMaxIssue',
    'durationMinIssue',
    'durationRangeIssue',
    'email',
    'emailIssue',
    'host',
    'hostIssue',
    'hostOrIpIssue',
    'integer',
    'integerIssue',
    'integerMaxIssue',
    'integerMinIssue',
    'integerRangeIssue',
    'ip',
    'ipIssue',
    'ipV4Issue',
    'ipV6Issue',
    'issueCode',
    'keyValue',
    'keyValueIssue',
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
    'pipe',
    'port',
    'portIssue',
    'text',
    'textExactLengthIssue',
    'textLengthRangeIssue',
    'textMaxLengthIssue',
    'textMinLengthIssue',
    'textNonemptyIssue',
    'textPatternIssue',
    'time',
    'timeIssue',
    'timeLayoutsIssue',
    'timeMaxIssue',
    'timeMinIssue',
    'timeRangeIssue',
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
  ['time', catalog.time()],
  ['duration', catalog.duration()],
  ['path', catalog.path()],
  ['bytes', catalog.bytes()],
  ['host', catalog.host()],
  ['ip', catalog.ip()],
  ['cidr', catalog.cidr()],
  ['keyValue', catalog.keyValue()],
  ['email', catalog.email()],
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
    'date with layouts',
    catalog.date({ layouts: ['%d/%m/%Y'] }),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"format":"date"},{"pattern":"^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$"}]}',
  ],
  [
    'dateTime with layouts',
    catalog.dateTime({ layouts: ['%d.%m.%Y %H:%M'] }),
    String.raw`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\\.[0-9]+)?)?(?:[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?)?$"},{"pattern":"^[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{4} [0-9]{1,2}:[0-9]{1,2}$"}]}`,
  ],
  [
    'time',
    catalog.time({ min: '09:00' }),
    String.raw`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\\.[0-9]+)?)?$"}`,
  ],
  [
    'time with layouts',
    catalog.time({ layouts: ['%I:%M%p'] }),
    String.raw`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"pattern":"^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\\.[0-9]+)?)?$"},{"pattern":"^[0-9]{1,2}:[0-9]{1,2}[AaPp][Mm]$"}]}`,
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
  [
    'bytes',
    catalog.bytes({ max: '10GiB' }),
    String.raw`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^\\s*(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)\\s*(?:KiB|MiB|GiB|TiB|PiB|Ki|Mi|Gi|Ti|Pi|[kK]B|MB|GB|TB|PB|B)?\\s*$"}`,
  ],
  [
    'host',
    catalog.host(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"hostname"}',
  ],
  [
    'host with ip',
    catalog.host({ ip: true }),
    String.raw`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"format":"hostname"},{"format":"ipv4"},{"pattern":"^\\[[0-9A-Fa-f:.]+\\]$"}]}`,
  ],
  [
    'ip',
    catalog.ip(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"format":"ipv4"},{"format":"ipv6"}]}',
  ],
  [
    'ip version 6',
    catalog.ip({ version: 6 }),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"ipv6"}',
  ],
  [
    'cidr',
    catalog.cidr(),
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^[0-9A-Fa-f:.]+/(?:12[0-8]|1[01][0-9]|[1-9]?[0-9])$"}',
  ],
  [
    'keyValue',
    catalog.keyValue(),
    String.raw`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^[\\s\\S]+="}`,
  ],
  [
    'email',
    catalog.email(),
    String.raw`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^[a-zA-Z0-9.!#$%&'*+/=?^_${'`'}{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$"}`,
  ],
])(
  '%s() publishes $schema, then type, then its keywords in the documented order',
  (_name, value, printed) => {
    expect(JSON.stringify(value['~standard'].jsonSchema.input({ target: 'draft-2020-12' }))).toBe(
      printed,
    );
  },
);
