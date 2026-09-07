import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function optional(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/optional-arguments.mjs', import.meta.url), [scenario, ...argv]);
}

test('an optional scalar argument binds the next bare token and is undefined without one', () => {
  expect(optional('optional')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"absent":true,"args":{}}\n',
  });
  expect(optional('optional', ['one.txt'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"absent":false,"args":{"path":"one.txt"}}\n',
  });
});

test('an optional argument schema reads a supplied token and skips omission', () => {
  expect(optional('schema')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{},"calls":0}\n',
  });
  expect(optional('schema', ['a'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"path":"a"},"calls":1}\n',
  });
  const failed = optional('schema', ['']);
  expect(failed.status).toBe(2);
  expect(failed.stderr).toBe('Invalid input: Argument "path": Supply a path.\n');
});

test('a declared default fills an omitted argument through its schema', () => {
  expect(optional('default')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"path":10},"passthrough":[]}\n',
  });
  expect(optional('default', ['20'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"path":20},"passthrough":[]}\n',
  });
});

test('an invalid argument default is a declaration error', () => {
  const result = optional('invalid-default', ['20']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Invalid declaration: Argument "path" has an invalid default.');
  expect(result.stderr).toContain('Use decimal digits.');
});

test('a required argument binds before an optional one', () => {
  expect(optional('pair', ['one'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"name":"one"},"passthrough":[]}\n',
  });
  expect(optional('pair', ['one', 'two'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"name":"one","path":"two"},"passthrough":[]}\n',
  });
  const missing = optional('pair');
  expect(missing.status).toBe(2);
  expect(missing.stderr).toContain('Argument "name" requires a value.');
  const extra = optional('pair', ['one', 'two', 'three']);
  expect(extra.status).toBe(2);
  expect(extra.stderr).toContain('accepts 2 arguments. Remove the extra values.');
});

test.each([
  [
    'optional-first',
    'Argument "path" is optional and precedes required argument "name" on Command "keys". Declare optional arguments after required ones.',
  ],
  [
    'after-optional',
    'Argument "extra" follows optional argument "path" on the root Command. Declare an optional argument last.',
  ],
])('%s fails graph build before token parsing', (scenario, diagnostic) => {
  const result = optional(scenario, ['one', 'two']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(`Invalid declaration: ${diagnostic}`);
});

test('an omitted optional variadic argument reaches its schema as an empty collection', () => {
  expect(optional('tail')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"files":[]},"calls":1}\n',
  });
  expect(optional('tail', ['one', 'two'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"files":["one","two"]},"calls":1}\n',
  });
});

test('a variadic default fills an omitted tail and each invocation receives its own copy', () => {
  const line = '{"args":{"files":["a","x"]}}\n';
  expect(optional('tail-default')).toEqual({ status: 0, stderr: '', stdout: `${line}${line}` });
  const supplied = '{"args":{"files":["one","x"]}}\n';
  expect(optional('tail-default', ['one'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `${supplied}${supplied}`,
  });
});

test('a required variadic argument still rejects an empty tail', () => {
  const missing = optional('tail-required');
  expect(missing.status).toBe(2);
  expect(missing.stderr).toBe(
    'Invalid input: Argument "files" requires at least one value. Supply a value for "files".\n',
  );
  expect(optional('tail-required', ['one'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"files":["one"]},"passthrough":[]}\n',
  });
});

test.each([
  [
    'tail-raw-default',
    'Argument "files" default must be an array of strings without a schema. Supply a string array default.',
  ],
  ['tail-invalid-default', 'Argument "files" has an invalid default.'],
])('%s is a declaration error', (scenario, diagnostic) => {
  const result = optional(scenario, ['one']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(`Invalid declaration: ${diagnostic}`);
});
