// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import type { StandardSchemaV1 } from '@loomcli/core';
import { describe, expect, expectTypeOf, it, test } from 'vite-plus/test';
import { z } from 'zod';

import { issueCode } from '../src/index.js';
import type { IssueCode } from '../src/index.js';
import { declarationFault, faultOf, foreignIssue } from './support.js';

const rangeSchema = z.object({ max: z.number(), min: z.number() });

const range = issueCode('@acme/checks/range', {
  message: ({ max, min }) => `Expected from ${String(min)} to ${String(max)}.`,
  schema: rangeSchema,
});

/** A schema that accepts every value as it is, so only `read` itself can refuse the parameters. */
const anything = issueCode('@acme/checks/anything', {
  message: () => 'Expected anything.',
  schema: {
    '~standard': { validate: (value: unknown) => ({ value }), vendor: 'acme', version: 1 },
  },
});

test('issueCode returns a descriptor carrying its code and schema', () => {
  expectTypeOf(range).toEqualTypeOf<IssueCode<{ max: number; min: number }>>();
  expect(range.code).toBe('@acme/checks/range');
  expect(range.schema).toBe(rangeSchema);
});

test('issue returns an issue with the sentence, the code, and the parameters', () => {
  const issue = range.issue({ max: 64, min: 1 });
  expect(issue).toEqual({
    code: '@acme/checks/range',
    message: 'Expected from 1 to 64.',
    params: { max: 64, min: 1 },
  });
});

test('the issue holds the schema output, not the argument', () => {
  const supplied = { extra: 'dropped', max: 64, min: 1 };
  const issue = range.issue(supplied);
  expect(range.read(issue)).toEqual({ max: 64, min: 1 });
});

describe('read', () => {
  it('returns the typed parameters of an issue with its code', () => {
    const read = range.read(range.issue({ max: 64, min: 1 }));
    expectTypeOf(read).toEqualTypeOf<{ max: number; min: number } | undefined>();
    expect(read).toEqual({ max: 64, min: 1 });
  });

  it('reads an issue core copied, since core keeps every field', () => {
    const copied = { ...range.issue({ max: 9, min: 2 }), path: [0] };
    expect(range.read(copied)).toEqual({ max: 9, min: 2 });
  });

  const other = issueCode('@acme/checks/other', {
    message: () => 'Expected something else.',
    schema: rangeSchema,
  });
  const zodIssue = z.number().safeParse('x').error?.issues[0];

  const unread: [string, StandardSchemaV1.Issue | undefined][] = [
    ['another code', other.issue({ max: 64, min: 1 })],
    ['no code', { message: 'Expected from 1 to 64.' }],
    ['a Zod issue', zodIssue],
    [
      'parameters that fail the schema',
      foreignIssue({ code: range.code, message: 'x', params: { min: 1 } }),
    ],
    ['no parameters', foreignIssue({ code: range.code, message: 'x' })],
  ];

  it.each(unread)('returns undefined for an issue with %s', (_name, issue) => {
    expect(issue).toBeDefined();
    expect(issue === undefined ? 'absent' : range.read(issue)).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
  ])('returns undefined for an issue that is %s', (_name, issue) => {
    const read: unknown = Reflect.apply(range.read, undefined, [issue]);
    expect(read).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
  ])(
    'returns undefined for parameters that are %s, even when the schema accepts them',
    (_name, params) => {
      expect(
        anything.read(foreignIssue({ code: anything.code, message: 'x', params })),
      ).toBeUndefined();
    },
  );
});

/** A declared code whose schema answers every value with what `answer` returns. */
function answering(answer: () => StandardSchemaV1.Result<{ count: number }>) {
  return issueCode('@acme/checks/odd', {
    message: ({ count }) => `Expected ${String(count)}.`,
    schema: { '~standard': { validate: answer, vendor: 'acme', version: 1 } },
  });
}

describe('the schema answer', () => {
  it('issue keeps the schema output as the parameters', () => {
    const issue = answering(() => ({ value: { count: 2 } })).issue({ count: 1 });
    expect(issue).toEqual({
      code: '@acme/checks/odd',
      message: 'Expected 2.',
      params: { count: 2 },
    });
  });

  it('a schema that throws throws from issue and read, as the author wrote it', () => {
    const thrown = new Error('boom');
    const throwing = answering(() => {
      throw thrown;
    });
    expect(() => throwing.issue({ count: 1 })).toThrow(thrown);
    expect(() =>
      throwing.read(foreignIssue({ code: throwing.code, message: 'x', params: { count: 1 } })),
    ).toThrow(thrown);
  });
});

describe('faults', () => {
  const codes: [string, string][] = [
    ['no package', 'range'],
    ['no rule', '@acme/checks'],
    ['an empty rule', '@acme/checks/'],
    ['a scope with no package', '@acme/range'],
    ['an uppercase rule', '@acme/checks/Range'],
    ['an uppercase package', '@Acme/checks/range'],
    ['a doubled hyphen', '@acme/checks/in--range'],
    ['a leading hyphen', '@acme/checks/-range'],
    ['a trailing hyphen', '@acme/checks/range-'],
    ['an underscore', '@acme/checks/in_range'],
    ['a space', '@acme/checks/in range'],
    ['an empty subpath segment', '@acme/checks//range'],
    ['an uppercase subpath segment', '@acme/checks/Ports/range'],
    ['a trailing slash', '@acme/checks/ports/'],
  ];

  it.each(codes)('a code with %s throws at the call', (_name, code) => {
    const config = { message: () => 'Expected a value.', schema: rangeSchema };
    expect(faultOf(() => issueCode(code, config))).toEqual(
      declarationFault(
        `issueCode() code ${JSON.stringify(code)} is not a package name, any subpath segments, and a rule name joined by slashes. Supply a code such as "@acme/validators/port-range", with each subpath segment and the rule of lowercase letters and digits in words joined by single hyphens.`,
      ),
    );
  });

  it.each([
    '@loomcli/validators/integer-range',
    'checks/range2',
    '@acme/my.checks/a-1-b',
    '@acme/checks/ports/range',
    'checks/range/min',
  ])('the code %s is accepted', (code) => {
    expect(issueCode(code, { message: () => 'Expected a value.', schema: rangeSchema }).code).toBe(
      code,
    );
  });

  it('issue throws for parameters the schema rejects', () => {
    expect(faultOf(() => Reflect.apply(range.issue, undefined, [{ max: '64', min: 1 }]))).toEqual(
      declarationFault(
        'Issue code "@acme/checks/range" rejects the parameters passed to issue(). Supply parameters its schema accepts.',
      ),
    );
  });
});
