import { Application, Command, DeclarationError, plugin } from '@loomcli/core';

import { declare } from './declare.mjs';
import { ruleText } from './rule-text.mjs';

const target = process.argv[2];
const fact = process.argv[3];
const value = process.argv[4];
const mode = process.argv[5];

const dispatch = ({ out }) => out.print('dispatched');

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
    const get = new Command('get').option('quiet', { ...facts, type: 'boolean' }).action(dispatch);
    return new Application('facts').command(get).action(dispatch);
  },
  command: (facts) => {
    const get = new Command('get', { ...facts }).action(dispatch);
    return new Application('facts').command(get).action(dispatch);
  },
  'command-argument': (facts) => {
    const get = new Command('get').argument('path', facts).action(dispatch);
    return new Application('facts').command(get).action(dispatch);
  },
  'count-option': (facts) => {
    const get = new Command('get').option('verbose', { ...facts, type: 'count' }).action(dispatch);
    return new Application('facts').command(get).action(dispatch);
  },
  'global-option': (facts) =>
    new Application('facts').globalOption('file', { ...facts, type: 'string' }).action(dispatch),
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
process.stdout.write('assembled\n');

if (mode === 'inspect') {
  try {
    app.inspect();
    process.stdout.write('inspected\n');
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'declaration' : 'other';
    process.stdout.write(`${kind}:${error.exitCode}: ${ruleText(error)}\n`);
  }
} else {
  const code = await app.run({ host: { argv: [], release: { build: 'distributed' } } });
  process.stdout.write(`resolved:${code}\n`);
}
