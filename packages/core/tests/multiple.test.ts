import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

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

test('a multiple string alias still has to end its short group', () => {
  const result = multiple('plain', ['-Ft', 'b']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Value option "-F" must be last in its short group.');
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
    stderr: 'Invalid input: Option "--field" is required. Supply at least one value.\n',
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
      'Invalid input: Option "--field" at 0: Supply a field name.\nOption "--field" at 2: Supply a field name.\n',
    stdout: '',
  });
});

test('a value issue with its own path reads after the value position', () => {
  expect(multiple('pathed', ['--field', 'a', '--field', 'b'])).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--field" at 1.name: Unknown name.\n',
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
  expect(result.stderr).toContain(
    'Invalid declaration: Option "field" has an invalid default. Fix the default or its validator.\nOption "field" at 1: Supply a field name.',
  );
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
    stderr: 'Invalid input: Option "--field" is required. Supply at least one value.\n',
    stdout: '',
  });
  expect(multiple('required', ['-F', 'a'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":["a"]},"passthrough":[]}\n',
  });
});

test('a multiple global is consumed by the pre-scan at every placement', () => {
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
    'Option "verbose" is a boolean option and declares multiple. Remove multiple or declare a string option.',
  ],
  ['nonboolean-multiple', 'Option "field" multiple must be Boolean. Use true or false.'],
  [
    'validated-string-default',
    'Option "field" default must be an array. Supply an array of values.',
  ],
  [
    'string-default',
    'Option "field" default must be an array of strings without a validator. Supply a string array default.',
  ],
])('%s throws from the declaring call while the module evaluates', (scenario, diagnostic) => {
  const result = multiple(scenario, ['--unknown']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).not.toContain('Invalid declaration:');
  expect(result.stderr).toContain(diagnostic);
});
