import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

async function schema(scenario: string, argv: string[] = []) {
  return await invokeFixture(new URL('fixtures/schema.mjs', import.meta.url), [scenario, ...argv]);
}

test('a supplied string reaches the action as the schema output', async () => {
  await expect(schema('transform', ['--size', '12'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":12}\n',
  });
});

test('a declared default enters the same transformation as a supplied value', async () => {
  await expect(schema('default')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":10}\n',
  });
  await expect(schema('default', ['--size', '20'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":20}\n',
  });
});

test('invalid supplied values never activate a valid default', async () => {
  const result = await schema('default', ['--size', 'bad']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Option "--size": Use decimal digits.');
});

test('an invalid default is a developer error even when replaced or inputs cannot parse', async () => {
  for (const argv of [[], ['--size', '20'], ['--unknown']]) {
    const result = await schema('invalid-default', argv);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    // The fixture is a development build, so the fault prints its Developer Diagnostic.
    expect(result.stderr).toContain(' @loomcli/core/invalid-default\n');
    expect(result.stderr).toContain('default');
    expect(result.stderr).toContain('Use decimal digits.');
  }
});

test('omission skips schema-internal defaults while an empty supplied string is validated', async () => {
  await expect(schema('absence')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"absent":true,"calls":0,"presentKey":true}\n',
  });
  await expect(schema('absence', ['--size='])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"absent":false,"calls":1,"presentKey":true}\n',
  });
});

test('async validation completes before dispatch and prepared defaults are reused', async () => {
  await expect(schema('async')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":10,"calls":1}\n',
  });
  await expect(schema('async', ['--size', '20'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":20,"calls":2}\n',
  });
  const failed = await schema('async', ['--size', 'bad']);
  expect(failed.status).toBe(2);
  expect(failed.stdout).toBe('');
});

test('validator issues retain declaration and validator order, input kind, and value position', async () => {
  await expect(schema('issues', ['--last', 'bad', 'x', '--same', 'bad'])).resolves.toEqual({
    status: 2,
    stderr:
      'schema: Option "--same": First.\nschema: Option "--same": Second.\nschema: Argument "same" at 0: Too short.\nschema: Option "--last": Last.\n',
    stdout: '',
  });
});

test('a variadic validator transforms each value and the action joins the array, leaving passthrough and host argv intact', async () => {
  const argv = ['one', 'two', '--', '--size', 'bad'];
  await expect(schema('each', argv)).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify({ args: { files: { count: 2, joined: 'ONE:TWO' } }, argv, passthrough: ['--size', 'bad'] })}\n`,
  });
});

test.each(['throw', 'reject'])(
  '%s is a developer error that stops later validation',
  async (scenario) => {
    const result = await schema(scenario, ['--size', '12', '--later', 'x']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      '-- VALIDATOR FAILED ----------------------------- @loomcli/core/validator-failed\n\nOption "size" validator failed unexpectedly: Broken validator.\n',
    );
  },
);

test('a thrown reason keeps the validator-failed sentence on one line with its controls escaped', async () => {
  const result = await schema('throw-controls', ['--size', '12']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    '\n\nOption "size" validator failed unexpectedly: bad\\u202eevil\\u000asecond line x.\n\n',
  );
});

test('an empty issues array still rejects input', async () => {
  const result = await schema('empty-issues', ['--size', '12']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('without an explanation');
});

test('a malformed schema result is a developer error', async () => {
  const result = await schema('malformed-result', ['--size', '12']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('invalid Standard Schema result');
});

test('required value options reject absence and transform a supplied value', async () => {
  const result = await schema('required');
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Option "--size" is required');
  await expect(schema('required', ['--size', '12'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":12}\n',
  });
});

test('defaults retain raw strings without a schema and distinguish explicit undefined', async () => {
  await expect(schema('raw-default')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":"raw"}\n',
  });
  await expect(schema('undefined-default')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":"internal"}\n',
  });
  await expect(schema('undefined-output')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"absent":true,"calls":1}\n',
  });
});

test('captured declarations and prepared default outputs stay isolated across concurrent and repeated runs', async () => {
  const result = await schema('rerun');
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(
    result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual([
    { ['__proto__']: { call: 1, size: 10 } },
    { ['__proto__']: { call: 3, size: 20 } },
    { ['__proto__']: { call: 4, size: 10 } },
  ]);
});

test.each(['missing', 'number', 'null', 'path', 'key', 'nonarray'])(
  'malformed issue %s stops validation as a developer error',
  async (shape) => {
    const result = await schema('malformed-issue', [shape, '--size', 'x', '--later', 'y']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('\n\nOption "size" validator failed unexpectedly: ');
    expect(result.stderr).toContain('\n\nFix the validator.\n');
  },
);
