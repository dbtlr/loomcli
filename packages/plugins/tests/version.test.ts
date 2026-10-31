import { expect, test } from 'vite-plus/test';

import { run as fixtureRun } from './fixtures/run-app.js';
import { run as settingsRun } from './fixtures/version-settings.mjs';

/** One invocation of the fixture application under the version one scenario declares. */
async function run(scenario: string, argv: string[]) {
  return await fixtureRun([scenario, ...argv]);
}

test('--version prints the application name and its declared version', async () => {
  await expect(run('version', ['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0\n',
  });
});

test('-V prints the same line as its long spelling', async () => {
  await expect(run('version', ['-V'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0\n',
  });
});

test('a declared version that already starts with a lowercase v carries that v once', async () => {
  await expect(run('version-prefixed', ['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v0.2.0\n',
  });
});

test('a declared version that starts with an uppercase V is printed after the added v', async () => {
  await expect(run('version-upper', ['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app vV0.2.0\n',
  });
});

test('an Application that declares no version prints the unversioned sentinel', async () => {
  await expect(run('version-omitted', ['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v0.0.0\n',
  });
});

test('the routed Command does not change the line, because the version is the Application fact', async () => {
  await expect(run('version', ['get', '--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0\n',
  });
});

test('a postfix follows the standard line after one space', async () => {
  await expect(run('version-postfix', ['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0 (Report schema v1)\n',
  });
});

/** What one `version()` call returns or throws under `settings`. */
async function settingsOutcome(settings: unknown): Promise<unknown> {
  const result = await settingsRun([JSON.stringify(settings)]);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return JSON.parse(result.stdout);
}

test('version() with empty settings prints the standard line', async () => {
  await expect(settingsOutcome({})).resolves.toBe('returned');
  await expect(run('version-empty', ['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0\n',
  });
});

test('version() judges no short setting, because its short spelling is fixed', async () => {
  await expect(settingsOutcome({ short: 'ab' })).resolves.toBe('returned');
});
