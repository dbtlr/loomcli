import {
  Application,
  Command,
  EX_DATAERR,
  EX_SOFTWARE,
  EX_UNAVAILABLE,
  FatalError,
  plugin,
} from '@loomcli/core';
import { manifest } from '@loomcli/plugins/manifest';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

const dispatch = ({ out }) => out.print('dispatched');

// A test that reads a declaration fault's own sentence runs the fixture as a development build.
const packet =
  process.env.FIXTURE_BUILD === undefined ? {} : { packet: { build: process.env.FIXTURE_BUILD } };

// The manifest reads each class's static alone, so no fixture constructs one.

/** A data failure, 65. */
class BadDataError extends FatalError {
  static exitCode = EX_DATAERR;

  constructor() {
    super('The data is bad.');
    this.name = 'BadDataError';
  }
}

/** An unavailable service, 69. */
class UnavailableError extends FatalError {
  static exitCode = EX_UNAVAILABLE;

  constructor() {
    super('The service is down.');
    this.name = 'UnavailableError';
  }
}

/** A software fault, 70, raised by a hidden Command alone. */
class SoftwareError extends FatalError {
  static exitCode = EX_SOFTWARE;

  constructor() {
    super('A bug.');
    this.name = 'SoftwareError';
  }
}

/** A class that declares no code, so it inherits 1. */
class PlainError extends FatalError {
  constructor() {
    super('Something plain failed.');
    this.name = 'PlainError';
  }
}

/** A class that declares 2, whose row core's own row already explains. */
class RefusedError extends FatalError {
  static exitCode = 2;

  constructor() {
    super('The request was refused.');
    this.name = 'RefusedError';
  }
}

const badData = { failure: BadDataError, meaning: 'The data is bad.', name: 'bad-data' };

/** A plugin that supplies an entry identical to the author's, and one of its own, on `read`. */
const supplier = plugin('@fixture/supplier', {
  onCommandAttach: (command) =>
    command.name === 'read'
      ? command.extend(
          manifestCommand({
            failures: [
              badData,
              { failure: UnavailableError, meaning: 'The service is down.', name: 'unavailable' },
            ],
          }),
        )
      : command,
});

/**
 * Every declared-failure rule, spread over a small application. `inner` sits under `group` ahead
 * of `write`, so its name is met before `write`'s only in a depth-first walk.
 */
function application() {
  const read = new Command('read', {
    extensions: [manifestCommand({ failures: [badData] })],
  }).action(dispatch);
  const inner = new Command('inner', {
    extensions: [
      manifestCommand({
        failures: [{ failure: BadDataError, meaning: 'The inner data is bad.', name: 'inner-bad' }],
      }),
    ],
  }).action(dispatch);
  const group = new Command('group').command(inner);
  const write = new Command('write', {
    extensions: [
      manifestCommand({
        failures: [
          { failure: BadDataError, meaning: 'The written data is bad.', name: 'write-bad' },
          badData,
        ],
      }),
    ],
  }).action(dispatch);
  const plain = new Command('plain', {
    extensions: [
      manifestCommand({
        failures: [
          { failure: PlainError, meaning: 'Something plain failed.', name: 'plain-failure' },
          { failure: RefusedError, meaning: 'The request was refused.', name: 'refused' },
        ],
      }),
    ],
  }).action(dispatch);
  const secret = new Command('secret', {
    extensions: [
      manifestCommand({
        failures: [{ failure: SoftwareError, meaning: 'A bug.', name: 'software-fault' }],
      }),
    ],
    hidden: true,
  }).action(dispatch);
  const none = new Command('none').action(dispatch);
  return new Application('app', { plugins: [manifest(), supplier] })
    .command(read)
    .command(group)
    .command(write)
    .command(plain)
    .command(secret)
    .command(none)
    .action(dispatch);
}

/** An application where `invalid-json` is declared on two Commands with two different entries. */
function conflicting(second) {
  const get = new Command('get', {
    extensions: [
      manifestCommand({
        failures: [
          {
            failure: BadDataError,
            meaning: 'The document is not valid JSON.',
            name: 'invalid-json',
          },
        ],
      }),
    ],
  }).action(dispatch);
  const select = new Command('select', {
    extensions: [manifestCommand({ failures: [{ ...second, name: 'invalid-json' }] })],
  }).action(dispatch);
  return new Application('app', { ...packet, plugins: [manifest()] })
    .command(get)
    .command(select)
    .action(dispatch);
}

/**
 * An application where `get` declares `invalid-json` twice with two different entries, once in the
 * author's value and once in a plugin's value supplied at attach.
 */
function conflictingOnOneCommand(second) {
  const invalidJson = {
    failure: BadDataError,
    meaning: 'The document is not valid JSON.',
    name: 'invalid-json',
  };
  const again = plugin('@fixture/again', {
    onCommandAttach: (command) =>
      command.name === 'get'
        ? command.extend(manifestCommand({ failures: [{ ...second, name: 'invalid-json' }] }))
        : command,
  });
  const get = new Command('get', {
    extensions: [manifestCommand({ failures: [invalidJson] })],
  }).action(dispatch);
  return new Application('app', { ...packet, plugins: [manifest(), again] })
    .command(get)
    .action(dispatch);
}

const scenarios = {
  app: application,
  'code-conflict': () =>
    conflicting({ failure: PlainError, meaning: 'The document is not valid JSON.' }),
  'meaning-conflict': () =>
    conflicting({ failure: BadDataError, meaning: 'The document cannot be parsed.' }),
  'meaning-conflict-controls': () =>
    conflicting({ failure: BadDataError, meaning: 'Bad \u202Eevil\u009B" on "x' }),
  'same-command-code-conflict': () =>
    conflictingOnOneCommand({ failure: PlainError, meaning: 'The document is not valid JSON.' }),
  'same-command-meaning-conflict': () =>
    conflictingOnOneCommand({ failure: BadDataError, meaning: 'The document cannot be parsed.' }),
};

const [scenario, ...argv] = process.argv.slice(2);
await scenarios[scenario]().run({ host: { argv } });
