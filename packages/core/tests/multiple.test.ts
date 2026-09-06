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

test('an omitted multiple option validates its empty collection exactly once', () => {
  expect(multiple('schema')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"calls":1,"options":{"field":[]}}\n',
  });
});

test('the action receives the schema output of the empty collection, not the collection', () => {
  expect(multiple('counted')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":0},"passthrough":[]}\n',
  });
});

test('a schema that rejects the empty collection reports its issue on omission', () => {
  expect(multiple('nonempty')).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--field": Supply at least one field.\n',
    stdout: '',
  });
});

test('required is checked before the schema, so it answers an omission first', () => {
  expect(multiple('nonempty-required')).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--field" is required. Supply at least one value.\n',
    stdout: '',
  });
});

test('a multiple schema receives the whole array once and reports per-item issues', () => {
  expect(multiple('schema', ['--field', 'a', '--field=b'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"calls":1,"options":{"field":["a","b"]}}\n',
  });
  expect(multiple('schema', ['--field', 'a', '-F', ''])).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--field" at 1: Supply a field name.\n',
    stdout: '',
  });
});

test('a multiple default passes through the schema and a supplied array replaces it', () => {
  expect(multiple('default')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":"a:b"},"passthrough":[]}\n',
  });
  expect(multiple('default', ['--field', 'x', '--field', 'y'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"options":{"field":"x:y"},"passthrough":[]}\n',
  });
});

test('a multiple default without a schema stays a raw string array', () => {
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
    'string-default',
    'Option "field" default must be an array of strings without a schema. Supply a string array default.',
  ],
])('%s fails declaration checking before token parsing', (scenario, diagnostic) => {
  const result = multiple(scenario, ['--unknown']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(`Invalid declaration: ${diagnostic}`);
});
