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

// The first argument names a scenario; a run scenario passes the rest as the run's words.
// FIXTURE_BUILD names the packet's build, and FIXTURE_ENCODER the encoder the plugin registers.
// FIXTURE_STDOUT=epipe gives a run a stdout that refuses every write with an EPIPE-style error.
const [scenario, ...words] = process.argv.slice(2);

const packet = { packet: { build: process.env.FIXTURE_BUILD ?? 'distributed' } };

/** A validator that accepts each listed name and rejects every other value. */
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

/** A validator that accepts decimal digits alone. */
const digits = {
  '~standard': {
    validate: (value) =>
      /^\d+$/u.test(value) ? { value } : { issues: [{ message: 'Use decimal digits.' }] },
    vendor: 'fixture',
    version: 1,
  },
};

/** One line on stderr: the form under `error`, and a newline. */
const errorLine = (form) => `${JSON.stringify({ error: form })}\n`;

/** The encoder each variant registers: a working one, and three that break. */
const encoders = {
  line: errorLine,
  number: () => 42,
  promise: () => Promise.reject(new Error('Never awaited.')),
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
    encodeFailure('application/json', encoders[process.env.FIXTURE_ENCODER ?? 'line']),
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
    pick: { description: 'The view to pick.', type: 'string', validate: oneOf(['table', 'json']) },
  },
});

/** The caller's own controller, which the `cancel` case aborts from inside the action. */
const caller = new AbortController();

const render = (data) => `${JSON.stringify(data)}\n`;
const row = (data) => `${JSON.stringify(data)}\n`;

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
async function* refusedRows() {
  yield { key: 'a' };
  throw new FatalError('The key "b" is refused.');
}

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
const branded = override(FatalError, { render: (failure) => `branded: ${failure.message}\n` });

function application(plugins = [encoding]) {
  return new Application('enc', {
    ...packet,
    description: 'The enc application.',
    plugins,
    views: [branded],
  })
    .command(list)
    .command(wire)
    .command(flags)
    .command(extra);
}

/** A stdout whose reader has gone away, so every write fails as a closed pipe does. */
function brokenPipe() {
  return new Writable({
    write(chunk, chunkEncoding, callback) {
      callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    },
  });
}

/** Prints what a declaration fault reports, or that the call returned. */
function declare(build) {
  try {
    build();
    process.stdout.write('declared\n');
  } catch (error) {
    process.stdout.write(`${error.name}:${error.rule?.identity}:${error.sentence}\n`);
  }
}

const scenarios = {
  build: async () => {
    const code = await application([encoding, judging]).run({ host: { argv: words } });
    process.stdout.write(`exit:${String(code)}\n`);
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
      { view: 'json' },
    );
    process.stdout.write(
      `${JSON.stringify({ encoded, form: outcome.form, messages: outcome.messages })}\n`,
    );
  },
  'foreign-entry': () =>
    declare(() => plugin('@fixture/odd', { failureEncoders: [{ mediaType: 'application/json' }] })),
  'media-type': () => declare(() => encodeFailure(5, errorLine)),
  'not-a-function': () => declare(() => encodeFailure('application/json', 'line')),
  'not-a-list': () => declare(() => plugin('@fixture/odd', { failureEncoders: 'line' })),
  run: async () => {
    const stdout = process.env.FIXTURE_STDOUT === 'epipe' ? brokenPipe() : undefined;
    const code = await application().run({
      host: { argv: words, ...(stdout ? { stdout } : {}) },
      signal: caller.signal,
    });
    process.stdout.write(`exit:${String(code)}\n`);
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
