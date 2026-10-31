import {
  Application,
  Command,
  DeclarationError,
  diagnosticRule,
  encodeFailure,
  extension,
  FatalError,
  plugin,
  provider,
  readExtension,
  style,
  view,
} from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { stdout: writeStdout } = fixture;
  try {
    const leaf = (name) => new Command(name).action(act);

    /** A Standard Schema that answers each value with the verdict `answer` gives. */

    const accepting = schema((value) => ({ value }));
    /** A provider factory: every value it returns has one name and one type. */

    const note = extension('@acme/notes/command', { schema: accepting, target: 'command' });

    /**
     * One faulty declaration per scenario. Each throws a declaration fault whose rule the plugin,
     * extension, view, translator, and Application option family declares, and the fixture prints the
     * diagnostic its message holds.
     */
    const scenarios = {
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
      'encoding-entry': () =>
        plugin('@acme/json', { failureEncoders: [{ mediaType: 'application/json' }] }),
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
      'extension-entry': () => new Command('count', { extensions: [{ identity: '@acme/notes' }] }),
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
      // A provider another installed copy of core built carries no definition this copy can read.
      'provider-entry': () =>
        new Command('get', {
          uses: [Object.freeze({ lifetime: 'ephemeral', name: 'pool', uses: [] })],
        }),
      // Two values one factory returns pass the types, so core rejects them where the list is declared.
      'provider-name-taken': () =>
        new Command('get', { uses: [secret('token', 'A_TOKEN'), secret('token', 'B_TOKEN')] }),
      'provider-name-taken-closure': () => {
        const first = provider('first', {
          load: async () => ({ default: () => 1 }),
          uses: [secret('token', 'A_TOKEN')],
        });
        const second = provider('second', {
          load: async () => ({ default: () => 2 }),
          uses: [secret('token', 'B_TOKEN')],
        });
        return provider('client', {
          load: async () => ({ default: () => 3 }),
          uses: [first, second],
        });
      },
      'provider-name-taken-root': () =>
        new Application('probe', {
          uses: [secret('token', 'A_TOKEN'), secret('token', 'B_TOKEN')],
        }),
      'provider-root-entry': () =>
        new Application('probe', {
          uses: [Object.freeze({ lifetime: 'persistent', name: 'pool', uses: [] })],
        }),
      'rule-identity': () =>
        diagnosticRule('Retry Limit', {
          explanation: 'Each retry repeats.',
          headline: 'Retry limit',
        }),
      'theme-slot': () =>
        new Application('probe', {
          plugins: [
            plugin('@acme/copper', { theme: { highlight: style.yellow } }),
            plugin('@acme/slate', { theme: { highlight: style.blue } }),
          ],
        }),
      'translation-entry': () => plugin('@acme/http', { translators: [{ key: SyntaxError }] }),
      'view-copies': () =>
        plugin('@acme/brand', {
          views: [view('@acme/page', { render }), view('@acme/page', { render })],
        }),
      'view-entry': () => plugin('@acme/brand', { views: [{ identity: '@acme/page' }] }),
    };

    const scenario = words[0];

    try {
      scenarios[scenario]();
      writeStdout('returned\n');
    } catch (error) {
      if (!(error instanceof DeclarationError)) {
        throw error;
      }
      writeStdout(`${error.message}\n`);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const act = () => undefined;
const render = () => '';
const line = (form) => `${JSON.stringify({ error: form })}\n`;
function schema(answer) {
  return { '~standard': { validate: answer, vendor: 'fixture', version: 1 } };
}
const secret = (name, variable) =>
  provider(name, { load: async () => ({ default: () => variable }) });

export { runFixture as run };
