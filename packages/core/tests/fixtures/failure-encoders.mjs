import { Writable } from 'node:stream';
import { setTimeout as after } from 'node:timers/promises';

import {
  Application,
  Command,
  DeclarationError,
  encodeFailure,
  FatalError,
  override,
  plugin,
  style,
} from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, env: fixtureEnv, stdout: writeStdout } = fixture;
  try {
    // The first argument names a scenario; a run scenario passes the rest as the run's words.
    // FIXTURE_BUILD names the run's build, and FIXTURE_ENCODER the encoder the plugin registers.
    // FIXTURE_STDOUT=full gives a run a stdout that refuses every write, as a full disk does.
    const [scenario, ...words] = fixtureWords;

    const release = { build: fixtureEnv.FIXTURE_BUILD ?? 'distributed' };

    /** A validator that accepts each listed name and rejects every other value. */

    /** A validator that accepts decimal digits alone, and throws for `throw`. */
    const digits = {
      '~standard': {
        validate: (value) => {
          if (value === 'throw') {
            throw new Error('The depth validator broke.');
          }
          return /^\d+$/u.test(value)
            ? { value }
            : { issues: [{ message: 'Use decimal digits.' }] };
        },
        vendor: 'fixture',
        version: 1,
      },
    };

    /** One line on stderr: the form under `error`, and a newline. */

    /** The encoder each variant registers: a working one, and two that break. */
    const encoders = {
      line: errorLine,
      number: () => 42,
      throws: () => {
        throw new Error('The encoder broke.');
      },
    };

    /**
     * A plugin whose global `--pick` selects the view, as the formatter selects one, and which encodes
     * `application/json` failures through the encoder the variant names.
     */
    const encoding = plugin('@fixture/encoding', {
      failureEncoders: [
        encodeFailure('application/json', encoders[fixtureEnv.FIXTURE_ENCODER ?? 'line']),
      ],
      middleware: {
        activate: 'always',
        load: async () => ({
          default: async (context) => {
            const picked = context.ownOptions.pick;
            if (context.view !== null && typeof picked === 'string') {
              context.view = picked;
            }
            await context.next();
          },
        }),
      },
      onFailure: () => 'Run "enc --help" to see the usage.',
      options: {
        pick: {
          description: 'The view to pick.',
          type: 'string',
          validate: oneOf(['table', 'json']),
        },
      },
    });

    /** The caller's own controller, which the `cancel` case aborts from inside the action. */
    const caller = new AbortController();

    /** How each Command fails, named by its `--how` value. */
    const failing = {
      defect: () => {
        throw new TypeError('Cannot read the value.');
      },
      fatal: () => {
        throw new FatalError(`The ${style.bold('registry')} is down.`);
      },
    };

    /** Rows whose source cancels the run after its first row and then ends, as Ctrl-C mid-stream does. */
    async function* cancelledRows() {
      yield { key: 'a' };
      caller.abort();
      await after(10);
    }

    /** Rows whose source throws after its first row. */

    /** A Command whose rows render as they arrive and whose source throws after its first row. */
    const list = new Command('list', { description: 'The list command.' })
      .option('depth', { description: 'The depth.', type: 'string', validate: digits })
      .option('how', { description: 'How the Command fails.', type: 'string' })
      .rows({ views: { json: { mediaType: 'application/json', row }, table: { row } } })
      .views({}, { default: 'table' })
      .action(async ({ options, out }) => {
        if (options.how === 'cancel') {
          caller.abort();
          throw new FatalError('Refused after the abort.');
        }
        if (options.how === 'stream-cancel') {
          await out.results(cancelledRows());
          return;
        }
        if (options.how !== undefined) {
          failing[options.how]();
        }
        await out.results(refusedRows());
      });

    /** A Command whose default view declares the encoded media type. */
    const wire = new Command('wire', { description: 'The wire command.' })
      .result({ views: { json: { mediaType: 'application/json', render }, text: { render } } })
      .views({}, { default: 'json' })
      .action(() => {
        throw new FatalError('Refused.');
      });

    /** A Command with a result and a child, for the structural faults core raises from argv words alone. */
    const flags = new Command('flags', { description: 'The flags command.' })
      .option('count', { description: 'The count.', type: 'boolean' })
      .option('tag', { description: 'The tag.', type: 'string' })
      .result({ views: { json: { mediaType: 'application/json', render } } })
      .command(
        new Command('inner', { description: 'The inner command.' })
          .option('deep', { description: 'The depth.', type: 'string' })
          .action(() => undefined),
      )
      .action(({ out }) => out.results({}));

    /** A Command with a result and no argument. */
    const extra = new Command('extra', { description: 'The extra command.' })
      .result({ views: { json: { mediaType: 'application/json', render } } })
      .action(({ out }) => out.results({}));

    /** A plugin that rejects every graph it judges, so each run fails at build. */
    const judging = plugin('@fixture/judging', {
      onGraphBuilt: () => {
        throw new DeclarationError('The graph is rejected.');
      },
    });

    /** Jsonkit's override pattern: an application's own FatalError view. */
    const branded = override(FatalError, { render: renderFixture1 });

    function application(plugins = [encoding]) {
      return new Application('enc', {
        description: 'The enc application.',
        plugins,
        views: [branded],
      })
        .command(list)
        .command(wire)
        .command(flags)
        .command(extra);
    }

    /** A stdout on a full disk, so every write fails, which leaves a broken destination. */

    /** Prints what a declaration fault reports, or that the call returned. */
    function declare(build) {
      try {
        build();
        writeStdout('declared\n');
      } catch (error) {
        writeStdout(`${error.name}:${error.rule?.identity}:${error.sentence}\n`);
      }
    }

    const scenarios = {
      build: async () => {
        const code = await application([encoding, judging]).run({
          process: createProcess({ argv: words, release }),
        });
        writeStdout(`exit:${String(code)}\n`);
      },
      'by-name': async () => {
        let encoded = 0;
        const counting = plugin('@fixture/counting', {
          failureEncoders: [
            encodeFailure('application/json', (form) => {
              encoded += 1;
              return errorLine(form);
            }),
          ],
        });
        const outcome = await application([counting]).invoke(
          ['list'],
          { options: { depth: 'x' } },
          { process: createProcess({ release }), view: 'json' },
        );
        writeStdout(
          `${JSON.stringify({ encoded, form: outcome.form, messages: outcome.messages })}\n`,
        );
      },
      run: async () => {
        const stdout = fixtureEnv.FIXTURE_STDOUT === 'full' ? fullDisk() : undefined;
        const code = await application().run({
          process: createProcess({ argv: words, release, ...(stdout ? { stdout } : {}) }),
          signal: caller.signal,
        });
        writeStdout(`exit:${String(code)}\n`);
      },
      'taken-across-plugins': () =>
        declare(
          () =>
            new Application('enc', {
              plugins: [
                plugin('@fixture/first', {
                  failureEncoders: [encodeFailure('application/json', errorLine)],
                }),
                plugin('@fixture/second', {
                  failureEncoders: [encodeFailure('application/json', errorLine)],
                }),
              ],
            }),
        ),
      'taken-in-plugin': () =>
        declare(() =>
          plugin('@fixture/odd', {
            failureEncoders: [
              encodeFailure('application/json', errorLine),
              encodeFailure('application/json', errorLine),
            ],
          }),
        ),
    };

    await scenarios[scenario]();
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

function oneOf(names) {
  return {
    '~standard': {
      validate: (value) =>
        names.includes(value)
          ? { value }
          : { issues: [{ message: `Supply one of ${names.join(', ')}.` }] },
      vendor: 'fixture',
      version: 1,
    },
  };
}
const errorLine = (form) => `${JSON.stringify({ error: form })}\n`;
const render = (data) => `${JSON.stringify(data)}\n`;
const row = (data) => `${JSON.stringify(data)}\n`;
async function* refusedRows() {
  yield { key: 'a' };
  throw new FatalError('The key "b" is refused.');
}
const renderFixture1 = (failure) => `branded: ${failure.message}\n`;
function fullDisk() {
  return new Writable({
    write(chunk, chunkEncoding, callback) {
      callback(Object.assign(new Error('write ENOSPC'), { code: 'ENOSPC' }));
    },
  });
}

export { runFixture as run };
