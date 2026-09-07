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

/** Both build entry points read the options slot, so the fixture is invoked through each. */
function withOptions(scenario: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/application-options.mjs', import.meta.url), [scenario, mode]);
}

test.each(['positional-globals', 'empty-globals'])(
  'the retired positional globals form %s is a declaration error at build, not construction',
  (scenario) => {
    expect(withOptions(scenario, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout:
        'assembled\ndeclaration:1: The Application takes an options object. Supply { globals } instead of a positional GlobalOptions value.\n',
    });
    expect(withOptions(scenario, 'run')).toEqual({
      status: 1,
      stderr:
        'Invalid declaration: The Application takes an options object. Supply { globals } instead of a positional GlobalOptions value.\n',
      stdout: 'assembled\nresolved:1\n',
    });
  },
);

test.each(['string-options', 'array-options'])(
  'options that are not an object (%s) are a declaration error at build, not construction',
  (scenario) => {
    expect(withOptions(scenario, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout:
        'assembled\ndeclaration:1: The Application options must be an object. Supply { globals, failures }.\n',
    });
    expect(withOptions(scenario, 'run')).toEqual({
      status: 1,
      stderr:
        'Invalid declaration: The Application options must be an object. Supply { globals, failures }.\n',
      stdout: 'assembled\nresolved:1\n',
    });
  },
);

test('an options object with globals constructs, inspects, and runs the Application', () => {
  expect(withOptions('options-object', 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
  expect(withOptions('options-object', 'run')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ndispatched\nresolved:0\n',
  });
});
