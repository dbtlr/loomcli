import { expect, test } from 'vite-plus/test';

import { invoke } from './process.js';

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
    'Invalid input: Unsupported token "--". Supply a positional value; prefix a hyphenated path with "./".\n',
  ],
  [
    'required',
    ['-file'],
    2,
    'Invalid input: Unsupported token "-file". Supply a positional value; prefix a hyphenated path with "./".\n',
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
    'Invalid declaration: Arguments "files", "extras" compete for variadic values on the root Command. Keep one variadic argument.\n',
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
    expect(invoke('tests/fixtures/errors.mjs', [scenario, ...args])).toEqual({
      status,
      stderr,
      stdout: `assembled\nresolved:${status}\n`,
    });
  },
);

test('catching FatalError prevents failure and eager printing', () => {
  expect(invoke('tests/fixtures/errors.mjs', ['caught-fatal'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ndispatched\nresolved:0\n',
  });
});

test('textstat reports a file-read failure through expected error output', () => {
  expect(invoke('examples/textstat/dist/main.js', ['missing-fixture.txt'])).toEqual({
    status: 1,
    stderr: 'Cannot read file: missing-fixture.txt\n',
    stdout: '',
  });
});
