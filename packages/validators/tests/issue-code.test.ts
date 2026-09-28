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

/** A schema that validates by promise, which a synchronous read cannot wait for. */
const later: StandardSchemaV1<{ count: number }> = {
  '~standard': {
    validate: async (value: unknown) => {
      await Promise.resolve();
      return { value: { count: typeof value === 'number' ? value : 0 } };
    },
    vendor: 'acme',
    version: 1,
  },
};

/** A schema that accepts every value as it is, so only `read` itself can refuse the parameters. */
const anything = issueCode('@acme/checks/anything', {
  message: () => 'Expected anything.',
  schema: {
    '~standard': { validate: (value: unknown) => ({ value }), vendor: 'acme', version: 1 },
  },
});

const pending = issueCode('@acme/checks/pending', {
  message: ({ count }) => `Expected ${String(count)}.`,
  schema: later,
});

test('issueCode returns a frozen descriptor carrying its code and schema', () => {
  expectTypeOf(range).toEqualTypeOf<IssueCode<{ max: number; min: number }>>();
  expect(Object.isFrozen(range)).toBe(true);
  expect(range.code).toBe('@acme/checks/range');
  expect(range.schema).toBe(rangeSchema);
});

test('issue returns a frozen issue with the sentence, the code, and the parameters', () => {
  const issue = range.issue({ max: 64, min: 1 });
  expect(issue).toEqual({
    code: '@acme/checks/range',
    message: 'Expected from 1 to 64.',
    params: { max: 64, min: 1 },
  });
  expect(Object.isFrozen(issue)).toBe(true);
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

describe('a schema answer that is not a Standard Schema result', () => {
  const malformed = declarationFault(
    'Issue code "@acme/checks/odd" has a schema that answers with a value that is not a Standard Schema result. Supply a schema that returns its value or its issues.',
  );

  // Each proxy claims a result's type while its traps hide or replace the fields a result holds.
  const answers: [string, () => StandardSchemaV1.Result<{ count: number }>][] = [
    [
      'a throwing then getter and no own value',
      () =>
        new Proxy(
          { value: { count: 1 } },
          {
            get: (_target, key) => {
              if (key === 'then') {
                throw new Error('then');
              }
              return undefined;
            },
            getOwnPropertyDescriptor: () => undefined,
            has: (_target, key) => key === 'then',
          },
        ),
    ],
    [
      'a proxy that reports no field',
      () =>
        new Proxy(
          { value: { count: 1 } },
          { get: () => undefined, getOwnPropertyDescriptor: () => undefined },
        ),
    ],
    ['issues that are not an array', () => new Proxy({ issues: [] }, { get: () => 'x' })],
  ];

  it.each(answers)('issue throws for %s', (_name, answer) => {
    expect(faultOf(() => answering(answer).issue({ count: 1 }))).toEqual(malformed);
  });

  it.each(answers)('read returns undefined for %s', (_name, answer) => {
    const odd = answering(answer);
    expect(
      odd.read(foreignIssue({ code: odd.code, message: 'x', params: { count: 1 } })),
    ).toBeUndefined();
  });

  it('issue keeps the schema output as the parameters', () => {
    const issue = answering(() => ({ value: { count: 2 } })).issue({ count: 1 });
    expect(issue).toEqual({
      code: '@acme/checks/odd',
      message: 'Expected 2.',
      params: { count: 2 },
    });
  });

  const thrown = new Error('boom');
  const throwing = answering(() => {
    throw thrown;
  });

  it('issue throws a DeclarationError when the schema throws', () => {
    expect(faultOf(() => throwing.issue({ count: 1 }))).toEqual(
      declarationFault(
        'Issue code "@acme/checks/odd" has a schema that throws in issue(). Supply a schema that returns its issues instead of throwing.',
      ),
    );
  });

  it('read lets the schema throw', () => {
    expect(() =>
      throwing.read(foreignIssue({ code: throwing.code, message: 'x', params: { count: 1 } })),
    ).toThrow(thrown);
  });
});

describe('faults', () => {
  const codes: [string, unknown][] = [
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
    ['a second slash', 'checks/range/min'],
    ['a code that is not a string', 42],
  ];

  it.each(codes)('a code with %s throws at the call', (_name, code) => {
    const config = { message: () => 'Expected a value.', schema: rangeSchema };
    expect(faultOf(() => Reflect.apply(issueCode, undefined, [code, config]))).toEqual(
      declarationFault(
        `issueCode() code ${typeof code === 'string' ? JSON.stringify(code) : String(code)} is not a package name, a slash, and a rule name. Supply a code such as "@acme/validators/port-range", with a rule of lowercase letters and digits in words joined by single hyphens.`,
      ),
    );
  });

  it.each(['@loomcli/validators/integer-range', 'checks/range2', '@acme/my.checks/a-1-b'])(
    'the code %s is accepted',
    (code) => {
      expect(
        issueCode(code, { message: () => 'Expected a value.', schema: rangeSchema }).code,
      ).toBe(code);
    },
  );

  const configs: [string, unknown, string][] = [
    [
      'a config that is not a plain object',
      null,
      'issueCode() config is not a plain object. Supply an object with a schema and a message function.',
    ],
    [
      'a schema that is not a Standard Schema',
      { message: () => 'Expected a value.', schema: { validate: () => ({ value: {} }) } },
      'issueCode() schema is not a Standard Schema. Supply a Standard Schema value that validates the parameters.',
    ],
    [
      'a message that is not a function',
      { message: 'Expected a value.', schema: rangeSchema },
      'issueCode() message is not a function. Supply a function that builds the sentence from the parameters.',
    ],
  ];

  const notStandard =
    'issueCode() schema is not a Standard Schema. Supply a Standard Schema value that validates the parameters.';

  it.each([
    [
      'a version other than 1',
      { '~standard': { validate: () => ({ value: {} }), vendor: 'acme', version: 2 } },
    ],
    [
      'a ~standard getter that throws',
      {
        get '~standard'(): never {
          throw new Error('getter');
        },
      },
    ],
    [
      'a has trap that throws',
      new Proxy(rangeSchema, {
        has: () => {
          throw new Error('has');
        },
      }),
    ],
  ])('a schema with %s is not a Standard Schema', (_name, schema) => {
    const config = { message: () => 'Expected a value.', schema };
    expect(
      faultOf(() => Reflect.apply(issueCode, undefined, ['@acme/checks/range', config])),
    ).toEqual(declarationFault(notStandard));
  });

  it.each(configs)('%s throws at the call', (_name, config, message) => {
    expect(
      faultOf(() => Reflect.apply(issueCode, undefined, ['@acme/checks/range', config])),
    ).toEqual(declarationFault(message));
  });

  it('issue throws for parameters the schema rejects', () => {
    expect(faultOf(() => Reflect.apply(range.issue, undefined, [{ max: '64', min: 1 }]))).toEqual(
      declarationFault(
        'Issue code "@acme/checks/range" rejects the parameters passed to issue(). Supply parameters its schema accepts.',
      ),
    );
  });

  it('issue and read throw when the schema answers with a promise', () => {
    const fault = declarationFault(
      'Issue code "@acme/checks/pending" has a schema that answers with a promise. Supply a schema that validates synchronously.',
    );
    expect(faultOf(() => pending.issue({ count: 1 }))).toEqual(fault);
    expect(
      faultOf(() =>
        pending.read(foreignIssue({ code: pending.code, message: 'x', params: { count: 1 } })),
      ),
    ).toEqual(fault);
  });
});
