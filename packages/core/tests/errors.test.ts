import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { undeclaredArgument, unknownOptionName } from '../src/errors.js';

test.each([
  [
    'required',
    [],
    2,
    'fixture: Argument "files" requires at least one value. Supply a value for "files".\n',
  ],
  [
    'required',
    ['--'],
    2,
    'fixture: Argument "files" requires at least one value. Supply a value for "files".\n',
  ],
  [
    'required',
    ['-file'],
    2,
    'fixture: Unknown option "-f". Supply a declared option; prefix a hyphenated path with "./".\n',
  ],
  ['actionless', [], 1, 'fixture: Something went wrong.\n'],
  [
    'extra',
    ['x'],
    2,
    'fixture: The root Command accepts no arguments. Remove the supplied values.\n',
  ],
  ['fatal', [], 1, 'Expected failure.\n'],
  ['throw-fatal', [], 1, 'Expected failure.\n'],
  ['unexpected', [], 1, 'fixture: Something went wrong.\n'],
  ['unknown-throw', [], 1, 'fixture: Something went wrong.\n'],
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

/** A valid options slot reaches both build entry points. */
function withOptions(scenario: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/application-options.mjs', import.meta.url), [scenario, mode]);
}

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

/** A Command's valid options slot reaches both build entry points too. */
function withCommandOptions(scenario: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/command-options.mjs', import.meta.url), [scenario, mode]);
}

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

test.each([
  ['unknownOptionName', unknownOptionName('lound')],
  ['undeclaredArgument', undeclaredArgument(['get'], 1, 'extra')],
])("%s's by-name error opens its stack with its own name and message", (_builder, error) => {
  expect(error.stack?.startsWith(`${error.name}: ${error.message}\n`)).toBe(true);
});
