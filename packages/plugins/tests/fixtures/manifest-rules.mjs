import { Application, Command, EX_DATAERR, FatalError } from '@loomcli/core';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

/** A failure class that declares 65. */
class BadDataError extends FatalError {
  static exitCode = EX_DATAERR;

  constructor() {
    super('The data is bad.');
    this.name = 'BadDataError';
  }
}

/** A failure class whose static declares a code no failure may exit with, so none is constructed. */
class ReservedError extends FatalError {
  static exitCode = 200;

  constructor() {
    super('Reserved.');
    this.name = 'ReservedError';
  }
}

/** One declared failure with one field replaced. */
const failure = (fields) => ({
  failures: [{ failure: BadDataError, meaning: 'The data is bad.', name: 'bad-data', ...fields }],
});

/** One author value per case, each breaking one line, prose, or failure rule, or keeping them all. */
const cases = {
  'blank-prose-line': { details: 'First line.\n\nThird line.' },
  'command-on-two-lines': { examples: [{ command: 'get a\nget b' }] },
  'failure-code-200': failure({ failure: ReservedError }),
  'failure-foreign-class': failure({ failure: Error }),
  'failure-function': failure({ failure: () => 'bad' }),
  'failure-meaning-on-two-lines': failure({ meaning: 'The data\nis bad.' }),
  'failure-missing': { failures: [{ meaning: 'The data is bad.', name: 'bad-data' }] },
  'failure-name-uppercase': failure({ name: 'Bad-data' }),
  'failure-valid': failure({}),
  'note-on-two-lines': { examples: [{ command: 'get a', note: 'One.\nTwo.' }] },
  valid: { details: 'First line.\nSecond line.', examples: [{ command: 'get a', note: 'One.' }] },
};

const value = cases[process.argv[2]];

// The constructor that carries the value validates it, so a faulty value throws there.
try {
  new Application('app')
    .command(new Command('get', { extensions: [manifestCommand(value)] }).action(() => {}))
    .inspect();
  process.stdout.write(`${JSON.stringify({ fault: null })}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ fault: error.constructor.name, message: error.message })}\n`,
  );
}
