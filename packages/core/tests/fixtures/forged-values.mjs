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
 * A hand-built descriptor whose identity getter answers `@acme/a` and `@acme/b` in turn, so a
 * build that reads the identity twice sees two identities.
 */
function alternating() {
  let reads = 0;
  const descriptor = handBuilt({});
  Object.defineProperty(descriptor, 'identity', {
    enumerable: true,
    get: () => {
      reads += 1;
      return reads % 2 === 1 ? '@acme/a' : '@acme/b';
    },
  });
  return descriptor;
}

/**
 * One declaration per scenario whose author-supplied value is `forged` or `bare`. Each throws a
 * declaration fault, and the fixture reports its rule and sentence, or the class of any other throw.
 */
const scenarios = {
  'alias-bare': () => new Command('get').alias(bare),
  'application-bare': () => new Application(bare),
  'argument-after-action': () => new Command('get').action(act).argument(forged, {}),
  'argument-bare': () => new Command('get').argument(bare, {}),
  'argument-config-bare': () => new Command('get').argument(bare, 'text'),
  'command-bare': () => new Command(bare),
  'default-view': () =>
    new Command('store').command(
      new Command('get')
        .result({ views: { plain: { render } } })
        .views({}, { default: forged })
        .action(act),
    ),
  'extension-alternating': () =>
    plugin('@acme/notes', { extensions: [alternating(), alternating()] }),
  'extension-bare': () => extension(bare, { schema: accepting, target: 'command' }),
  'extension-collect': () => plugin('@acme/notes', { extensions: [handBuilt({ collect: 'no' })] }),
  'extension-copies': () => plugin('@acme/notes', { extensions: [handBuilt({}), handBuilt({})] }),
  'extension-forged': () => extension(forged, { schema: accepting, target: 'command' }),
  'extension-hand-built': () =>
    plugin('@acme/notes', { extensions: [handBuilt({ identity: forged })] }),
  'extension-issue': () =>
    new Command('get').extend(
      extension('@acme/limit/command', { schema: rejecting, target: 'command' })('x'),
    ),
  'global-option-bare': () => new Application('probe').globalOption(bare, { type: 'string' }),
  'global-option-config-bare': () => new Application('probe').globalOption(bare, null),
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
  'option-bare': () => new Command('get').option(bare, { type: 'string' }),
  'option-config-bare': () => new Command('get').option(bare, undefined),
  'option-config-forged': () => new Command('get').option('format', forged),
  'plugin-bare': () => plugin(bare, {}),
  'plugin-forged': () => plugin(forged, {}),
  'result-view': () => new Command('get').result({ views: { [forged]: { render, row } } }),
  'rule-bare': () => diagnosticRule(bare, { explanation: 'e', headline: 'h' }),
  'signal-bare': () => plugin('@acme/signals', { signals: [bare] }),
  'source-binding': () => {
    const binding = handBuilt({});
    return plugin('@acme/config', {
      extensions: [binding],
      source: { binding, load: () => Promise.resolve({ default: act }) },
    });
  },
  'view-bare': () => view(bare, { render }),
  'view-forged': () => view(forged, { render }),
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
