import { Application, Command, extension, InputError, plugin } from '@loomcli/core';
import { z } from 'zod';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, env: fixtureEnv, stdout: writeStdout } = fixture;
  try {
    // Each run prints the `ownOptions` record the fixture plugin's middleware reads, then its exit code,
    // Then how many times the word validator was called with each value.
    // FIXTURE_SOURCE=fails installs a configuration source that cannot read its settings.
    const words = fixtureWords;

    /** How many times the word validator was called with each value, its one side effect. */
    const calls = {};

    /** A validator that accepts lowercase words, rejects `bad`, and throws for `throw`. */
    const word = {
      '~standard': {
        validate: (value) => {
          calls[value] = (calls[value] ?? 0) + 1;
          if (value === 'throw') {
            throw new Error('The validator broke.');
          }
          return /^[a-z]+$/u.test(value) && value !== 'bad'
            ? { value: value.toUpperCase() }
            : { issues: [{ message: 'Use a lowercase word.' }] };
        },
        vendor: 'fixture',
        version: 1,
      },
    };

    /** A validator that accepts decimal digits alone, and throws for `throw`. */
    const digits = {
      '~standard': {
        validate: (value) => {
          if (value === 'throw') {
            throw new Error('The depth validator broke.');
          }
          return /^\d+$/u.test(value)
            ? { value: Number(value) }
            : { issues: [{ message: 'Use digits.' }] };
        },
        vendor: 'fixture',
        version: 1,
      },
    };

    /**
     * A plugin with a global option of its own and a local option its hook declares on every Command
     * with an action. Its middleware reports the record it reads before it continues.
     */
    const owning = plugin('@fixture/owning', {
      middleware: {
        activate: 'always',
        load: async () => ({
          default: async ({ next, ownOptions }) => {
            const entries = Object.entries(ownOptions).map(([name, value]) => [
              name,
              value === undefined ? '<undefined>' : value,
            ]);
            writeStdout(
              `${JSON.stringify({ frozen: Object.isFrozen(ownOptions), own: Object.fromEntries(entries) })}\n`,
            );
            await next();
          },
        }),
      },
      onCommandAttach: (command) =>
        command.hasAction ? command.option('local', { type: 'string', validate: word }) : command,
      options: { mine: { type: 'string', validate: word }, spare: { type: 'string' } },
    });

    /** Another plugin's option, which never appears in the fixture plugin's record. */
    const other = plugin('@fixture/other', { options: { theirs: { type: 'string' } } });

    /** The binding the failing source answers for, carried by the application's `fed` option. */
    const settingsKey = extension('@fixture/settings/key', {
      schema: z.string(),
      target: 'option',
    });

    /** A configuration source that cannot read its settings, as a missing file named on argv is not. */
    const settings = plugin('@fixture/settings', {
      extensions: [settingsKey],
      source: {
        binding: settingsKey,
        load: async () => ({
          default: () => {
            throw new InputError('The settings file cannot be read.', []);
          },
        }),
      },
    });

    const plugins =
      fixtureEnv.FIXTURE_SOURCE === 'fails' ? [owning, other, settings] : [owning, other];

    const app = new Application('owns', { plugins })
      .globalOption('app', { type: 'string' })
      .globalOption('fed', {
        extensions: fixtureEnv.FIXTURE_SOURCE === 'fails' ? [settingsKey('fed')] : [],
        type: 'string',
      })
      .command(
        new Command('get')
          .option('depth', { type: 'string', validate: digits })
          .action(() => undefined),
      );

    const code = await app.run({
      process: createProcess({ argv: words, release: { build: 'distributed' } }),
    });
    writeStdout(`exit:${String(code)}\n${JSON.stringify(calls)}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
