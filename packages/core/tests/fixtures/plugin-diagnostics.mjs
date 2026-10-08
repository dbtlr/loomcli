import {
  Application,
  Command,
  DeclarationError,
  diagnosticRule,
  encodeFailure,
  extension,
  FatalError,
  InputError,
  override,
  plugin,
  readExtension,
  style,
  translate,
  view,
} from '@loomcli/core';

const act = () => undefined;
const leaf = (name) => new Command(name).action(act);
const load = () => Promise.resolve({ default: act });
const render = () => '';
const row = () => '';
const line = (form) => `${JSON.stringify({ error: form })}\n`;

/** The value an unreadable config throws, so a test reads that the fault keeps it as its cause. */
const boom = new Error('boom');

/** A Standard Schema that answers each value with the verdict `answer` gives. */
function schema(answer) {
  return { '~standard': { validate: answer, vendor: 'fixture', version: 1 } };
}

const accepting = schema((value) => ({ value }));
const note = extension('@acme/notes/command', { schema: accepting, target: 'command' });
const tag = extension('@acme/notes/option', { schema: accepting, target: 'option' });

/**
 * One faulty declaration per scenario. Each throws a declaration fault whose rule the plugin,
 * extension, view, translator, and Application option family declares, and the fixture prints the
 * diagnostic its message holds.
 */
