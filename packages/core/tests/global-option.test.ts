import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/global-option.mjs', import.meta.url);

test('globalOption derives an Application without changing its receiver', () => {
  expect(invoke(fixture, ['original'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"quiet":false}\n',
  });
  expect(invoke(fixture, ['derived'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"quiet":false,"limit":"10"}\n',
  });
});

test.each(['after-action', 'after-command'])(
  'globalOption rejects %s before dispatch',
  (scenario) => {
    const reason =
      'The Application declares global option "late" after command() or action(). Declare global options before attaching Commands or registering an action.';
    expect(invoke(fixture, [scenario])).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${reason}\n`,
      stdout: '',
    });
    expect(invoke(fixture, [scenario, 'inspect'])).toEqual({
      status: 0,
      stderr: '',
      stdout: `${reason}\n`,
    });
  },
);

test('a global declared after a colliding root-local option fails graph build', () => {
  expect(invoke(fixture, ['local-first'])).toEqual({
    status: 1,
    stderr:
      'Invalid declaration: Option "quiet" is declared as a global option and as a local option on the root Command. Rename the local option.\n',
    stdout: '',
  });
});
