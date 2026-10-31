import { Writable } from 'node:stream';

import { Application, Command } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const leaf = (name) => new Command(name).action(dispatch);

    // One value sits in two Applications, and two distinct values share a name under two parents.
    // Every graph here is a tree, so every build must succeed, however often it runs.
    const shared = leaf('clear');
    const first = new Application('tree-first')
      .globalOption('file', { short: 'f', type: 'string' })
      .command(new Command('cache').command(shared))
      .action(dispatch);
    const second = new Application('tree-second')
      .globalOption('file', { short: 'f', type: 'string' })
      .command(new Command('cache').command(leaf('clear')))
      .command(new Command('store').command(leaf('clear')))
      .command(new Command('extra').command(shared))
      .action(dispatch);

    const lines = [];
    const errors = [];

    const stdout = capture(lines);
    const stderr = capture(errors);

    const codes = [];
    first.inspect();
    first.inspect();
    codes.push(
      await first.run({
        process: createProcess({ argv: ['cache', 'clear'], stderr, stdout }),
      }),
    );
    codes.push(
      await first.run({
        process: createProcess({ argv: ['cache', 'clear'], stderr, stdout }),
      }),
    );
    codes.push(
      await second.run({
        process: createProcess({ argv: ['cache', 'clear'], stderr, stdout }),
      }),
    );
    codes.push(
      await second.run({
        process: createProcess({ argv: ['store', 'clear'], stderr, stdout }),
      }),
    );
    codes.push(
      await second.run({
        process: createProcess({ argv: ['extra', 'clear'], stderr, stdout }),
      }),
    );
    second.inspect();
    writeStdout(`${JSON.stringify({ codes, errors, lines })}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const dispatch = ({ out }) => out.print('dispatched');
const capture = (into) =>
  new Writable({
    write(chunk, _encoding, callback) {
      into.push(chunk.toString().trim());
      callback();
    },
  });

export { runFixture as run };
