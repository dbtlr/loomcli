import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function schema(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/schema.mjs', import.meta.url), [scenario, ...argv]);
}

test('a supplied string reaches the action as the schema output', () => {
  expect(schema('transform', ['--size', '12'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":12}\n',
  });
});

test('a declared default enters the same transformation as a supplied value', () => {
  expect(schema('default')).toEqual({ status: 0, stderr: '', stdout: '{"size":10}\n' });
  expect(schema('default', ['--size', '20'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":20}\n',
  });
});

test('invalid supplied values never activate a valid default', () => {
  const result = schema('default', ['--size', 'bad']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Option "--size": Use decimal digits.');
});

test('an invalid default is a developer error even when replaced or inputs cannot parse', () => {
  for (const argv of [[], ['--size', '20'], ['--unknown']]) {
    const result = schema('invalid-default', argv);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Invalid declaration:');
    expect(result.stderr).toContain('default');
    expect(result.stderr).toContain('Use decimal digits.');
  }
});

test('omission skips schema-internal defaults while an empty supplied string is validated', () => {
  expect(schema('absence')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"absent":true,"calls":0,"presentKey":true}\n',
  });
  expect(schema('absence', ['--size='])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"absent":false,"calls":1,"presentKey":true}\n',
  });
});

test('async validation completes before dispatch and prepared defaults are reused', () => {
  expect(schema('async')).toEqual({ status: 0, stderr: '', stdout: '{"size":10,"calls":1}\n' });
  expect(schema('async', ['--size', '20'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":20,"calls":2}\n',
  });
  const failed = schema('async', ['--size', 'bad']);
  expect(failed.status).toBe(2);
  expect(failed.stdout).toBe('');
});

test('schema issues retain declaration and schema order, input kind, and collection path', () => {
  expect(schema('issues', ['--last', 'bad', 'x', '--same', 'bad'])).toEqual({
    status: 2,
    stderr:
      'Invalid input: Option "--same": First.\nOption "--same": Second.\nArgument "same" at 0: Too short.\nOption "--last": Last.\n',
    stdout: '',
  });
});

test('a variadic schema transforms the whole collection and leaves passthrough and host argv intact', () => {
  const argv = ['one', 'two', '--', '--size', 'bad'];
  expect(schema('collection', argv)).toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify({ args: { files: { count: 2, joined: 'one:two' } }, argv, passthrough: ['--size', 'bad'] })}\n`,
  });
});

test.each(['throw', 'reject'])(
  '%s is a developer error that stops later validation',
  (scenario) => {
    const result = schema(scenario, ['--size', '12', '--later', 'x']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Invalid declaration: Option "--size" validator failed unexpectedly: Broken validator.',
    );
  },
);

test('an empty issues array still rejects input', () => {
  const result = schema('empty-issues', ['--size', '12']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('without an explanation');
});

test.each([
  ['required-default', 'required and declares a default'],
  ['boolean-schema', 'is Boolean'],
  ['invalid-schema', 'Standard Schema v1'],
  ['nonstring-default', 'default must be a string'],
])('%s fails declaration checking before token parsing', (scenario, reason) => {
  const result = schema(scenario, ['--unknown']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Invalid declaration:');
  expect(result.stderr).toContain(reason);
});

test('a malformed schema result is a developer error', () => {
  const result = schema('malformed-result', ['--size', '12']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('invalid Standard Schema result');
});

test('required value options reject absence and transform a supplied value', () => {
  const result = schema('required');
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Option "--size" is required');
  expect(schema('required', ['--size', '12'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":12}\n',
  });
});

test('defaults retain raw strings without a schema and distinguish explicit undefined', () => {
  expect(schema('raw-default')).toEqual({ status: 0, stderr: '', stdout: '{"size":"raw"}\n' });
  expect(schema('undefined-default')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"size":"internal"}\n',
  });
  expect(schema('undefined-output')).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"absent":true,"calls":1}\n',
  });
});

test('captured declarations and prepared default outputs stay isolated across concurrent and repeated runs', () => {
  const result = schema('rerun');
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
  (shape) => {
    const result = schema('malformed-issue', [shape, '--size', 'x', '--later', 'y']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Invalid declaration: Option "--size" validator failed unexpectedly:',
    );
    expect(result.stderr).toContain('Fix the validator.');
  },
);
