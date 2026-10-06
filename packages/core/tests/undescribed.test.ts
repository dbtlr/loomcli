import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/undescribed.mjs', import.meta.url);

function run(scenario: string, build: 'development' | 'distributed', argv: string[] = []) {
  return invoke(fixture, [scenario, build, ...argv]);
}

/** The findings, one per gap, in graph order, each noted `no description`. */
const findings = [
  '    // store',
  "    new Application('store')",
  "      .globalOption('verbose', { type: 'boolean' })",
  '                    ^^^^^^^^^ no description',
  '',
  "    plugin('@acme/doctor', { options: { trace: { type: 'boolean' } } })",
  '                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^ no description',
  '',
  "    new Application('store', { … })",
  '                    ^^^^^^^ no description',
  '',
  '    // store doctor',
  "    new Command('doctor')",
  "      .argument('target', {})",
  '                ^^^^^^^^ no description',
  '',
  '    // store get',
  "    new Command('get')",
  "      .option('raw', { deprecated: 'Use --plain instead.', type: 'boolean' })",
  '              ^^^^^ no description',
  '',
  '    // store get',
  "    new Command('get')",
  "      .option('tag', { type: 'string' })",
  '              ^^^^^ no description, declared by plugin "@acme/tag"',
  '',
  '    // store',
  "    new Application('store')",
  "      .command(new Command('purge'))",
  '               ^^^^^^^^^^^^^^^^^^^^ no description',
];

test('a development build fails a run with one diagnostic that lists every gap in graph order', () => {
  const { status, stderr, stdout } = run('run', 'development', ['get', 'name']);
  expect(status).toBe(1);
  expect(stdout).toBe('resolved:1 judged:0\n');
  const lines = stderr.split('\n');
  expect(lines.slice(0, 4)).toEqual([
    '-- MISSING DESCRIPTION ------------------------------- @loomcli/core/undescribed',
    '',
    '7 declarations have no description.',
    '',
  ]);
  expect(stderr).toContain(`\n\n${findings.join('\n')}\n\n`);
  expect(stderr).toMatch(/Agents, MCP tools, help, and the manifest/u);
  expect(stderr.endsWith('\n\nGive each one a description of one line.\n')).toBe(true);
});

test("a plugin's Command marks its commands entry, and a nested Command marks its attach under the whole path", () => {
  const { status, stderr } = run('nested', 'development');
  expect(status).toBe(1);
  expect(stderr).toContain(
    [
      '',
      '2 declarations have no description.',
      '',
      "    plugin('@acme/probe', { commands: [new Command('probe')] })",
      '                                       ^^^^^^^^^^^^^^^^^^^^ no description',
      '',
      '    // store config',
      "    new Command('config')",
      "      .command(new Command('set'))",
      '               ^^^^^^^^^^^^^^^^^^ no description',
      '',
      '',
    ].join('\n'),
  );
});

test('one gap reads in the singular', () => {
  const { status, stderr } = run('single', 'development');
  expect(status).toBe(1);
  expect(stderr).toContain(
    [
      '',
      '1 declaration has no description.',
      '',
      "    new Application('store', { … })",
      '                    ^^^^^^^ no description',
      '',
      '',
    ].join('\n'),
  );
});

test.each([
  ['--help', ['--help']],
  ['a completion request', ['completion', '__complete', '--', 'g']],
])('a development build fails the run under %s', (_label, argv) => {
  const { status, stderr, stdout } = run('run', 'development', argv);
  expect(status).toBe(1);
  expect(stdout).toBe('resolved:1 judged:0\n');
  expect(stderr).toContain('7 declarations have no description.');
});

test('a distributed build runs the same application', () => {
  expect(run('run', 'distributed', ['get', 'name'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'name\nresolved:0 judged:1\n',
  });
});

test('a development build whose graph describes every member runs, the installed plugins included', () => {
  expect(run('described', 'development', ['get', 'name'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'name\nresolved:0\n',
  });
});

test('app.invoke fails, inspect() returns the graph, and no onGraphBuilt hook runs for the failed call', () => {
  const { status, stdout } = run('doors', 'development');
  expect(status).toBe(0);
  expect(JSON.parse(stdout)).toEqual({
    exitCode: 1,
    failure: 'DeclarationError',
    inspected: 'store',
    judged: 0,
    rule: '@loomcli/core/undescribed',
    status: 'failed',
  });
});
