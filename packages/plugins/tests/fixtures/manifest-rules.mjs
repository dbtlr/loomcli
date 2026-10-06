import { Application, Command, EX_DATAERR, FatalError } from '@loomcli/core';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

import { ruleText } from '../../../core/tests/fixtures/rule-text.mjs';

/** A failure class that declares 65 and the failure code `bad-data`. */
class BadDataError extends FatalError {
  static code = 'bad-data';

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

/** A failure class that declares 200 and whose static `name` is a number, which core reads as text. */
class NumberNameError extends FatalError {
  static exitCode = 200;

  static name = 42;

  constructor() {
    super('Unreachable.');
    this.name = 'NumberNameError';
  }
}

/** A failure class that declares 200 and whose static `name` getter throws, so reading its name fails. */
class ThrowingNameError extends FatalError {
  static exitCode = 200;

  static get name() {
    throw new TypeError('The name getter broke.');
  }

  constructor() {
    super('Unreachable.');
    this.name = 'ThrowingNameError';
  }
}

/** A failure class whose failure code is outside the grammar, so none is constructed. */
class BadCodeError extends FatalError {
  static code = 'Bad_Code';

  constructor() {
    super('Unreachable.');
    this.name = 'BadCodeError';
  }
}

/** A failure class whose static `code` getter throws, so reading its failure code fails. */
class ThrowingCodeError extends FatalError {
  static get code() {
    throw new TypeError('The getter broke.');
  }

  constructor() {
    super('Unreachable.');
    this.name = 'ThrowingCodeError';
  }
}

/** A FatalError subclass that declares no failure code, so it lists the code it inherits. */
class PlainError extends FatalError {
  constructor() {
    super('Something plain failed.');
    this.name = 'PlainError';
  }
}

/** A failure class behind a proxy whose `prototype` read throws, so it cannot be read as a class. */
const throwingPrototype = new Proxy(BadDataError, {
  get(target, key, receiver) {
    if (key === 'prototype') {
      throw new TypeError('The prototype read broke.');
    }
    return Reflect.get(target, key, receiver);
  },
});

/** One declared failure with one field replaced. */
const failure = (fields) => ({
  failures: [{ failure: BadDataError, meaning: 'The data is bad.', ...fields }],
});

/** One author value per case, each breaking one line, prose, or failure rule, or keeping them all. */
const cases = {
  'blank-prose-line': { details: 'First line.\n\nThird line.' },
  'command-on-two-lines': { examples: [{ command: 'get a\nget b' }] },
  'failure-bad-code': failure({ failure: BadCodeError }),
  'failure-code-200': failure({ failure: ReservedError }),
  'failure-code-getter-throws': failure({ failure: ThrowingGetterError }),
  'failure-failure-code-getter-throws': failure({ failure: ThrowingCodeError }),
  'failure-foreign-class': failure({ failure: Error }),
  'failure-function': failure({ failure: () => 'bad' }),
  'failure-inherited-code': failure({ failure: PlainError }),
  'failure-meaning-on-two-lines': failure({ meaning: 'The data\nis bad.' }),
  'failure-missing': { failures: [{ meaning: 'The data is bad.' }] },
  'failure-name-getter-throws': failure({ failure: ThrowingNameError }),
  'failure-name-number': failure({ failure: NumberNameError }),
  'failure-prototype-throws': failure({ failure: throwingPrototype }),
  'failure-stale-name': failure({ name: 'bad-data' }),
  'failure-valid': failure({}),
  'note-on-two-lines': { examples: [{ command: 'get a', note: 'One.\nTwo.' }] },
  valid: { details: 'First line.\nSecond line.', examples: [{ command: 'get a', note: 'One.' }] },
};

const [name, mode] = process.argv.slice(2);

/** The sentence core's own construction of one class throws, which the manifest mirrors. */
function coreConstructed(Class) {
  try {
    new Class();
    return { fault: null };
  } catch (error) {
    return { fault: error.constructor.name, message: ruleText(error) };
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
    return { fault: error.constructor.name, message: ruleText(error) };
  }
}

/** The cases that construct a class through core rather than declaring a value. */
const constructed = { 'core-bad-code': BadCodeError, 'core-reserved': ReservedError };

process.stdout.write(
  `${JSON.stringify(name in constructed ? coreConstructed(constructed[name]) : outcome())}\n`,
);
