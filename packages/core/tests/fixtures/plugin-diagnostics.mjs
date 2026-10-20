import {
  Application,
  Command,
  DeclarationError,
  diagnosticRule,
  encodeFailure,
  extension,
  FatalError,
  plugin,
  readExtension,
  style,
  view,
} from '@loomcli/core';

const act = () => undefined;
const leaf = (name) => new Command(name).action(act);
const render = () => '';
const line = (form) => `${JSON.stringify({ error: form })}\n`;

/** A Standard Schema that answers each value with the verdict `answer` gives. */
function schema(answer) {
  return { '~standard': { validate: answer, vendor: 'fixture', version: 1 } };
}

const accepting = schema((value) => ({ value }));
const note = extension('@acme/notes/command', { schema: accepting, target: 'command' });

/**
 * One faulty declaration per scenario. Each throws a declaration fault whose rule the plugin,
 * extension, view, translator, and Application option family declares, and the fixture prints the
 * diagnostic its message holds.
 */
const scenarios = {
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
  'extension-defined-twice': () => {
    const copy = extension('@acme/notes/command', { schema: accepting, target: 'command' });
    return plugin('@acme/notes', { extensions: [note, copy] });
  },
  'extension-foreign-read': () => {
    const copy = extension('@acme/notes/command', { schema: accepting, target: 'command' });
    const graph = new Application('probe', { extensions: [note({ text: 'hi' })] })
      .action(act)
      .inspect();
    return readExtension(graph.root, copy);
  },
  'extension-invalid': () =>
    new Command('get').extend(
      extension('@acme/limit/command', {
        schema: schema(() => ({ issues: [{ message: 'Expected a number' }] })),
        target: 'command',
      })('x'),
    ),
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
  'plugin-entry': () => new Application('probe', { plugins: [{ identity: '@acme/log' }] }),
  'plugin-twice': () => {
    const log = plugin('@acme/log', {});
    return new Application('probe', { plugins: [log, log] });
  },
  'rule-identity': () =>
    diagnosticRule('Retry Limit', { explanation: 'Each retry repeats.', headline: 'Retry limit' }),
  'signals-slot': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/signals', { signals: ['SIGINT'] }),
        plugin('@acme/trace', { signals: ['SIGTERM'] }),
      ],
    }),
  'theme-slot': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/copper', { theme: { highlight: style.yellow } }),
        plugin('@acme/slate', { theme: { highlight: style.blue } }),
      ],
    }),
  'view-copies': () =>
    plugin('@acme/brand', {
      views: [view('@acme/page', { render }), view('@acme/page', { render })],
    }),
};

const scenario = process.argv[2];

try {
  scenarios[scenario]();
  process.stdout.write('returned\n');
} catch (error) {
  if (!(error instanceof DeclarationError)) {
    throw error;
  }
  process.stdout.write(`${error.message}\n`);
}
