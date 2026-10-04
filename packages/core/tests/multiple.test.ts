import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { expectRuleParts } from './rule-parts.js';

function multiple(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/multiple.mjs', import.meta.url), [scenario, ...argv]);
}

test('a multiple option collects every occurrence across its spellings in supplied order', () => {
  expect(multiple('plain', ['--field', 'a', '-F', 'b', '--field=c'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a","b","c"],"total":false},"passthrough":[]}\n',
  });
  expect(multiple('plain', ['-tF', 'b', '--', 'tail'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["b"],"total":true},"passthrough":["tail"]}\n',
  });
});

test('a multiple string alias ends its short group, taking the rest of the word as its value', () => {
  expect(multiple('plain', ['-Ft', '-F=b', '-tFc'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["t","b","c"],"total":true},"passthrough":[]}\n',
  });
});

test('an omitted multiple option calls no validator and gives the action an empty array', () => {
  expect(multiple('schema')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"calls":0,"options":{"field":[]}}\n',
  });
});

test("the action receives the array of each value's validator output", () => {
  expect(multiple('counted', ['--field', 'a', '--field', 'abc'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":[1,3]},"passthrough":[]}\n',
  });
});

test('required is checked before any validator, so it answers an omission first', () => {
  expect(multiple('required-schema')).toEqual({
    status: 2,
    stderr: 'multiple: Option "--field" is required. Supply at least one value.\n',
    stdout: '',
  });
});

test('a multiple validator runs once per value and reports each issue at its position', () => {
  expect(multiple('schema', ['--field', 'a', '--field=b'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"calls":2,"options":{"field":["a","b"]}}\n',
  });
  expect(multiple('schema', ['-F', '', '--field', 'a', '-F', ''])).toEqual({
    status: 2,
    stderr:
      'multiple: Option "--field" at 0: Supply a field name.\nmultiple: Option "--field" at 2: Supply a field name.\n',
    stdout: '',
  });
});

test("a run cancelled inside one value's validator starts no call for the next value", () => {
  expect(multiple('abort-mid-list', ['--field', 'a', '--field', 'b', '--field', 'c'])).toEqual({
    status: 130,
    stderr: '',
    stdout: 'calls:1:code:130\n',
  });
});

test('each per-value call reads its own context, so a write in one call never reaches the next', () => {
  expect(multiple('per-value-context', ['--field', 'a', '--field', 'b'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify([
      { command: [], field: ['a', 'b'], kept: true },
      { command: [], field: ['a', 'b'], kept: true },
    ])}\n`,
  });
});

test('a value issue with its own path reads after the value position', () => {
  expect(multiple('pathed', ['--field', 'a', '--field', 'b'])).toEqual({
    status: 2,
    stderr: 'multiple: Option "--field" at 1.name: Unknown name.\n',
    stdout: '',
  });
});

test('each multiple default value passes through the validator and a supplied array replaces it', () => {
  expect(multiple('default')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["A","B"]},"passthrough":[]}\n',
  });
  expect(multiple('default', ['--field', 'x', '--field', 'y'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["X","Y"]},"passthrough":[]}\n',
  });
});

test('a rejected default value fails every run with its position', () => {
  const result = multiple('invalid-default', ['--field', 'fine']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  // The fixture is a development build, so the fault prints its Developer Diagnostic.
  expectRuleParts(result.stderr, {
    correction: 'Fix the default or its validator.',
    rule: 'invalid-default',
    sentence: 'Option "field" has an invalid default.\nOption "field" at 1: Supply a field name.',
  });
});

test('a multiple default without a validator stays a raw string array', () => {
  expect(multiple('raw-default')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a"]},"passthrough":[]}\n',
  });
});

test('a required multiple option reports absence as a validation issue', () => {
  expect(multiple('required')).toEqual({
    status: 2,
    stderr: 'multiple: Option "--field" is required. Supply at least one value.\n',
    stdout: '',
  });
  expect(multiple('required', ['-F', 'a'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a"]},"passthrough":[]}\n',
  });
});

test('a multiple global is collected at every placement, whichever layer reads it', () => {
  expect(multiple('global', ['--field', 'a', 'show', '-F', 'b', '--local', '--field=c'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a","b","c"],"local":true},"passthrough":[]}\n',
  });
  expect(multiple('global', ['-F', 'a', '--field', 'b'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a","b"]},"passthrough":[]}\n',
  });
  expect(multiple('global', ['show'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":[],"local":false},"passthrough":[]}\n',
  });
});

test.each([
  [
    'boolean-multiple',
    {
      correction: 'Remove multiple or declare a string option.',
      rule: 'boolean-option-multiple',
      sentence: 'Option "verbose" is a boolean option and declares multiple.',
    },
  ],
  [
    'nonboolean-multiple',
    {
      correction: 'Use true or false.',
      rule: 'flag-not-boolean',
      sentence: 'The root Command option "field" declares multiple that is not a Boolean.',
    },
  ],
  [
    'validated-string-default',
    {
      correction: 'Supply an array of values.',
      rule: 'default-shape',
      sentence: 'Option "field" default must be an array.',
    },
  ],
  [
    'string-default',
    {
      correction: 'Supply a string array default.',
      rule: 'default-shape',
      sentence: 'Option "field" default must be an array of strings without a validator.',
    },
  ],
])('%s throws from the declaring call while the module evaluates', (scenario, parts) => {
  const result = multiple(scenario, ['--unknown']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).not.toContain('Invalid declaration:');
  expectRuleParts(result.stderr, parts);
});
