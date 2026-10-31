import { expect, test } from 'vite-plus/test';

import { run as fixtureRun } from './fixtures/run-app.js';

async function run(scenario: string, argv: string[]) {
  return await fixtureRun([scenario, ...argv]);
}

test('an override of the help page changes the page while the plugin stays installed', async () => {
  await expect(run('branded-page', ['--help'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app:root\n',
  });
});

test('an override of the help page receives the routed Command beside the graph', async () => {
  await expect(run('branded-page', ['get', '--help'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app:get\n',
  });
});

test('an override of the version line changes the line while the plugin stays installed', async () => {
  await expect(run('branded-line', ['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '<app@1.2.0>\n',
  });
});

test('a version line override reads the postfix the application gave version()', async () => {
  await expect(run('branded-postfix', ['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '<app@1.2.0 schema v1>\n',
  });
});

test('a broken help page override reports one diagnostic and returns 1', async () => {
  await expect(run('broken-page', ['--help'])).resolves.toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: '',
  });
});

test('a graph fact that carries a marker character prints literally on the help page', async () => {
  const result = await run('marked', ['--help']);
  expect(result.status).toBe(0);
  expect(result.stdout.split('\n')[0]).toBe('app · A fixture application.');
});

test('a declared version that carries a marker character prints literally on the line', async () => {
  await expect(run('marked', ['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0\n',
  });
});
