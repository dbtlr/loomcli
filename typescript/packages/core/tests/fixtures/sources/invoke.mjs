import {
  Application,
  Command,
  InputError,
  lanes,
  override,
  plugin,
  validationContext,
} from '@loomcli/core';
import { z } from 'zod';

import { scenario as fixtureScenario } from '../scenario.mjs';
import { configKey } from './extension.mjs';
import { sourceModule } from './source.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, env: fixtureEnv, stdout: writeStdout } = fixture;
  try {
    let abort = noAbort;

    // A test that reads a defect's own sentence runs the fixture as a development build.
    const release = { build: fixtureEnv.FIXTURE_BUILD ?? 'distributed' };

    /** How the configuration plugin loads its source, chosen by the test. */
    const loaders = {
      // The loader aborts the caller's signal, so the abort lands while the source loads.
      aborts: () => {
        writeStdout('loader:called\n');
        abort();
        return sourceModule({ abort: () => abort(), env: fixtureEnv, stdout: writeStdout });
      },
      module: () => sourceModule({ abort: () => abort(), env: fixtureEnv, stdout: writeStdout }),
      'no-default': () => import('./modules.mjs'),
      recording: () => {
        writeStdout('loader:called\n');
        return sourceModule({ abort: () => abort(), env: fixtureEnv, stdout: writeStdout });
      },
      throws: () => {
        throw new Error('the loader threw before it could import');
      },
    };

    /** The source's own option names a JSON file, which its validator checks before the source runs. */
    const jsonFile = z.string().regex(/\.json$/u, 'Supply a JSON file.');

    /** The same rule, printing each value it receives, so a test counts the calls. */
    const countedFile = {
      '~standard': {
        validate: (value) => {
          writeStdout(`schema:config:${value}\n`);
          return jsonFile['~standard'].validate(value);
        },
        vendor: 'fixture',
        version: 1,
      },
    };

    /** The same rule, printing what its validation context supplied of a global and a local option. */
    const contextFile = {
      '~standard': {
        validate: (value, options) => {
          const context = validationContext(options);
          if (context?.phase === 'invocation') {
            const { limit, max } = context.supplied.options;
            writeStdout(`schema:config:${JSON.stringify({ limit, max })}\n`);
          }
          return jsonFile['~standard'].validate(value);
        },
        vendor: 'fixture',
        version: 1,
      },
    };

    /** The validator the source's own option takes, chosen by the test. */
    const configFile = { 1: countedFile, context: contextFile }[
      fixtureEnv.FIXTURE_CONFIG_COUNT ?? ''
    ];

    /**
     * The configuration plugin: one own option, and the source that answers for `configKey`. Under
     * `FIXTURE_UNLISTED` it leaves the binding out of its `extensions` list.
     */
    const config = () =>
      plugin('@fixture/config', {
        extensions: fixtureEnv.FIXTURE_UNLISTED === '1' ? [] : [configKey],
        options: {
          config: {
            default: 'fixture.json',
            description: 'The configuration file.',
            env: 'FIXTURE_CONFIG_FILE',
            type: 'string',
            validate: configFile ?? jsonFile,
          },
        },
        source: { binding: configKey, load: loaders[fixtureEnv.FIXTURE_LOADER ?? 'module'] },
      });

    /** A logging plugin whose options a variable and the configuration source both fill. */

    /** A help plugin that takes over, so a held fault is never raised under it. */

    const installed = {
      full: () => [config(), log(), help()],
      plain: () => [log(), help()],
    };

    const digits = z.string().regex(/^[0-9]+$/u, 'Supply a whole number.');

    /** A schema that prints the value and the supplied record it received, then accepts it. */
    const recording = {
      '~standard': {
        validate: (value, options) => {
          const supplied = validationContext(options)?.supplied.options.file;
          writeStdout(`schema:file:${JSON.stringify({ supplied, value })}\n`);
          return { value: value ?? 'none' };
        },
        vendor: 'fixture',
        version: 1,
      },
    };

    /**
     * A schema that prints the working directory its context reports, and the raw value its
     * `supplied` record holds for the option, then accepts the value. It rejects `bad`.
     */
    const tracing = {
      '~standard': {
        validate: (value, options) => {
          const context = validationContext(options);
          const { name } = context.input;
          const supplied = context.supplied.options[name];
          writeStdout(
            `schema:${name}:${JSON.stringify({ cwd: context.host.cwd, supplied, value })}\n`,
          );
          return value === 'bad' ? { issues: [{ message: 'Supply a good one.' }] } : { value };
        },
        vendor: 'fixture',
        version: 1,
      },
    };

    /** The view overrides a test installs, so a source's warning and its InputError reach them. */
    const overrides = {
      input: [
        override(InputError, { render: (failure) => `${JSON.stringify(failure.problems)}\n` }),
      ],
      none: [],
      warn: [override(lanes.warn, { render: (message) => `warned: ${message}` })],
    };

    function application() {
      const count = new Command('count', {
        description: 'The count command.',
      })
        .option('max', {
          description: 'The max option.',
          env: 'FIXTURE_MAX',
          required: true,
          type: 'string',
          validate: digits,
        })
        .option('file', {
          description: 'The file option.',
          env: 'FIXTURE_FILE',
          type: 'string',
          validate: recording,
          validateOmitted: true,
        })
        .option('total', {
          description: 'The total option.',
          env: 'FIXTURE_TOTAL',
          extensions: [configKey('total')],
          type: 'boolean',
        })
        .option('quiet', {
          description: 'The quiet option.',
          env: 'FIXTURE_QUIET',
          polarity: 'negative',
          type: 'boolean',
        })
        .option('color', {
          description: 'The color option.',
          env: 'FIXTURE_COLOR',
          polarity: 'both',
          type: 'boolean',
        })
        .action(print('count'));
      const select = new Command('select', {
        description: 'The select command.',
      })
        .option('fields', {
          description: 'The fields option.',
          env: 'FIXTURE_FIELDS',
          envDelimiter: ',',
          extensions: [configKey('fields')],
          multiple: true,
          required: true,
          type: 'string',
          validate: z.string().min(1, 'Supply a field name.'),
        })
        .option('title', {
          description: 'The title option.',
          extensions: [configKey('title')],
          type: 'string',
        })
        .action(print('select'));
      // Each option binds a list: the first name holding a non-empty value supplies it.
      const region = new Command('region', {
        description: 'The region command.',
      })
        .option('area', {
          description: 'The area option.',
          env: ['FIXTURE_AREA', 'FIXTURE_DEFAULT_AREA'],
          type: 'string',
          validate: digits,
        })
        .option('debug', {
          description: 'The debug option.',
          env: ['FIXTURE_DEBUG', 'FIXTURE_DEBUG_FALLBACK'],
          type: 'boolean',
        })
        .option('depth', {
          description: 'The depth option.',
          env: ['FIXTURE_DEPTH', 'FIXTURE_DEPTH_FALLBACK'],
          type: 'count',
        })
        .action(print('region'));
      // Each option a configuration file may fill with a value its validator rejects.
      const fallback = new Command('fallback', {
        description: 'The fallback command.',
      })
        .option('minimum', {
          default: '5',
          description: 'The minimum option.',
          extensions: [configKey('minimum')],
          type: 'string',
          validate: digits,
        })
        .option('needed', {
          description: 'The needed option.',
          extensions: [configKey('needed')],
          required: true,
          type: 'string',
          validate: digits,
        })
        .action(print('fallback'));
      const traced = new Command('traced', {
        description: 'The traced command.',
      })
        .option('omitted', {
          description: 'The omitted option.',
          extensions: [configKey('omitted')],
          type: 'string',
          validate: tracing,
          validateOmitted: true,
        })
        .option('where', {
          description: 'The where option.',
          extensions: [configKey('where')],
          type: 'string',
          validate: tracing,
        })
        .action(print('traced'));
      // A content option a configuration file may fill with a path.
      const reading = new Command('reading', {
        description: 'The reading command.',
      })
        .option('input', {
          description: 'The input option.',
          extensions: [configKey('input')],
          type: 'content',
        })
        .action(({ options, out }) =>
          out.print(`reading:${JSON.stringify({ path: options.input?.path ?? null })}`),
        );
      const paint = new Command('paint', {
        description: 'The paint command.',
      })
        .option('plain', { description: 'The plain option.', env: 'NO_COLOR', type: 'boolean' })
        .action(({ options, out, style }) => out.print(`paint:${options.plain}:${style.red('X')}`));
      const cache = new Command('cache', {
        description: 'The cache command.',
      }).command(
        new Command('clear', {
          description: 'The clear command.',
        }).action(print('clear')),
      );
      // Variables named after Object.prototype members, which a plain-object env does not set.
      const inherited = new Command('inherited', {
        description: 'The inherited command.',
      })
        .option('name', { description: 'The name option.', env: 'constructor', type: 'string' })
        .option('flag', { description: 'The flag option.', env: 'toString', type: 'boolean' })
        .action(({ options, out }) =>
          out.print(`inherited:${typeof options.name}:${options.flag}`),
        );
      let app = new Application('app', {
        description: 'The app application.',
        plugins: (installed[words[0]] ?? (() => []))(),
        views: overrides[fixtureEnv.FIXTURE_VIEWS ?? 'none'],
      });
      // Under FIXTURE_CHATTY the application marks `-v`, so a test reads the debug lines a run writes.
      if (fixtureEnv.FIXTURE_CHATTY === '1') {
        app = app.globalOption('chatty', {
          description: 'Print more.',
          short: 'v',
          type: 'count',
          verbose: true,
        });
      }
      return app
        .globalOption('limit', {
          default: '10',
          description: 'The limit option.',
          env: 'FIXTURE_LIMIT',
          extensions: [configKey('limits.bytes')],
          type: 'string',
          validate: digits,
        })
        .command(count)
        .command(select)
        .command(region)
        .command(fallback)
        .command(traced)
        .command(reading)
        .command(paint)
        .command(cache)
        .command(inherited)
        .action(print('root'));
    }

    const mode = words[1];
    const argv = words.slice(2);

    if (mode === 'inspect') {
      writeStdout(`${JSON.stringify(application().inspect())}\n`);
    } else if (mode === 'cancelled') {
      // The caller cancelled the run before it started.
      const controller = new AbortController();
      controller.abort();
      const code = await application().run({
        process: createProcess({ argv, release }),
        signal: controller.signal,
      });
      writeStdout(`resolved:${code}\n`);
    } else if (mode === 'cancel') {
      // The source aborts the caller's signal from inside its own call, so the abort lands in flight.
      const controller = new AbortController();
      abort = () => controller.abort();
      const code = await application().run({
        process: createProcess({ argv, release }),
        signal: controller.signal,
      });
      writeStdout(`resolved:${code}\n`);
    } else {
      const code = await application().run({ process: createProcess({ argv, release }) });
      writeStdout(`resolved:${code}\n`);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const log = () =>
  plugin('@fixture/log', {
    middleware: {
      activate: ['verbose', 'level'],
      load: async () => ({
        default: async ({ next, options, out }) => {
          await out.print(`log:${JSON.stringify(options)}`);
          await next();
        },
      }),
    },
    options: {
      level: {
        description: 'The log level.',
        env: 'FIXTURE_LEVEL',
        extensions: [configKey('log.level')],
        type: 'string',
        validate: z.string().regex(/^[a-z]+$/u, 'Supply a level name.'),
      },
      verbose: { description: 'Print more.', env: 'FIXTURE_VERBOSE', type: 'boolean' },
    },
  });
const help = () =>
  plugin('@fixture/help', {
    middleware: {
      activate: ['help'],
      load: async () => ({ default: ({ out }) => out.print('help') }),
    },
    options: { help: { description: 'Print help.', short: 'h', type: 'boolean' } },
  });
const print =
  (label) =>
  ({ options, out }) =>
    out.print(`${label}:${JSON.stringify(options)}`);

function noAbort() {}

export { runFixture as run };
