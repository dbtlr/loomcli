import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { expectRuleParts } from './rule-parts.js';
import type { RuleParts } from './rule-parts.js';

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

test("an issue from the omitted call is an input error naming the option's long form", () => {
  expect(omitted('option-issue')).toEqual({
    status: 2,
    stderr: 'omitted: Option "--file": Supply a file or pipe JSON to stdin.\n',
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
    stderr: 'omitted: Argument "path": Supply a path or pipe JSON to stdin.\n',
    stdout: '',
  });
});

/** The fix for an input that takes several values, whose omission reads an empty array. */
const collectedFix =
  'Remove validateOmitted; with no values the action receives an empty array and no validator runs.';

test.each([
  [
    'required',
    {
      correction: 'Remove validateOmitted or make the input optional.',
      rule: 'omission-already-decided',
      sentence: 'Option "file" is required and declares validateOmitted.',
    },
  ],
  [
    'default',
    {
      correction: 'Remove one; the default already fills an omitted value.',
      rule: 'omission-already-decided',
      sentence: 'Option "file" declares a default and validateOmitted.',
    },
  ],
  [
    'multiple',
    {
      correction: collectedFix,
      rule: 'omission-already-decided',
      sentence: 'Option "file" takes several values and declares validateOmitted.',
    },
  ],
  [
    'variadic',
    {
      correction: collectedFix,
      rule: 'omission-already-decided',
      sentence: 'Argument "files" takes several values and declares validateOmitted.',
    },
  ],
  [
    'boolean',
    {
      correction: 'Remove validateOmitted; use polarity to control its absent value.',
      rule: 'boolean-option-value-rule',
      sentence: 'Option "force" is Boolean and declares validateOmitted.',
    },
  ],
  [
    'unvalidated',
    {
      correction: 'Add validate or remove validateOmitted.',
      rule: 'omission-without-validator',
      sentence: 'Option "file" declares validateOmitted without a validator.',
    },
  ],
] satisfies [string, RuleParts][])(
  'the %s declaration throws from the declaring call while the module evaluates',
  (scenario, parts) => {
    const result = omitted(scenario, ['--unknown']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('Invalid declaration:');
    expectRuleParts(result.stderr, parts);
  },
);
