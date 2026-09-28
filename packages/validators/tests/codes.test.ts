import type { InputProblem, StandardSchemaV1 } from '@loomcli/core';
import { describe, expect, expectTypeOf, it, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import type { IssueCode } from '../src/index.js';
import { declarationFault, faultOf, foreignIssue, verdict } from './support.js';

const catalog = await import('../src/index.js');

const prefix = '@loomcli/validators/';

const fixture = new URL('fixtures/override-run.mjs', import.meta.url);

/** One catalog code: its descriptor, the validator and token that earn it, and what it carries. */
type Row = [
  code: string,
  descriptor: IssueCode<unknown>,
  validator: StandardSchemaV1<string, unknown>,
  token: string,
  params: object,
  message: string,
];

const rows: Row[] = [
  [
    'text-nonempty',
    catalog.textNonemptyIssue,
    catalog.text(),
    '',
    {},
    'Expected a nonempty value.',
  ],
  [
    'text-min-length',
    catalog.textMinLengthIssue,
    catalog.text({ minLength: 2 }),
    'z',
    { min: 2 },
    'Expected at least 2 characters.',
  ],
  [
    'text-max-length',
    catalog.textMaxLengthIssue,
    catalog.text({ maxLength: 3, minLength: 0 }),
    'abcd',
    { max: 3 },
    'Expected at most 3 characters.',
  ],
  [
    'text-exact-length',
    catalog.textExactLengthIssue,
    catalog.text({ maxLength: 8, minLength: 8 }),
    'short',
    { length: 8 },
    'Expected exactly 8 characters.',
  ],
  [
    'text-length-range',
    catalog.textLengthRangeIssue,
    catalog.text({ maxLength: 32 }),
    '',
    { max: 32, min: 1 },
    'Expected from 1 through 32 characters.',
  ],
  [
    'text-pattern',
    catalog.textPatternIssue,
    catalog.text({ message: 'Expected lowercase letters.', pattern: /^[a-z]+$/u }),
    'ABC',
    { message: 'Expected lowercase letters.' },
    'Expected lowercase letters.',
  ],
  ['integer', catalog.integerIssue, catalog.integer(), 'abc', {}, 'Expected a whole number.'],
  [
    'integer-range',
    catalog.integerRangeIssue,
    catalog.integer({ max: 64, min: 1 }),
    '99',
    { max: 64, min: 1 },
    'Expected a whole number from 1 through 64.',
  ],
  [
    'integer-min',
    catalog.integerMinIssue,
    catalog.integer({ min: 1 }),
    '0',
    { min: 1 },
    'Expected a whole number of at least 1.',
  ],
  [
    'integer-max',
    catalog.integerMaxIssue,
    catalog.integer({ max: 10 }),
    '11',
    { max: 10 },
    'Expected a whole number of at most 10.',
  ],
  ['number', catalog.numberIssue, catalog.number(), 'NaN', {}, 'Expected a number.'],
  [
    'number-range',
    catalog.numberRangeIssue,
    catalog.number({ max: 1, min: 0 }),
    '2',
    { max: 1, min: 0 },
    'Expected a number from 0 through 1.',
  ],
  [
    'number-min',
    catalog.numberMinIssue,
    catalog.number({ min: 0.5 }),
    '0.25',
    { min: 0.5 },
    'Expected a number of at least 0.5.',
  ],
  [
    'number-max',
    catalog.numberMaxIssue,
    catalog.number({ max: 1e21 }),
    '2e21',
    { max: 1e21 },
    'Expected a number of at most 1e+21.',
  ],
  [
    'port',
    catalog.portIssue,
    catalog.port(),
    '0',
    {},
    'Expected a port number from 1 through 65535.',
  ],
  [
    'one-of',
    catalog.oneOfIssue,
    catalog.oneOf(['bytes', 'words', 'lines']),
    'chars',
    { values: ['bytes', 'words', 'lines'] },
    'Expected one of: bytes, words, lines.',
  ],
  [
    'url',
    catalog.urlIssue,
    catalog.url(),
    'not a url',
    {},
    'Expected an absolute URL, such as https://example.com.',
  ],
  [
    'url-scheme',
    catalog.urlSchemeIssue,
    catalog.url({ protocols: ['https', 'http'] }),
    'ftp://example.org',
    { protocols: ['https', 'http'] },
    'Expected an absolute URL with the scheme https or http.',
  ],
  [
    'uuid',
    catalog.uuidIssue,
    catalog.uuid(),
    'nope',
    {},
    'Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.',
  ],
  [
    'date',
    catalog.dateIssue,
    catalog.date(),
    '2026-02-29',
    {},
    'Expected a date as YYYY-MM-DD, such as 2026-09-25.',
  ],
  [
    'path',
    catalog.pathIssue,
    catalog.path(),
    '',
    {},
    'Expected a nonempty path with no NUL character.',
  ],
  [
    'path-readable',
    catalog.pathReadableIssue,
    catalog.path({ access: 'read', kind: 'any' }),
    'a\0b',
    { kind: 'any' },
    'Expected a readable file or directory that exists.',
  ],
  [
    'path-writable',
    catalog.pathWritableIssue,
    catalog.path({ access: 'write', kind: 'any' }),
    'a\0b',
    { kind: 'any' },
    'Expected a writable path, or a new path in a writable directory.',
  ],
];

const descriptors = rows.map(([, descriptor]) => descriptor);

/** The one issue a rejected token earns, read from a direct call. */
async function issueOf(validator: StandardSchemaV1<string, unknown>, token: string) {
  const result = await verdict(validator, token);
  expect(result.issues).toHaveLength(1);
  const [issue] = result.issues ?? [];
  if (issue === undefined) {
    throw new Error('The validator accepted the token.');
  }
  return issue;
}

test('the catalog declares 23 codes, each a frozen descriptor under its export', () => {
  expect(rows).toHaveLength(23);
  expect(new Set(descriptors).size).toBe(23);
  for (const [code, descriptor] of rows) {
    expect(descriptor.code).toBe(`${prefix}${code}`);
    expect(Object.isFrozen(descriptor)).toBe(true);
  }
});

describe('each rejection carries its code and the rule settings as parameters', () => {
  it.each(rows)('%s', async (code, descriptor, validator, token, params, message) => {
    const issue = await issueOf(validator, token);
    expect(issue).toEqual({ code: `${prefix}${code}`, message, params });
    expect(descriptor.read(issue)).toEqual(params);
    // The empty token is inside every string, so only a nonempty token can be repeated.
    expect(token === '' || !JSON.stringify(params).includes(token)).toBe(true);
  });
});

describe('every other code reads the issue as undefined', () => {
  it.each(rows)('%s', async (_code, descriptor, validator, token) => {
    const issue = await issueOf(validator, token);
    for (const other of descriptors.filter((each) => each !== descriptor)) {
      expect(other.read(issue)).toBeUndefined();
    }
  });
});

test('a catalog code rejects parameters of another shape', () => {
  const code = catalog.integerRangeIssue.code;
  expect(
    catalog.integerRangeIssue.read(foreignIssue({ code, message: 'x', params: { min: 1 } })),
  ).toBe(undefined);
  expect(
    catalog.integerRangeIssue.read(
      foreignIssue({ code, message: 'x', params: { max: 1, min: '0' } }),
    ),
  ).toBe(undefined);
  expect(
    catalog.integerIssue.read(foreignIssue({ code: catalog.integerIssue.code, message: 'x' })),
  ).toBe(undefined);
  expect(faultOf(() => Reflect.apply(catalog.pathReadableIssue.issue, undefined, [{}]))).toEqual(
    declarationFault(
      `Issue code "${prefix}path-readable" rejects the parameters passed to issue(). Supply parameters its schema accepts.`,
    ),
  );
});

describe('a count of 1 reads character', () => {
  it.each([
    [catalog.textMinLengthIssue.issue({ min: 1 }), 'Expected at least 1 character.'],
    [catalog.textMaxLengthIssue.issue({ max: 1 }), 'Expected at most 1 character.'],
    [catalog.textExactLengthIssue.issue({ length: 1 }), 'Expected exactly 1 character.'],
  ])('%#', (issue, message) => {
    expect(issue.message).toBe(message);
  });
});

describe('each path kind reads its own words', () => {
  it.each([
    ['file', 'Expected a readable file that exists.'],
    ['directory', 'Expected a readable directory that exists.'],
    ['any', 'Expected a readable file or directory that exists.'],
  ] as const)('readable %s', (kind, message) => {
    expect(catalog.pathReadableIssue.issue({ kind }).message).toBe(message);
  });

  it.each([
    ['file', 'Expected a writable file, or a new file in a writable directory.'],
    ['directory', 'Expected a writable directory, or a new directory in a writable directory.'],
    ['any', 'Expected a writable path, or a new path in a writable directory.'],
  ] as const)('writable %s', (kind, message) => {
    expect(catalog.pathWritableIssue.issue({ kind }).message).toBe(message);
  });
});

/** What an `InputError` view writes for one problem, reading `integer-range` through its type. */
function lines(problem: InputProblem) {
  return problem.reason === 'missing'
    ? []
    : problem.issues.map((issue) => {
        const range: { max: number; min: number } | undefined =
          catalog.integerRangeIssue.read(issue);
        return range === undefined ? issue.message : `${String(range.min)}-${String(range.max)}`;
      });
}

test('read types the parameters an InputError view receives', () => {
  expectTypeOf(catalog.integerRangeIssue.read).returns.toEqualTypeOf<
    { max: number; min: number } | undefined
  >();
  expectTypeOf(catalog.oneOfIssue.read).returns.toEqualTypeOf<
    { values: readonly string[] } | undefined
  >();
  expectTypeOf(catalog.pathReadableIssue.read).returns.toEqualTypeOf<
    { kind: 'file' | 'directory' | 'any' } | undefined
  >();
  const problem: InputProblem = {
    input: { global: false, kind: 'option', name: 'workers' },
    issues: [catalog.integerRangeIssue.issue({ max: 64, min: 1 }), { message: 'Other.' }],
    reason: 'invalid',
    spelling: '--workers',
  };
  expect(lines(problem)).toEqual(['1-64', 'Other.']);
});

describe('an InputError override rewords one code through run()', () => {
  it('reads integer-range and writes its own sentence', () => {
    expect(invoke(fixture, ['--workers', '99'])).toEqual({
      status: 2,
      stderr: 'serve: --workers takes from 1 to 64 workers.\n',
      stdout: '',
    });
  });

  it('leaves every other issue its catalog sentence', () => {
    expect(invoke(fixture, ['--workers', 'many', '--mode', 'test'])).toEqual({
      status: 2,
      stderr:
        'serve: --workers takes from 1 to 64 workers.\nserve: --mode: Expected one of: dev, prod.\n',
      stdout: '',
    });
  });

  it('runs the action for accepted input', () => {
    expect(invoke(fixture, ['--workers', '8'])).toEqual({
      status: 0,
      stderr: '',
      stdout: 'served 8\n',
    });
  });
});
