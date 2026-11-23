import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

async function optional(scenario: string, argv: string[] = []) {
  return await invokeFixture(new URL('fixtures/optional-arguments.mjs', import.meta.url), [
    scenario,
    ...argv,
  ]);
}

test('an optional scalar argument binds the next bare token and is undefined without one', async () => {
  await expect(optional('optional')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"absent":true,"args":{}}\n',
  });
  await expect(optional('optional', ['one.txt'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"absent":false,"args":{"path":"one.txt"}}\n',
  });
});

test('an optional argument schema reads a supplied token and skips omission', async () => {
  await expect(optional('schema')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{},"calls":0}\n',
  });
  await expect(optional('schema', ['a'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"path":"a"},"calls":1}\n',
  });
  const failed = await optional('schema', ['']);
  expect(failed.status).toBe(2);
  expect(failed.stderr).toBe('optional: Argument "path": Supply a path.\n');
});

test('a declared default fills an omitted argument through its schema', async () => {
  await expect(optional('default')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"path":10},"passthrough":[]}\n',
  });
  await expect(optional('default', ['20'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"path":20},"passthrough":[]}\n',
  });
});

test('an invalid argument default is a declaration error', async () => {
  const result = await optional('invalid-default', ['20']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  // The fixture is a development build, so the fault prints its Developer Diagnostic.
  expect(result.stderr).toContain(' @loomcli/core/invalid-default\n');
  expect(result.stderr).toContain('\n\nArgument "path" has an invalid default.\n');
  expect(result.stderr).toContain('Use decimal digits.');
});

test('a required argument binds before an optional one', async () => {
  await expect(optional('pair', ['one'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"name":"one"},"passthrough":[]}\n',
  });
  await expect(optional('pair', ['one', 'two'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"name":"one","path":"two"},"passthrough":[]}\n',
  });
  const missing = await optional('pair');
  expect(missing.status).toBe(2);
  expect(missing.stderr).toContain('Argument "name" requires a value.');
  const extra = await optional('pair', ['one', 'two', 'three']);
  expect(extra.status).toBe(2);
  expect(extra.stderr).toContain('accepts 2 arguments. Remove the extra values.');
});

test('bare words fill optional arguments left to right, and one that receives none is omitted', async () => {
  await expect(optional('two-optional')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{},"passthrough":[]}\n',
  });
  await expect(optional('two-optional', ['one'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"path":"one"},"passthrough":[]}\n',
  });
  await expect(optional('two-optional', ['one', 'two'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"path":"one","extra":"two"},"passthrough":[]}\n',
  });
});

test('a required argument after an optional one throws from the declaring call', async () => {
  const result = await optional('optional-first', ['one', 'two']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('@loomcli/core/optional-argument-last');
  expect(result.stderr).toContain(`
Argument "path" is optional and precedes required argument "name" on Command "keys".
`);
  expect(result.stderr).toContain(`
Declare optional arguments after required ones.
`);
});

test('an omitted optional variadic argument calls no validator and gives the action an empty array', async () => {
  await expect(optional('tail')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"files":[]},"calls":0}\n',
  });
  await expect(optional('tail', ['one', 'two'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"files":["one","two"]},"calls":2}\n',
  });
});

test('a variadic default fills an omitted tail and each invocation receives its own copy', async () => {
  const line = '{"args":{"files":["a","x"]}}\n';
  await expect(optional('tail-default')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${line}${line}`,
  });
  const supplied = '{"args":{"files":["one","x"]}}\n';
  await expect(optional('tail-default', ['one'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${supplied}${supplied}`,
  });
});

test('a required variadic argument still rejects an empty tail', async () => {
  const missing = await optional('tail-required');
  expect(missing.status).toBe(2);
  expect(missing.stderr).toBe(
    'optional: Argument "files" requires at least one value. Supply a value for "files".\n',
  );
  await expect(optional('tail-required', ['one'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"files":["one"]},"passthrough":[]}\n',
  });
});

// A schema may answer asynchronously, so a default it rejects waits for run().
test.each([['tail-invalid-default', 'Argument "files" has an invalid default.']])(
  '%s is a declaration error',
  async (scenario, diagnostic) => {
    const result = await optional(scenario, ['one']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(' @loomcli/core/invalid-default\n');
    expect(result.stderr).toContain(`\n\n${diagnostic}`);
  },
);
