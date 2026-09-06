import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test.each([
  [
    'required',
    [],
    2,
    'Invalid input: Argument "files" requires at least one value. Supply a value for "files".\n',
  ],
  [
    'required',
    ['--'],
    2,
    'Invalid input: Argument "files" requires at least one value. Supply a value for "files".\n',
  ],
  [
    'required',
    ['-file'],
    2,
    'Invalid input: Unknown option "-f". Supply a declared option; prefix a hyphenated path with "./".\n',
  ],
  [
    'duplicate',
    ['x'],
    1,
    'Invalid declaration: Argument "files" is declared more than once on the root Command. Remove or rename the duplicate.\n',
  ],
  [
    'competing',
    ['x'],
    1,
    'Invalid declaration: Argument "files" is variadic and precedes argument "extras" on the root Command. Declare the variadic argument last.\n',
  ],
  [
    'multiple-actions',
    [],
    1,
    'Invalid declaration: The root Command has multiple actions. Register one action.\n',
  ],
  [
    'actionless',
    [],
    1,
    'Invalid declaration: The root Command has no action. Register an action.\n',
  ],
  [
    'extra',
    ['x'],
    2,
    'Invalid input: The root Command accepts no arguments. Remove the supplied values.\n',
  ],
  ['fatal', [], 1, 'Expected failure.\n'],
  ['throw-fatal', [], 1, 'Expected failure.\n'],
  ['unexpected', [], 1, 'Internal error: Unexpected failure.\n'],
  ['unknown-throw', [], 1, 'Internal error: An unknown error occurred.\n'],
] satisfies [string, string[], number, string][])(
  '%s completes without rejecting or dispatching after a failure',
  (scenario, args, status, stderr) => {
    expect(invoke(new URL('fixtures/errors.mjs', import.meta.url), [scenario, ...args])).toEqual({
      status,
      stderr,
      stdout: `assembled\nresolved:${status}\n`,
    });
  },
);

test('catching FatalError prevents failure and eager printing', () => {
  expect(invoke(new URL('fixtures/errors.mjs', import.meta.url), ['caught-fatal'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ndispatched\nresolved:0\n',
  });
});
