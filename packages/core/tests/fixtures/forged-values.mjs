import {
  Application,
  Command,
  DeclarationError,
  diagnosticRule,
  extension,
  plugin,
  view,
} from '@loomcli/core';

const act = () => undefined;
const load = () => Promise.resolve({ default: act });
const render = () => '';
const row = () => '';

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
 * One declaration per scenario whose author-supplied value is `forged` or `bare`. Each throws a
 * declaration fault, and the fixture reports its rule and sentence, or the class of any other throw.
 */
const scenarios = {
  'alias-bare': () => new Command('get').alias(bare),
  'application-bare': () => new Application(bare),
  'argument-after-action': () => new Command('get').action(act).argument(forged, {}),
  'command-bare': () => new Command(bare),
  'default-view': () =>
    new Command('store').command(
      new Command('get')
        .result({ views: { plain: { render } } })
        .views({}, { default: forged })
        .action(act),
    ),
  'extension-copies': () =>
    plugin('@acme/notes', {
      extensions: [
        extension(forged, { schema: accepting, target: 'command' }),
        extension(forged, { schema: accepting, target: 'command' }),
      ],
    }),
  'extension-issue': () =>
    new Command('get').extend(
      extension('@acme/limit/command', { schema: rejecting, target: 'command' })('x'),
    ),
  'extension-target': () =>
    new Command('get', {
      extensions: [extension(forged, { schema: accepting, target: 'option' })('x')],
    }),
  'option-after-action': () => new Command('get').action(act).option(forged, { type: 'string' }),
  'option-bare': () => new Command('get').option(bare, { type: 'string' }),
  'plugin-definition': () => plugin(forged, 5),
  'plugin-list': () => plugin(forged, { commands: 'check' }),
  'plugin-twice': () => {
    const log = plugin(forged, {});
    return new Application('probe', { plugins: [log, log] });
  },
  'result-view': () => new Command('get').result({ views: { [forged]: { render, row } } }),
  'rule-bare': () => diagnosticRule(bare, { explanation: 'e', headline: 'h' }),
  'signal-bare': () => plugin('@acme/signals', { signals: [bare] }),
  'source-binding': () =>
    plugin('@acme/config', {
      source: { binding: extension(forged, { schema: accepting, target: 'option' }), load },
    }),
  'view-bare': () => view(bare, {}),
  'view-shape': () => view(forged, {}),
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
