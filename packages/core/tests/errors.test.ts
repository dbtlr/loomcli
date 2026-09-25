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

test.each([
  [
    'duplicate',
    'Argument "files" is declared more than once on the root Command. Remove or rename the duplicate.',
  ],
  [
    'competing',
    'Argument "files" is variadic and precedes argument "extras" on the root Command. Declare the variadic argument last.',
  ],
  ['multiple-actions', 'The root Command has multiple actions. Register one action.'],
] satisfies [string, string][])(
  'the %s declaration throws from the call that makes it',
  (scenario, message) => {
    expect(invoke(new URL('fixtures/errors.mjs', import.meta.url), [scenario])).toEqual({
      status: 0,
      stderr: '',
      stdout: `thrown:1: ${message}\n`,
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

/** The constructor checks the options slot, and a valid one reaches both build entry points. */
function withOptions(scenario: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/application-options.mjs', import.meta.url), [scenario, mode]);
}

test.each(['application-value', 'empty-application'])(
  'an Application value (%s) used as an options object is thrown by the constructor',
  (scenario) => {
    expect(withOptions(scenario, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout:
        'thrown:1: The Application options must be an object. Supply an Application options object.\n',
    });
  },
);

test.each(['string-options', 'array-options'])(
  'options that are not an object (%s) are thrown by the constructor',
  (scenario) => {
    expect(withOptions(scenario, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout:
        'thrown:1: The Application options must be an object. Supply an Application options object.\n',
    });
  },
);

test('an options object with core facts constructs, inspects, and runs the Application', () => {
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

/** A Command's constructor checks its own options slot under the same rules. */
function withCommandOptions(scenario: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/command-options.mjs', import.meta.url), [scenario, mode]);
}

test.each(['application-value', 'empty-application'])(
  'an Application value (%s) used as an options object on a Command is thrown by the constructor',
  (scenario) => {
    expect(withCommandOptions(scenario, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout:
        'thrown:1: Command "get" options must be an object. Supply a Command options object.\n',
    });
  },
);

test.each(['string-options', 'array-options'])(
  'Command options that are not an object (%s) are thrown by the constructor',
  (scenario) => {
    expect(withCommandOptions(scenario, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout:
        'thrown:1: Command "get" options must be an object. Supply a Command options object.\n',
    });
  },
);

test('an options object with core facts constructs, inspects, and runs the Command', () => {
  expect(withCommandOptions('options-object', 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
  expect(withCommandOptions('options-object', 'run')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ndispatched\nresolved:0\n',
  });
});

// An object with no prototype carries no state of its own, so it is an options object.
// The rule holds on the Command's slot and on the Application's alike.
test.each(['null-prototype', 'null-prototype-application'])(
  'an options object with no prototype (%s) inspects and runs',
  (scenario) => {
    expect(withCommandOptions(scenario, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: 'assembled\ninspected\n',
    });
    expect(withCommandOptions(scenario, 'run')).toEqual({
      status: 0,
      stderr: '',
      stdout: 'assembled\ndispatched\nresolved:0\n',
    });
  },
);
