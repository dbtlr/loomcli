import { expect, test } from 'vite-plus/test';

import { undeclaredArgument, unknownOptionName } from '../src/errors.js';
import { invoke as invokeFixture } from './run-fixture.ts';

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
  async (scenario, args, status, stderr) => {
    await expect(
      invokeFixture(new URL('fixtures/errors.mjs', import.meta.url), [scenario, ...args]),
    ).resolves.toEqual({
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
] satisfies [string, string][])(
  'the %s declaration throws from the call that makes it',
  async (scenario, message) => {
    await expect(
      invokeFixture(new URL('fixtures/errors.mjs', import.meta.url), [scenario]),
    ).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: `thrown:1: ${message}\n`,
    });
  },
);

test('catching FatalError prevents failure and eager printing', async () => {
  await expect(
    invokeFixture(new URL('fixtures/errors.mjs', import.meta.url), ['caught-fatal']),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ndispatched\nresolved:0\n',
  });
});

/** A valid options slot reaches both build entry points. */
async function withOptions(scenario: string, mode: 'inspect' | 'run') {
  return await invokeFixture(new URL('fixtures/application-options.mjs', import.meta.url), [
    scenario,
    mode,
  ]);
}

test('an options object with core facts constructs, inspects, and runs the Application', async () => {
  await expect(withOptions('options-object', 'inspect')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
  await expect(withOptions('options-object', 'run')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ndispatched\nresolved:0\n',
  });
});

/** A Command's valid options slot reaches both build entry points too. */
async function withCommandOptions(scenario: string, mode: 'inspect' | 'run') {
  return await invokeFixture(new URL('fixtures/command-options.mjs', import.meta.url), [
    scenario,
    mode,
  ]);
}

test('an options object with core facts constructs, inspects, and runs the Command', async () => {
  await expect(withCommandOptions('options-object', 'inspect')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
  await expect(withCommandOptions('options-object', 'run')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ndispatched\nresolved:0\n',
  });
});

// An object with no prototype carries no state of its own, so it is an options object.
// The rule holds on the Command's slot and on the Application's alike.
test.each(['null-prototype', 'null-prototype-application'])(
  'an options object with no prototype (%s) inspects and runs',
  async (scenario) => {
    await expect(withCommandOptions(scenario, 'inspect')).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'assembled\ninspected\n',
    });
    await expect(withCommandOptions(scenario, 'run')).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'assembled\ndispatched\nresolved:0\n',
    });
  },
);

/*
 * Each error is built inside its test, where the code that builds it stays reachable: Bun 1.4.0
 * renders a bare "Error" stack once a collection frees that code before the first read.
 */
test.each([
  ['unknownOptionName', () => unknownOptionName('lound')],
  ['undeclaredArgument', () => undeclaredArgument(['get'], 1, 'extra')],
])("%s's by-name error opens its stack with its own name and message", (_builder, build) => {
  const error = build();
  expect(error.stack?.startsWith(`${error.name}: ${error.message}\n`)).toBe(true);
});
