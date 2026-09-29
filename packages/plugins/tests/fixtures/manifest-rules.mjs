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

/** A failure class whose static `exitCode` getter throws, so reading its code fails. */
class ThrowingGetterError extends FatalError {
  static get exitCode() {
    throw new TypeError('The getter broke.');
  }

  constructor() {
    super('Unreachable.');
    this.name = 'ThrowingGetterError';
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
  'failure-code-getter-throws': failure({ failure: ThrowingGetterError }),
  'failure-foreign-class': failure({ failure: Error }),
  'failure-function': failure({ failure: () => 'bad' }),
  'failure-meaning-on-two-lines': failure({ meaning: 'The data\nis bad.' }),
  'failure-missing': { failures: [{ meaning: 'The data is bad.', name: 'bad-data' }] },
  'failure-name-uppercase': failure({ name: 'Bad-data' }),
  'failure-valid': failure({}),
  'note-on-two-lines': { examples: [{ command: 'get a', note: 'One.\nTwo.' }] },
  valid: { details: 'First line.\nSecond line.', examples: [{ command: 'get a', note: 'One.' }] },
};

const [name, mode] = process.argv.slice(2);

/** The sentence core's own construction of `ReservedError` throws, which the manifest mirrors. */
function coreReserved() {
  try {
    new ReservedError();
    return { fault: null };
  } catch (error) {
    return { fault: error.constructor.name, message: error.message };
  }
}

/** One case's outcome: its fault, or with `--stored`, the first failure `get`'s value stores. */
function outcome() {
  // The constructor that carries the value validates it, so a faulty value throws there.
  try {
    const graph = new Application('app')
      .command(new Command('get', { extensions: [manifestCommand(cases[name])] }).action(() => {}))
      .inspect();
    const [get] = graph.root.children;
    return mode === '--stored'
      ? get.extensions['@loomcli/plugins/manifest/command'][0].failures[0]
      : { fault: null };
  } catch (error) {
    return { fault: error.constructor.name, message: error.message };
  }
}

process.stdout.write(`${JSON.stringify(name === 'core-reserved' ? coreReserved() : outcome())}\n`);
