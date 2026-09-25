import { Application, Command, DeclarationError, plugin } from '@loomcli/core';

import { declare } from './declare.mjs';

const target = process.argv[2];
const fact = process.argv[3];
const value = process.argv[4];
const mode = process.argv[5];

const dispatch = ({ out }) => out.print('dispatched');

/**
 * Every value a projection could not print as one line of prose, the one-line summary that it can,
 * and a value that is not a string at all, which a JavaScript author can still declare.
 * The Booleans belong to `hidden`, which is the one fact that reads them.
 */
const values = {
  blank: '',
  'carriage-return': 'One line\rand another',
  false: false,
  'form-feed': 'One line\fand another',
  'line-feed': 'One line\nand another',
  'line-separator': 'One line\u2028and another',
  migration: 'Use get instead.',
  'next-line': '\u0085',
  'next-line-inside': 'One line\u0085and another',
  'no-break-space': '\u00a0',
  'no-break-space-inside': 'One\u00a0line.',
  null: null,
  number: 42,
  'paragraph-separator': 'One line\u2029and another',
  spaces: '   ',
  'string-object': new String('Reads one document.'),
  summary: 'Reads one document.',
  tabs: '\t\t',
  true: true,
  'vertical-tab': 'One line\vand another',
  // A zero-width space is a format character, not whitespace, so it reads as prose.
  'zero-width-space': '\u200b',
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
  'global-option': (facts) =>
    new Application('facts').globalOption('file', { ...facts, type: 'string' }).action(dispatch),
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
    process.stdout.write(`${kind}:${error.exitCode}: ${error.message}\n`);
  }
} else {
  const code = await app.run({ host: { argv: [] } });
  process.stdout.write(`resolved:${code}\n`);
}
