import { Application, Command, EX_DATAERR, FatalError } from '@loomcli/core';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { mockProcess } from '@loomcli/testing';

import { ruleText } from '../../../core/tests/fixtures/rule-text.mjs';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], env = {}) {
  const status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  const current = output;

  /** A failure class that declares 65 and the failure code `bad-data`. */
  class BadDataError extends FatalError {
    static code = 'bad-data';

    static exitCode = EX_DATAERR;

    constructor() {
      super('The data is bad.');
      this.name = 'BadDataError';
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

  /** A FatalError subclass that declares no failure code, so it lists the code it inherits. */
  class PlainError extends FatalError {
    constructor() {
      super('Something plain failed.');
      this.name = 'PlainError';
    }
  }

  /** One declared failure with one field replaced. */
  const failure = (fields) => ({
    failures: [{ failure: BadDataError, meaning: 'The data is bad.', ...fields }],
  });

  /** One author value per case, covering valid Markdown and examples alongside declaration faults. */
  const cases = {
    'blank-details': { details: ' \t\n ' },
    'command-on-two-lines': { examples: [{ command: 'get a\nget b' }] },
    'failure-bad-code': failure({ failure: BadCodeError }),
    'failure-foreign-class': failure({ failure: Error }),
    'failure-function': failure({ failure: () => 'bad' }),
    'failure-inherited-code': failure({ failure: PlainError }),
    'failure-meaning-on-two-lines': failure({ meaning: 'The data\nis bad.' }),
    'failure-missing': { failures: [{ meaning: 'The data is bad.' }] },
    'failure-stale-name': failure({ name: 'bad-data' }),
    'failure-valid': failure({}),
    'markdown-blank-lines': { details: 'First line.\n\nThird line.' },
    'note-on-two-lines': { examples: [{ command: 'get a', note: 'One.\nTwo.' }] },
    valid: { details: 'First line.\nSecond line.', examples: [{ command: 'get a', note: 'One.' }] },
  };

  const [name, mode] = args;

  /** One case's outcome: its fault, or with `--stored`, the first failure `get`'s value stores. */
  function outcome() {
    // The constructor that carries the value validates it, so a faulty value throws there.
    try {
      const graph = new Application('app')
        .command(
          new Command('get', { extensions: [manifestCommand(cases[name])] }).action(() => {}),
        )
        .inspect();
      const [get] = graph.root.children;
      return mode === '--stored'
        ? get.extensions['@loomcli/plugins/manifest/command'][0].failures[0]
        : { fault: null };
    } catch (error) {
      return { fault: error.constructor.name, message: ruleText(error) };
    }
  }

  current.stdout.write(`${JSON.stringify(outcome())}\n`);
  return {
    status: current.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

export { run };