const scenarios = {
  'activation-empty': () => plugin('@acme/help', { middleware: { activate: [], load } }),
  'activation-missing': () => plugin('@acme/help', { middleware: { load } }),
  'activation-unknown': () =>
    plugin('@acme/help', {
      middleware: { activate: ['hlep'], load },
      options: { help: { type: 'boolean' } },
    }),
  'application-failures': () => new Application('probe', { failures: {} }),
  'application-globals': () => new Application('probe', { globals: {} }),
  'application-packet': () => new Application('probe', { packet: { build: 'development' } }),
  'application-view-declared': () =>
    new Application('probe', { views: [view('@acme/page', { render })] }),
  'attach-hook-returns': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/format', {
          onCommandAttach: (command) => (command.name === 'count' ? leaf('count') : command),
        }),
      ],
    })
      .command(leaf('count'))
      .inspect(),
  'attach-hook-throws': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/format', {
          onCommandAttach: (command) => {
            if (command.name === 'count') {
              throw new Error('No format\nfor this Command');
            }
            return command;
          },
        }),
      ],
    })
      .command(leaf('count'))
      .inspect(),
  'commands-entry': () => plugin('@acme/doctor', { commands: [leaf('check'), 'probe'] }),
  'commands-not-list': () => plugin('@acme/doctor', { commands: 'check' }),
  'definition-prototype-unreadable': () =>
    plugin(
      '@acme/log',
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw boom;
          },
        },
      ),
    ),
  'definition-unreadable': () =>
    plugin('@acme/log', {
      get views() {
        throw boom;
      },
    }),
  'encoder-taken': () =>
    plugin('@acme/json', {
      failureEncoders: [
        encodeFailure('application/json', line),
        encodeFailure('application/json', line),
      ],
    }),
  'encoder-taken-across': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/json', { failureEncoders: [encodeFailure('application/json', line)] }),
        plugin('@acme/wire', { failureEncoders: [encodeFailure('application/json', line)] }),
      ],
    }),
  'extension-async': () =>
    new Command('get', {
      extensions: [
        extension('@acme/slow/command', {
          schema: schema(() => Promise.resolve({ value: 1 })),
          target: 'command',
        })(1),
      ],
    }),
  'extension-collect': () => {
    const descriptor = Object.assign(() => undefined, {
      collect: 'yes',
      identity: '@acme/notes/list',
      schema: accepting,
      target: 'command',
    });
    return plugin('@acme/notes', { extensions: [descriptor] });
  },
  'extension-deep': () =>
    extension('@loomcli/plugins/help/page/input', { schema: accepting, target: 'option' }),
  'extension-defined-twice': () => {
    const copy = extension('@acme/notes/command', { schema: accepting, target: 'command' });
    return plugin('@acme/notes', { extensions: [note, copy] });
  },
  'extension-entry': () => plugin('@acme/notes', { extensions: ['@acme/notes/command'] }),
  'extension-foreign-read': () => {
    const copy = extension('@acme/notes/command', { schema: accepting, target: 'command' });
    const graph = new Application('probe', { extensions: [note({ text: 'hi' })] })
      .action(act)
      .inspect();
    return readExtension(graph.root, copy);
  },
  'extension-hand-built-identity': () =>
    plugin('@acme/notes', {
      extensions: [
        Object.assign(() => ({}), {
          collect: false,
          identity: 'Not A Valid/ID_',
          schema: accepting,
          target: 'command',
        }),
      ],
    }),
  'extension-identity': () =>
    extension('@acme/notes/Command', { schema: accepting, target: 'command' }),
  'extension-identity-kind': () => extension(7, { schema: accepting, target: 'command' }),
  'extension-invalid': () =>
    new Command('get').extend(
      extension('@acme/limit/command', {
        schema: schema(() => ({ issues: [{ message: 'Expected a number' }] })),
        target: 'command',
      })('x'),
    ),
  'extension-list': () => new Command('get', { extensions: note('x') }),
  'extension-no-schema': () => {
    const bare = extension('@acme/bare/command', { schema: undefined, target: 'command' });
    return new Command('get').extend(bare(1));
  },
  'extension-output': () =>
    new Command('get').option('raw', {
      extensions: [
        extension('@acme/date/option', {
          schema: schema(() => ({ value: new Date(0) })),
          target: 'option',
        })('now'),
      ],
      type: 'boolean',
    }),
  'extension-target': () => new Command('get', { extensions: [tag('x')] }),
  'extension-throws': () =>
    new Application('probe').globalOption('file', {
      extensions: [
        extension('@acme/strict/option', {
          schema: schema(() => {
            throw new Error('Bad\nvalue');
          }),
          target: 'option',
        })(1),
      ],
      type: 'string',
    }),
  'extension-twice': () => new Command('get').extend(note('a'), note('b')),
  'extension-unscoped': () => extension('notes', { schema: accepting, target: 'command' }),
  'extension-value': () => new Command('get').extend({ identity: '@acme/notes/command' }),
  'failure-code': () => {
    class RegistryDownError extends FatalError {
      static code = 'Registry_Down';

      constructor(message) {
        super(message);
        this.name = 'RegistryDownError';
      }
    }
    return new RegistryDownError('The registry is down.');
  },
  'failure-exit-code': () => {
    class OffScaleError extends FatalError {
      static exitCode = 200;

      constructor(message) {
        super(message);
        this.name = 'OffScaleError';
      }
    }
    return new OffScaleError('Off the scale.');
  },
  'graph-hook-not-function': () => plugin('@acme/mcp', { onGraphBuilt: 'judge' }),
  'graph-hook-promise': () =>
    new Application('probe', {
      plugins: [plugin('@acme/mcp', { onGraphBuilt: () => Promise.resolve(undefined) })],
    })
      .action(act)
      .inspect(),
  'graph-hook-returns': () =>
    new Application('probe', { plugins: [plugin('@acme/mcp', { onGraphBuilt: () => true })] })
      .action(act)
      .inspect(),
  'graph-hook-throws': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/mcp', {
          onGraphBuilt: () => {
            throw new Error('Two tools share\nthe name "scratch_create"');
          },
        }),
      ],
    })
      .action(act)
      .inspect(),
  'hook-alias-spelling': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/format', {
          onCommandAttach: (command) =>
            command.name === 'count'
              ? command.option('shape', { aliases: ['file'], type: 'string' })
              : command,
        }),
      ],
    })
      .command(new Command('count').option('file', { type: 'string' }).action(act))
      .inspect(),
  'hook-collision': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/format', {
          onCommandAttach: (command) =>
            command.name === 'count' ? command.option('format', { type: 'string' }) : command,
        }),
      ],
    })
      .command(new Command('count').option('format', { type: 'boolean' }).action(act))
      .inspect(),
  'hook-spelling': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/format', {
          onCommandAttach: (command) =>
            command.name === 'count'
              ? command.option('shape', { short: 'f', type: 'string' })
              : command,
        }),
      ],
    })
      .command(new Command('count').option('file', { short: 'f', type: 'string' }).action(act))
      .inspect(),
  'middleware-load': () => plugin('@acme/help', { middleware: { activate: 'always' } }),
  'middleware-object': () => plugin('@acme/help', { middleware: 'help' }),
  'on-failure': () => plugin('@acme/suggest', { onFailure: 'hint' }),
  'option-config': () => plugin('@acme/log', { options: { level: 'debug' } }),
  'option-presence': () =>
    plugin('@acme/log', { options: { level: { required: true, type: 'string' } } }),
  // A plugin's option is a global option, so the key is rejected whatever its value.
  'option-presence-sibling': () =>
    plugin('@acme/log', {
      options: { level: { type: 'string', validateOmitted: false }, trace: { type: 'boolean' } },
    }),
  'option-unreadable': () =>
    plugin('@acme/log', {
      options: {
        level: {
          get default() {
            throw boom;
          },
          type: 'string',
        },
      },
    }),
  'options-record': () => plugin('@acme/log', { options: [] }),
  'override-key': () => new Application('probe', { views: [override('InputError', render)] }),
  'override-twice': () =>
    plugin('@acme/brand', {
      views: [override(InputError, { render }), override(InputError, { render })],
    }),
  'plugin-deep': () => plugin('@loomcli/plugins/help/page', {}),
  'plugin-definition': () => plugin('@acme/log', 'debug'),
  'plugin-empty-identity': () => plugin('', {}),
  'plugin-entry': () => new Application('probe', { plugins: [{ identity: '@acme/log' }] }),
  'plugin-identity': () => plugin('Help', {}),
  'plugin-identity-kind': () => plugin(7, {}),
  'plugin-twice': () => {
    const log = plugin('@acme/log', {});
    return new Application('probe', { plugins: [log, log] });
  },
  'plugin-unscoped': () => plugin('help', {}),
  'plugins-not-list': () => new Application('probe', { plugins: 'log' }),
  'rendering-field': () => new Application('probe', { rendering: { color: 'yes' } }),
  'rendering-object': () => new Application('probe', { rendering: 'auto' }),
  'rendering-terminal': () => new Application('probe', { rendering: { terminalControls: 'keep' } }),
  'rule-docs': () =>
    diagnosticRule('@acme/retry/retry-limit', {
      docs: 'retry.md',
      explanation: 'Each retry repeats the request.',
      headline: 'Retry limit out of range',
    }),
  'rule-explanation': () =>
    diagnosticRule('@acme/retry/retry-limit', { explanation: ' ', headline: 'Retry limit' }),
  'rule-identity': () =>
    diagnosticRule('Retry Limit', { explanation: 'Each retry repeats.', headline: 'Retry limit' }),
  'signal-twice': () => plugin('@acme/signals', { signals: ['SIGINT', 'SIGINT'] }),
  'signal-unknown': () => plugin('@acme/signals', { signals: ['SIGHUP'] }),
  'signals-not-list': () => plugin('@acme/signals', { signals: 'SIGINT' }),
  'signals-slot': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/signals', { signals: ['SIGINT'] }),
        plugin('@acme/trace', { signals: ['SIGTERM'] }),
      ],
    }),
  'source-binding': () => plugin('@acme/config', { source: { binding: tag, load } }),
  'source-load': () => plugin('@acme/config', { extensions: [tag], source: { binding: tag } }),
  'source-object': () => plugin('@acme/config', { source: 'files' }),
  'source-own-option': () =>
    plugin('@acme/config', {
      extensions: [tag],
      options: { config: { extensions: [tag(true)], type: 'string' } },
      source: { binding: tag, load },
    }),
  'source-own-option-escaped': () =>
    plugin('@acme/config', {
      extensions: [tag],
      options: { '\u001b[31m': { extensions: [tag(true)], type: 'string' } },
      source: { binding: tag, load },
    }),
  'source-target': () =>
    plugin('@acme/config', { extensions: [note], source: { binding: note, load } }),
  'theme-chain': () => plugin('@acme/theme', { theme: { highlight: style.info.bold } }),
  'theme-name': () => plugin('@acme/theme', { theme: { bold: style.cyan } }),
  'theme-object': () => plugin('@acme/theme', { theme: 'copper' }),
  'theme-slot': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/copper', { theme: { highlight: style.yellow } }),
        plugin('@acme/slate', { theme: { highlight: style.blue } }),
      ],
    }),
  'translate-failure-key': () => translate(FatalError, () => undefined),
  'translate-key': () => translate('SyntaxError', () => undefined),
  'translate-translator': () => translate(SyntaxError, 'invalid'),
  'translators-entry': () => new Application('probe', { translators: [SyntaxError] }),
  'translators-not-list': () => plugin('@acme/http', { translators: 'none' }),
  'view-both': () => view('@acme/page', { render, row }),
  'view-copies': () =>
    plugin('@acme/brand', {
      views: [view('@acme/page', { render }), view('@acme/page', { render })],
    }),
  'view-deep': () => view('@loomcli/core/lanes/stdout', { render }),
  'view-identity': () => view('@acme', { render }),
  'view-identity-kind': () => view(null, { render }),
  'view-media-type': () => view('@acme/notes/page', { mediaType: 5, render }),
  'view-neither': () => view('@acme/page', {}),
  'view-unscoped': () => view('page', { render }),
  'views-entry': () => plugin('@acme/brand', { views: [render] }),
  'views-not-list': () => plugin('@acme/brand', { views: 'page' }),
};

const scenario = process.argv[2];

if (scenario === 'run-rendering') {
  // A fault run() meets reports with the application name in a development build, as a source run is.
  const app = new Application('probe').action(act);
  process.exitCode = await app.run({ host: { argv: [] }, rendering: { hyperlinks: 'maybe' } });
} else {
  try {
    scenarios[scenario]();
    process.stdout.write('returned\n');
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    // The cause mode reads whether the fault kept the thrown value itself.
    // The sentence mode reads the sentence the fault holds, before any rendering escapes it.
    const modes = {
      cause: () => JSON.stringify({ cause: error.cause === boom }),
      sentence: () => error.sentence,
    };
    process.stdout.write(`${modes[process.argv[3]]?.() ?? error.message}\n`);
  }
}
