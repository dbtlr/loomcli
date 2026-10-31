import { Application, Command, DeclarationError, plugin } from '@loomcli/core';

import { ruleText } from './rule-text.mjs';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;

  function declare(build) {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof DeclarationError)) {
        throw error;
      }
      writeStdout(`thrown:${error.exitCode}: ${ruleText(error)}\n`);
      throw fixture.stopped;
    }
  }
  try {
    const target = words[0];
    const fact = words[1];
    const value = words[2];
    const mode = words[3];

    /** The values a fact takes: a one-line summary, a migration message, and the Booleans. */
    const values = {
      false: false,
      migration: 'Use get instead.',
      summary: 'Reads one document.',
      true: true,
    };

    /** One target of a core fact per entry, each declared the way an author declares it. */
    const targets = {
      application: (facts) => new Application('facts', facts).action(dispatch),
      argument: (facts) =>
        new Application('facts').argument('files', { ...facts, variadic: true }).action(dispatch),
      'boolean-option': (facts) => {
        const get = new Command('get')
          .option('quiet', { ...facts, type: 'boolean' })
          .action(dispatch);
        return new Application('facts').command(get).action(dispatch);
      },
      command: (facts) => {
        const get = new Command('get', { ...facts }).action(dispatch);
        return new Application('facts').command(get).action(dispatch);
      },
      'count-option': (facts) => {
        const get = new Command('get')
          .option('verbose', { ...facts, type: 'count' })
          .action(dispatch);
        return new Application('facts').command(get).action(dispatch);
      },
      'global-option': (facts) =>
        new Application('facts')
          .globalOption('file', { ...facts, type: 'string' })
          .action(dispatch),
      'hook-option': (facts) => {
        const get = new Command('get').action(dispatch);
        const hook = (command) =>
          command.name === 'get' ? command.option('trace', { ...facts, type: 'boolean' }) : command;
        return new Application('facts', {
          plugins: [plugin('@loomcli/trace', { onCommandAttach: hook })],
        })
          .command(get)
          .action(dispatch);
      },
      option: (facts) => {
        const get = new Command('get').option('raw', { ...facts, type: 'string' }).action(dispatch);
        return new Application('facts').command(get).action(dispatch);
      },
      'plugin-option': (facts) =>
        new Application('facts', {
          plugins: [plugin('@loomcli/log', { options: { level: { ...facts, type: 'string' } } })],
        }).action(dispatch),
    };

    // The call that receives a fact checks it, so a faulty one ends the fixture here.
    const app = declare(() => targets[target]({ [fact]: values[value] }));
    writeStdout('assembled\n');

    if (mode === 'inspect') {
      try {
        app.inspect();
        writeStdout('inspected\n');
      } catch (error) {
        const kind = error instanceof DeclarationError ? 'declaration' : 'other';
        writeStdout(`${kind}:${error.exitCode}: ${ruleText(error)}\n`);
      }
    } else {
      const code = await app.run({ process: createProcess({ argv: [] }) });
      writeStdout(`resolved:${code}\n`);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const dispatch = ({ out }) => out.print('dispatched');

export { runFixture as run };
