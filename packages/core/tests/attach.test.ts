import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/attach.mjs', import.meta.url);

/** One invocation of the fixture application under the hooks one scenario installs. */
function run(scenario: string, argv: string[] = []) {
  return invoke(fixture, [scenario, 'run', ...argv]);
}

/** The same graph read as plain data, which builds the graph and runs the hooks alone. */
function inspect(scenario: string) {
  return invoke(fixture, [scenario, 'inspect']);
}

/** The lines one build wrote, which are the facts its hooks read. */
function lines(stdout: string): unknown[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line: string): unknown => JSON.parse(line));
}

test('a hook declares an option the action reads and the request carries', () => {
  const result = run('option', ['count', '--format', 'json']);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe('request:{"format":"json"}\ntext:{"format":"json"}\nresolved:0\n');
});

test('the root arrives through the same surface, where option() declares a root-local option', () => {
  const result = run('root', ['--quiet']);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe('{"name":null,"path":[]}\nroot:{"quiet":true}\nresolved:0\n');
});

test('a hook reads the result and the action of every Command it receives', () => {
  const seen = lines(run('facts').stdout);
  expect(seen[0]).toMatchObject({ hasAction: true, name: null, result: null });
  expect(seen[1]).toMatchObject({
    hasAction: true,
    name: 'count',
    result: { default: 'json', kind: 'value', views: ['json', 'text'] },
  });
  expect(seen[3]).toMatchObject({ hasAction: false, name: 'cache', result: null });
});

test('a hook reads the arguments and the local options each Command declares', () => {
  const seen = lines(run('facts').stdout);
  expect(seen[2]).toMatchObject({ arguments: ['path'], name: 'get', options: ['raw'] });
});

/** The path each recorded fact reported, read without claiming a shape for the parsed line. */
function pathsOf(stdout: string): unknown[] {
  return lines(stdout).map((fact) =>
    typeof fact === 'object' && fact !== null && 'path' in fact ? fact.path : undefined,
  );
}

test('the hooks walk the root first and then each child depth first', () => {
  expect(pathsOf(run('facts').stdout)).toEqual([
    [],
    ['count'],
    ['get'],
    ['cache'],
    ['cache', 'clear'],
  ]);
});

test('a views() call reshapes the result the same hook then reads', () => {
  const result = run('views', ['count']);
  expect(result.stdout).toBe(
    [
      '{"after":{"default":"json","kind":"value","views":["text","json"]},"before":{"default":"text","kind":"value","views":["text"]}}',
      'json:{}',
      'resolved:0',
      '',
    ].join('\n'),
  );
});

test("two plugins' hooks run in installation order and the later replaces a view by name", () => {
  const result = run('compose', ['count']);
  expect(result.stdout).toBe(
    '{"identity":"@loomcli/plugins/format","views":["text","json"]}\nsecond:{}\nresolved:0\n',
  );
});

test("inspect() runs the hooks and publishes a hook's option as the Command's own", () => {
  const result = inspect('option');
  expect(result.stderr).toBe('');
  expect(lines(result.stdout)[0]).toEqual({
    options: [{ name: 'format', scope: 'application' }],
    result: { default: 'text', kind: 'value', views: ['text'] },
  });
});

test('inspect() publishes the views a hook reshaped', () => {
  expect(lines(inspect('views').stdout).at(-1)).toEqual({
    options: [],
    result: { default: 'json', kind: 'value', views: ['text', 'json'] },
  });
});
