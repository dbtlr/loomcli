import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The fixture encodes an absent value as this marker, which JSON alone cannot carry. */
const none = '#undefined';

function omitted(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/validate-omitted.mjs', import.meta.url), [scenario, ...argv]);
}

function ran(scenario: string, argv: string[] = []) {
  const result = omitted(scenario, argv);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('an omitted option with validateOmitted reaches its schema in the invocation phase', () => {
  expect(ran('option')).toEqual({
    args: {},
    calls: [
      {
        absent: true,
        input: { global: false, kind: 'option', name: 'file' },
        phase: 'invocation',
        supplied: { args: {}, options: { file: none } },
      },
    ],
    options: { file: 'stdin' },
  });
});

test('a supplied value still reaches the same schema as its own string', () => {
  expect(ran('option', ['--file', 'doc.json'])).toEqual({
    args: {},
    calls: [
      {
        absent: false,
        input: { global: false, kind: 'option', name: 'file' },
        phase: 'invocation',
        supplied: { args: {}, options: { file: 'doc.json' } },
      },
    ],
    options: { file: 'file:doc.json' },
  });
});

test('an issue from the omitted call is an input error naming the supplied spelling', () => {
  expect(omitted('option-issue')).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--file": Supply a file or pipe JSON to stdin.\n',
    stdout: '',
  });
  expect(omitted('option-issue', ['-f', 'doc.json'])).toEqual({
    status: 0,
    stderr: '',
    stdout: expect.stringContaining('"file":"file:doc.json"'),
  });
});

test('an omitted scalar argument with validateOmitted reaches its schema the same way', () => {
  expect(ran('argument')).toEqual({
    args: { path: 'stdin' },
    calls: [
      {
        absent: true,
        input: { global: false, kind: 'argument', name: 'path' },
        phase: 'invocation',
        supplied: { args: { path: none }, options: {} },
      },
    ],
    options: {},
  });
  expect(ran('argument', ['doc.json']).args).toEqual({ path: 'file:doc.json' });
});

test('an issue from an omitted argument names the argument', () => {
  expect(omitted('argument-issue')).toEqual({
    status: 2,
    stderr: 'Invalid input: Argument "path": Supply a path or pipe JSON to stdin.\n',
    stdout: '',
  });
});

test.each([
  [
    'required',
    'Option "file" is required and declares validateOmitted. Remove validateOmitted or make the input optional.',
  ],
  [
    'default',
    'Option "file" declares a default and validateOmitted. Remove one; the default already fills an omitted value.',
  ],
  [
    'multiple',
    'Option "file" collects its values and declares validateOmitted. Remove validateOmitted; an omitted collection reaches the schema as an empty array.',
  ],
  [
    'variadic',
    'Argument "files" collects its values and declares validateOmitted. Remove validateOmitted; an omitted collection reaches the schema as an empty array.',
  ],
  [
    'boolean',
    'Option "force" is Boolean. Remove validate, default, required, and validateOmitted; use polarity to control its absent value.',
  ],
  [
    'unvalidated',
    'Option "file" declares validateOmitted without a schema. Add validate or remove validateOmitted.',
  ],
] satisfies [string, string][])(
  'the %s declaration is rejected before any token is read',
  (scenario, diagnostic) => {
    expect(omitted(scenario, ['--unknown'])).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${diagnostic}\n`,
      stdout: '',
    });
  },
);
