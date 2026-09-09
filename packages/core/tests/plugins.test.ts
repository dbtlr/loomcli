import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** Every plugin build rule answers in `inspect()` and in `run()` alike, and `run()` returns 1. */
function build(scenario: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/plugins/build.mjs', import.meta.url), [scenario, mode]);
}

test.each([
  [
    'not-a-plugin',
    'The Application holds a value that is not a plugin. Supply the value returned by plugin(identity, definition).',
  ],
  [
    'installed-twice',
    'The Application installs plugin "@loomcli/help" twice. Install each plugin once.',
  ],
  [
    'empty-identity',
    'A plugin declares an empty identity. Supply a nonempty string, such as the package name.',
  ],
] satisfies [string, string][])(
  'inspect() and run() reject the %s declaration alike',
  (scenario, message) => {
    expect(build(scenario, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `declaration:1: ${message}\n`,
    });
    expect(build(scenario, 'run')).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${message}\n`,
      stdout: 'resolved:1\n',
    });
  },
);

test('a plugin that declares nothing installs and costs the invocation nothing', () => {
  expect(build('installed', 'inspect')).toEqual({ status: 0, stderr: '', stdout: 'inspected\n' });
  expect(build('installed', 'run')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'dispatched\nresolved:0\n',
  });
});
