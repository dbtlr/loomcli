import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/run.mjs', import.meta.url);

function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
}

test('an override of the help page changes the page while the plugin stays installed', () => {
  expect(run('branded-page', ['--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'app:root\n',
  });
});

test('an override of the help page receives the routed Command beside the graph', () => {
  expect(run('branded-page', ['get', '--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'app:get\n',
  });
});

test('an override of the version line changes the line while the plugin stays installed', () => {
  expect(run('branded-line', ['--version'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '<app@1.2.0>\n',
  });
});

test('a broken help page override reports one diagnostic and returns 1', () => {
  expect(run('broken-page', ['--help'])).toEqual({
    status: 1,
    stderr: 'Internal error: Cannot render the page.\n',
    stdout: '',
  });
});

test('a graph fact that carries a marker character prints literally on the help page', () => {
  const result = run('marked', ['--help']);
  expect(result.status).toBe(0);
  expect(result.stdout.split('\n')[0]).toBe('app · A fixture application.');
});

test('a declared version that carries a marker character prints literally on the line', () => {
  expect(run('marked', ['--version'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0\n',
  });
});
