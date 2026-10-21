import {
  Application,
  Command,
  DeclarationError,
  diagnosticRule,
  extension,
  plugin,
} from '@loomcli/core';

const act = () => undefined;

/** A value that would forge a banner, reorder the line, and end it, were a sentence to hold it raw. */
const forged = 'x\n\n-- FAKE BANNER ---- @loomcli/core/other\u202e\u0085\n';

/** A value that is not a string and that no String() call can convert. */
const bare = Object.create(null);

const accepting = {
  '~standard': { validate: (value) => ({ value }), vendor: 'fixture', version: 1 },
};

/** A schema that rejects every value with a message that holds `forged`. */
const rejecting = {
  '~standard': {
    validate: () => ({ issues: [{ message: forged }] }),
    vendor: 'fixture',
    version: 1,
  },
};

/**
 * A descriptor built by hand rather than by `extension()`, which core recognizes by its shape.
 * `fields` replaces any of its parts.
 */
function handBuilt(fields) {
  return Object.assign(() => ({}), {
    collect: false,
    identity: '@acme/notes/command',
    schema: accepting,
    target: 'command',
    ...fields,
  });
}

/**
 * One declaration per scenario whose author-supplied value is `forged` or `bare`. Each throws a
 * declaration fault, and the fixture reports its rule and sentence, or the class of any other throw.
 */
const scenarios = {
  'argument-after-action': () => new Command('get').action(act).argument(forged, {}),
  'extension-copies': () => plugin('@acme/notes', { extensions: [handBuilt({}), handBuilt({})] }),
  'extension-issue': () =>
    new Command('get').extend(
      extension('@acme/limit/command', { schema: rejecting, target: 'command' })('x'),
    ),
  'hook-option-name': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/format', {
          onCommandAttach: (command) => (command.name === 'get' ? command.option('-bad') : command),
        }),
      ],
    })
      .command(new Command('get').action(act))
      .inspect(),
  'option-after-action': () => new Command('get').action(act).option(forged, { type: 'string' }),
  'rule-bare': () => diagnosticRule(bare, { explanation: 'e', headline: 'h' }),
};

const report = {};
for (const [scenario, declare] of Object.entries(scenarios)) {
  try {
    declare();
    report[scenario] = 'returned';
  } catch (error) {
    report[scenario] =
      error instanceof DeclarationError
        ? { rule: error.rule?.identity, sentence: error.sentence }
        : `${error?.constructor?.name}: ${error?.message}`;
  }
}
process.stdout.write(`${JSON.stringify(report)}\n`);
