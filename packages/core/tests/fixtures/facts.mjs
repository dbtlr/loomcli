import { Application, Command, DeclarationError, GlobalOptions } from '@loomcli/core';

const target = process.argv[2];
const value = process.argv[3];
const mode = process.argv[4];

const dispatch = ({ out }) => out.print('dispatched');

/**
 * Every value a projection could not print as one line of prose, the one-line summary that it can,
 * and a value that is not a string at all, which a JavaScript author can still declare.
 */
const values = {
  blank: '',
  'carriage-return': 'One line\rand another',
  'line-feed': 'One line\nand another',
  'line-separator': 'One line\u2028and another',
  number: 42,
  'paragraph-separator': 'One line\u2029and another',
  spaces: '   ',
  summary: 'Reads one document.',
  tabs: '\t\t',
};

/** One target of the description fact per entry, each declared the way an author declares it. */
const targets = {
  application: (description) => new Application('facts', { description }).action(dispatch),
  argument: (description) =>
    new Application('facts').argument('files', { description, variadic: true }).action(dispatch),
  'boolean-option': (description) => {
    const globals = new GlobalOptions();
    const get = new Command('get', { globals })
      .option('quiet', { description, type: 'boolean' })
      .action(dispatch);
    return new Application('facts', { globals }).command(get).action(dispatch);
  },
  command: (description) => {
    const globals = new GlobalOptions();
    const get = new Command('get', { description, globals }).action(dispatch);
    return new Application('facts', { globals }).command(get).action(dispatch);
  },
  'global-option': (description) =>
    new Application('facts', {
      globals: new GlobalOptions().option('file', { description, type: 'string' }),
    }).action(dispatch),
  option: (description) => {
    const globals = new GlobalOptions();
    const get = new Command('get', { globals })
      .option('raw', { description, type: 'string' })
      .action(dispatch);
    return new Application('facts', { globals }).command(get).action(dispatch);
  },
  version: (version) => new Application('facts', { version }).action(dispatch),
};

// Construction never reads a fact, so every scenario reaches this line.
const app = targets[target](values[value]);
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
