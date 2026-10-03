import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/run.mjs', import.meta.url);

/** One invocation of the fixture application under the version one scenario declares. */
function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
}

test('--version prints the application name and its declared version', () => {
  expect(run('version', ['--version'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0\n',
  });
});

test('-V prints the same line as its long spelling', () => {
  expect(run('version', ['-V'])).toEqual({ status: 0, stderr: '', stdout: 'app v1.2.0\n' });
});

test('a declared version that already starts with a lowercase v carries that v once', () => {
  expect(run('version-prefixed', ['--version'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v0.2.0\n',
  });
});

test('a declared version that starts with an uppercase V is printed after the added v', () => {
  expect(run('version-upper', ['--version'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'app vV0.2.0\n',
  });
});

test('an Application that declares no version prints the unversioned sentinel', () => {
  expect(run('version-omitted', ['--version'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v0.0.0\n',
  });
});

test('the routed Command does not change the line, because the version is the Application fact', () => {
  expect(run('version', ['get', '--version'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'app v1.2.0\n',
  });
});
