import {
  Application,
  Command,
  EX_DATAERR,
  EX_SOFTWARE,
  EX_UNAVAILABLE,
  FatalError,
  plugin,
} from '@loomcli/core';
import type { ActionContext } from '@loomcli/core';
import { manifest } from '@loomcli/plugins/manifest';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { z } from 'zod';

import { runOnMock } from './in-process.ts';

const dispatch = ({ out }: Pick<ActionContext<unknown>, 'out'>) => out.print('dispatched');

type FailureDeclaration = NonNullable<Parameters<typeof manifestCommand>[0]['failures']>[number];

async function run(args: string[] = [], env: Record<string, string | undefined> = {}) {
  // The manifest reads each class's statics alone, so no fixture constructs one.

  /** A data failure, 65. */
  class BadDataError extends FatalError {
    static code = 'bad-data';

    static override readonly exitCode = EX_DATAERR;

    constructor() {
      super('The data is bad.');
      this.name = 'BadDataError';
    }
  }

  /** A data failure inside the group, which inherits 65 and declares its own code. */
  class InnerBadError extends BadDataError {
    static code = 'inner-bad';

    constructor() {
      super();
      this.name = 'InnerBadError';
    }
  }

  /** A data failure `write` raises, which inherits 65 and declares its own code. */
  class WriteBadError extends BadDataError {
    static code = 'write-bad';

    constructor() {
      super();
      this.name = 'WriteBadError';
    }
  }

  /** An unavailable service, 69. */
  class UnavailableError extends FatalError {
    static code = 'unavailable';

    static override readonly exitCode = EX_UNAVAILABLE;

    constructor() {
      super('The service is down.');
      this.name = 'UnavailableError';
    }
  }

  /** A software fault, 70, raised by a hidden Command alone. */
  class SoftwareError extends FatalError {
    static code = 'software-fault';

    static override readonly exitCode = EX_SOFTWARE;

    constructor() {
      super('A bug.');
      this.name = 'SoftwareError';
    }
  }

  /** A class that declares neither code, so it inherits 1 and `fatal`. */
  class PlainError extends FatalError {
    constructor() {
      super('Something plain failed.');
      this.name = 'PlainError';
    }
  }

  /** A class that declares 2, whose row core's own row already explains. */
  class RefusedError extends FatalError {
    static code = 'refused';

    static override readonly exitCode = 2;

    constructor() {
      super('The request was refused.');
      this.name = 'RefusedError';
    }
  }

  /** A document failure, 65. */
  class InvalidJsonError extends FatalError {
    static code = 'invalid-json';

    static override readonly exitCode = EX_DATAERR;

    constructor() {
      super('The document is not valid JSON.');
      this.name = 'InvalidJsonError';
    }
  }

  /** A second class under the same failure code that declares no exit code, so it exits 1. */
  class LooseJsonError extends FatalError {
    static code = 'invalid-json';

    constructor() {
      super('The document is not valid JSON.');
      this.name = 'LooseJsonError';
    }
  }

  const badData = { failure: BadDataError, meaning: 'The data is bad.' };

  /** A plugin that supplies an entry identical to the author's, and one of its own, on `read`. */
  const supplier = plugin('@fixture/supplier', {
    onCommandAttach: (command) =>
      command.name === 'read'
        ? command.extend(
            manifestCommand({
              failures: [badData, { failure: UnavailableError, meaning: 'The service is down.' }],
            }),
          )
        : command,
  });

  /**
   * Every declared-failure rule, spread over a small application. `inner` sits under `group` ahead
   * of `write`, so its code is met before `write`'s only in a depth-first walk. `plain` keeps a stale
   * hand-written `name`, which the schema drops.
   */
  function application() {
    const read = new Command('read', {
      description: 'The read command.',
      extensions: [manifestCommand({ failures: [badData] })],
    }).action(dispatch);
    const inner = new Command('inner', {
      description: 'The inner command.',
      extensions: [
        manifestCommand({
          failures: [{ failure: InnerBadError, meaning: 'The inner data is bad.' }],
        }),
      ],
    }).action(dispatch);
    const group = new Command('group', {
      description: 'The group command.',
    }).command(inner);
    const write = new Command('write', {
      description: 'The write command.',
      extensions: [
        manifestCommand({
          failures: [{ failure: WriteBadError, meaning: 'The written data is bad.' }, badData],
        }),
      ],
    }).action(dispatch);
    const stale = {
      failure: PlainError,
      meaning: 'Something plain failed.',
      name: 'plain-failure',
    };
    const plain = new Command('plain', {
      description: 'The plain command.',
      extensions: [
        manifestCommand({
          failures: [stale, { failure: RefusedError, meaning: 'The request was refused.' }],
        }),
      ],
    }).action(dispatch);
    const secret = new Command('secret', {
      description: 'The secret command.',
      extensions: [manifestCommand({ failures: [{ failure: SoftwareError, meaning: 'A bug.' }] })],
      hidden: true,
    }).action(dispatch);
    const none = new Command('none', {
      description: 'The none command.',
    }).action(dispatch);
    return new Application('app', {
      description: 'The app application.',
      plugins: [manifest(), supplier],
    })
      .command(read)
      .command(group)
      .command(write)
      .command(plain)
      .command(secret)
      .command(none)
      .action(dispatch);
  }

  /** An application where `invalid-json` is declared on two Commands with two different entries. */
  function conflicting(second: FailureDeclaration) {
    const get = new Command('get', {
      description: 'The get command.',
      extensions: [
        manifestCommand({
          failures: [{ failure: InvalidJsonError, meaning: 'The document is not valid JSON.' }],
        }),
      ],
    }).action(dispatch);
    const select = new Command('select', {
      description: 'The select command.',
      extensions: [manifestCommand({ failures: [second] })],
    }).action(dispatch);
    return new Application('app', {
      description: 'The app application.',
      plugins: [manifest()],
    })
      .command(get)
      .command(select)
      .action(dispatch);
  }

  /**
   * An application where `get` declares `invalid-json` twice with two different entries, once in the
   * author's value and once in a plugin's value supplied at attach.
   */
  function conflictingOnOneCommand(second: FailureDeclaration) {
    const invalidJson = { failure: InvalidJsonError, meaning: 'The document is not valid JSON.' };
    const again = plugin('@fixture/again', {
      onCommandAttach: (command) =>
        command.name === 'get' ? command.extend(manifestCommand({ failures: [second] })) : command,
    });
    const get = new Command('get', {
      description: 'The get command.',
      extensions: [manifestCommand({ failures: [invalidJson] })],
    }).action(dispatch);
    return new Application('app', {
      description: 'The app application.',
      plugins: [manifest(), again],
    })
      .command(get)
      .action(dispatch);
  }

  const scenarios = {
    app: application,
    'code-conflict': () =>
      conflicting({ failure: LooseJsonError, meaning: 'The document is not valid JSON.' }),
    'meaning-conflict': () =>
      conflicting({ failure: InvalidJsonError, meaning: 'The document cannot be parsed.' }),
    'meaning-conflict-controls': () =>
      conflicting({ failure: InvalidJsonError, meaning: 'Bad \u202Eevil\u009B" on "x' }),
    'same-command-code-conflict': () =>
      conflictingOnOneCommand({
        failure: LooseJsonError,
        meaning: 'The document is not valid JSON.',
      }),
    'same-command-meaning-conflict': () =>
      conflictingOnOneCommand({
        failure: InvalidJsonError,
        meaning: 'The document cannot be parsed.',
      }),
  };

  const [scenario, ...argv] = args;
  const factory = Object.entries(scenarios).find(([name]) => name === scenario)?.[1];
  if (factory === undefined) {
    throw new Error(`Unknown fixture scenario: ${scenario}`);
  }
  return await runOnMock(factory(), {
    argv,
    env,
    // A test that reads a declaration fault's own sentence runs the fixture as a development build.
    release: {
      build: z
        .enum(['source', 'development', 'distributed'])
        .parse(env.FIXTURE_BUILD ?? 'distributed'),
    },
  });
}
export { run };
