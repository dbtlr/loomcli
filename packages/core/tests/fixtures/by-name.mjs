import { Writable } from 'node:stream';

import { Application, Command, FatalError, override, plugin, translate } from '@loomcli/core';

const scenario = process.argv[2];
const build = process.argv[3] ?? 'distributed';

/** The packet each scenario's Application reads, so a defect renders by the build a test names. */
const packet = { packet: { build } };

/** A foreign error the application's translator answers. */
class ForeignError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForeignError';
  }
}

/** The failure the translator turns a foreign error into. */
class TranslatedError extends FatalError {
  constructor(message, options) {
    super(message, options);
    this.name = 'TranslatedError';
  }
}

/** Prints one line of JSON to the real stdout, which no invocation by name ever writes to. */
function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** A Standard Schema value that records every value it receives and accepts it unchanged. */
function recording(seen) {
  return {
    '~standard': {
      validate: (value) => {
        seen.push(value);
        return { value };
      },
      vendor: 'fixture',
      version: 1,
    },
  };
}

/** A Standard Schema value that accepts a whole number of at least 0, as textstat's does. */
const wholeNumber = {
  '~standard': {
    validate: (value) =>
      /^\d+$/u.test(value)
        ? { value: Number(value) }
        : { issues: [{ message: 'Expected a whole number of at least 0.' }] },
    vendor: 'fixture',
    version: 1,
  },
};

/** A Command whose action prints every value it received, as one JSON document on stdout. */
function echo(name) {
  return new Command(name)
    .argument('target', { required: true })
    .argument('files', { variadic: true })
    .option('name', { type: 'string' })
    .option('ratio', { type: 'string' })
    .option('flag', { env: 'PROBE_FLAG', type: 'boolean' })
    .option('color', { polarity: 'both', type: 'boolean' })
    .option('keep', { polarity: 'negative', type: 'boolean' })
    .option('backup', { implied: 'simple', type: 'string' })
    .option('verbose', { short: 'v', type: 'count' })
    .option('tag', { multiple: true, type: 'string' })
    .option('versions', { implied: 'latest', multiple: true, type: 'string' })
    .action(async ({ args, options, out }) => {
      await out.print(JSON.stringify({ args, options }));
    });
}

/** The lowering table's Application: one Command that reads every kind of input. */
function lowering() {
  return new Application('probe', packet)
    .command(echo('echo'))
    .command(
      new Command('need')
        .option('item', { multiple: true, required: true, type: 'string' })
        .action(() => undefined),
    );
}

if (scenario === 'lowering') {
  const app = lowering();
  const env = { PROBE_FLAG: 'true' };
  const outcomes = {
    absent: await app.invoke(['echo'], {
      args: { files: [], target: 't' },
      options: { flag: false, keep: true, tag: [], verbose: 0 },
    }),
    bound: await app.invoke(
      ['echo'],
      { args: { target: 't' }, options: { flag: false } },
      { host: { env } },
    ),
    every: await app.invoke(['echo'], {
      args: { files: ['a', 1], target: 'x' },
      options: {
        backup: true,
        color: false,
        flag: true,
        keep: false,
        name: 's',
        ratio: 0.5,
        tag: ['a', 2],
        verbose: 3,
        versions: true,
      },
    }),
    missing: await app.invoke(['need'], { options: { item: [] } }),
    single: await app.invoke(['echo'], {
      args: { files: 'f', target: 7 },
      options: { color: true, name: 5, tag: 'one' },
    }),
    unlowerable: await app.invoke(['echo'], {
      args: { files: [['nested']], target: true },
      options: {
        backup: false,
        color: 1,
        name: null,
        ratio: Number.NaN,
        tag: [{}],
        verbose: 1.5,
        versions: false,
      },
    }),
    unlowerableMore: await app.invoke(['echo'], {
      args: { target: ['a'] },
      options: { flag: 'yes', name: {}, ratio: true, verbose: true },
    }),
  };
  print(outcomes);
} else if (scenario === 'names') {
  const seen = [];
  const app = new Application('probe', packet)
    .globalOption('min-bytes', { env: 'PROBE_MIN_BYTES', type: 'string', validate: wholeNumber })
    .command(
      new Command('pair')
        .argument('first', { required: true })
        .argument('second', { required: true, validate: recording(seen) })
        .option('depth', { required: true, short: 'd', type: 'string' })
        .action(() => undefined),
    )
    .command(new Command('get').argument('path', {}).action(() => undefined))
    .command(
      new Command('cache')
        .command(new Command('clear').action(({ out }) => out.print('cleared')))
        .command(new Command('purge', { hidden: true }).action(({ out }) => out.print('purged'))),
    );
  const env = { PROBE_MIN_BYTES: 'many' };
  print({
    byName: await app.invoke(['pair'], { args: { second: 'x' } }),
    group: await app.invoke(['cache'], {}),
    hidden: await app.invoke(['cache', 'purge'], {}),
    seen,
    source: await app.invoke(['get'], {}, { host: { env } }),
    sourceArgv: await (async () => {
      const stderr = sink();
      const code = await app.run({ host: { argv: ['get'], env, stderr: stderr.stream } });
      return { code, stderr: stderr.text() };
    })(),
    unknownArgument: await app.invoke(['get'], { args: { pth: 'x' } }),
    unknownOption: await app.invoke(['get'], { options: { verbos: true } }),
  });
  process.exitCode = 0;
} else if (scenario === 'capture') {
  const app = new Application('probe', { ...packet, rendering: { color: 'always' } })
    .command(
      new Command('report')
        .result({
          views: { text: { render: (value, { style }) => `${style.bold(String(value.count))}\n` } },
        })
        .action(async ({ host, out, style }) => {
          await out.print(`print on a result ${style.red('Command')}`);
          await out.info(style.bold('info'));
          await out.success('success');
          await out.warn('warn');
          await out.error('error');
          await out.render('rendered', {
            render: (text, context) => `${context.style.red(text)}\n`,
          });
          await out.results({ count: 3 });
          await out.info(JSON.stringify({ argv: host.argv, terminal: host.terminal }));
        }),
    )
    .command(
      new Command('plain').action(async ({ out, style }) => {
        await out.print(style.red('print'));
        await out.render('rendered', {
          render: (text, context) => `${context.style.bold(text)}\n`,
        });
      }),
    );
  print({
    plain: await app.invoke(['plain'], {}),
    report: await app.invoke(['report'], {}),
  });
} else if (scenario === 'failures') {
  const broken = process.argv[4] === 'broken-view';
  const twice = plugin('@fixture/twice', {
    middleware: {
      activate: ['twice'],
      load: () =>
        Promise.resolve({
          default: async ({ next }) => {
            await next();
            await next().catch(() => undefined);
          },
        }),
    },
    options: { twice: { type: 'boolean' } },
  });
  const app = new Application('probe', {
    ...packet,
    plugins: [twice],
    translators: [
      translate(
        ForeignError,
        (error) => new TranslatedError('The foreign call failed.', { cause: error }),
      ),
    ],
    views: broken
      ? [
          override(TranslatedError, {
            render: () => {
              throw new Error('the view broke');
            },
          }),
        ]
      : [],
  })
    .command(
      new Command('foreign').action(() => {
        throw new ForeignError('raw');
      }),
    )
    .command(
      new Command('defect').action(() => {
        throw new TypeError('the action broke');
      }),
    )
    .command(new Command('quiet').action(() => undefined));
  const received = [];
  const handler = (failure, context) => {
    received.push({ context, name: failure.constructor.name });
    return { mapped: failure.message };
  };
  const thrown = new Error('the handler broke');
  print({
    defect: await app.invoke(['defect'], {}, { failure: handler }),
    foreign: await app.invoke(['foreign'], {}, { failure: handler }),
    lateFault: await app.invoke(
      ['quiet'],
      { options: { twice: true } },
      { failure: (failure) => failure.rule.identity },
    ),
    noHandler: await app.invoke(['foreign'], {}).then((outcome) => ({
      ...outcome,
      failure: {
        isTranslated: outcome.failure instanceof TranslatedError,
        message: outcome.failure.message,
      },
    })),
    received,
    rejected: await app
      .invoke(
        ['foreign'],
        {},
        {
          failure: () => {
            throw thrown;
          },
        },
      )
      .then(
        () => 'resolved',
        (error) => error === thrown,
      ),
  });
} else if (scenario === 'view') {
  const later = plugin('@fixture/later', {
    middleware: {
      activate: ['later'],
      load: () =>
        Promise.resolve({
          default: async (context) => {
            context.view = 'text';
            await context.next();
          },
        }),
    },
    options: { later: { type: 'boolean' } },
  });
  const views = {
    json: { render: (value) => `${JSON.stringify(value)}\n` },
    text: { render: (value) => `count ${value.count}\n` },
  };
  const app = new Application('probe', { ...packet, plugins: [later] })
    .command(
      new Command('count').result({ views }).action(async ({ out }) => {
        await out.results({ count: 2 });
      }),
    )
    .command(new Command('get').action(() => undefined));
  print({
    assigned: await app.invoke(['count'], { options: { later: true } }, { view: 'json' }),
    json: await app.invoke(['count'], {}, { view: 'json' }),
    noResult: await app.invoke(['get'], {}, { view: 'json' }),
    notString: await app.invoke(['count'], {}, { view: 5 }),
    unknown: await app.invoke(['count'], {}, { view: 'yaml' }),
  });
} else if (scenario === 'shape') {
  const app = new Application('probe', packet).action(() => undefined);
  const malformed = {
    args: [[], { args: [] }],
    failure: [[], {}, { failure: 'not a function' }],
    host: [[], {}, { host: { argv: ['x'] } }],
    options: [[], { options: 'verbose' }],
    passthrough: [[], { passthrough: [1] }],
    path: ['get', {}],
    signal: [[], {}, { signal: 'not a signal' }],
    values: [[], null],
    valuesKey: [[], { flags: {} }],
  };
  const outcomes = {};
  for (const [slot, call] of Object.entries(malformed)) {
    outcomes[slot] = await app.invoke(...call);
  }
  print(outcomes);
} else if (scenario === 'shape-handled') {
  const received = [];
  const handler = (failure, context) => {
    received.push({ context, identity: failure.rule.identity });
    return { mapped: failure.message };
  };
  const thrown = new Error('the handler broke');
  const app = new Application('probe', packet).command(
    new Command('nested').action(async ({ invoke, out }) => {
      const nested = await invoke(['x'], { options: null }, { failure: handler });
      await out.print(JSON.stringify(nested));
    }),
  );
  print({
    action: await app.invoke(['nested'], {}),
    args: await app.invoke(['x'], { args: [] }, { failure: handler }),
    options: await app.invoke(['x'], { options: null }, { failure: handler }),
    received,
    rejected: await app
      .invoke(
        ['x'],
        { options: null },
        {
          failure: () => {
            throw thrown;
          },
        },
      )
      .then(
        () => 'resolved',
        (error) => error === thrown,
      ),
    signal: await app.invoke(['x'], {}, { failure: handler, signal: {} }),
  });
}

if (scenario === 'isolation') {
  // A sentinel host: every stream records its writes, so a write the call leaked would show.
  const stdout = sink();
  const stderr = sink();
  const owner = plugin('@fixture/owner', { signals: ['SIGINT', 'SIGTERM'] });
  const real = { stderr: 0, stdout: 0 };
  const app = new Application('probe', { ...packet, plugins: [owner] })
    .command(
      new Command('child').action(async ({ host, out }) => {
        await out.print('child output');
        await out.warn('child message');
        await out.print(JSON.stringify({ argv: host.argv, counts: counts(), cwd: host.cwd }));
      }),
    )
    .command(
      new Command('parent').action(async ({ invoke, out }) => {
        const before = { counts: counts(), exitCode: process.exitCode ?? null };
        // Every write to the real streams while the call runs is counted, and none may happen.
        const restore = [
          countWrites(process.stdout, real, 'stdout'),
          countWrites(process.stderr, real, 'stderr'),
        ];
        const outcome = await invoke(['child'], {});
        for (const undo of restore) {
          undo();
        }
        const after = { counts: counts(), exitCode: process.exitCode ?? null };
        await out.print(JSON.stringify({ after, before, outcome, real }));
      }),
    );
  const code = await app.run({
    host: { argv: ['parent'], cwd: '/sentinel', stderr: stderr.stream, stdout: stdout.stream },
  });
  print({ code, stderr: stderr.text(), stdout: stdout.text() });
  process.exitCode = 0;
} else if (scenario === 'host') {
  const app = new Application('probe', packet).action(async ({ host, out }) => {
    await out.print(
      JSON.stringify({
        argv: host.argv,
        cwd: host.cwd,
        env: host.env,
        platform: host.platform,
        reader: host.readSource === readSource,
        stdin: host.stdin === process.stdin,
        terminal: host.terminal,
      }),
    );
  });
  print(
    await app.invoke(
      [],
      {},
      { host: { cwd: '/virtual', env: { ONLY: 'x' }, platform: 'plan9', readSource } },
    ),
  );
} else if (scenario === 'nesting') {
  const app = new Application('probe', packet)
    .command(chatty('left'))
    .command(chatty('right'))
    .command(
      new Command('inner').action(async ({ invoke, out }) => {
        const nested = await invoke(['left'], {});
        await out.print(JSON.stringify(nested));
      }),
    )
    .command(
      new Command('both').action(async ({ invoke, out }) => {
        const [left, right] = await Promise.all([invoke(['left'], {}), invoke(['right'], {})]);
        await out.print(JSON.stringify({ left, right }));
      }),
    );
  print({ both: await app.invoke(['both'], {}), inner: await app.invoke(['inner'], {}) });
} else if (scenario === 'graph') {
  const calls = { attach: 0 };
  const counting = plugin('@fixture/counting', {
    onCommandAttach: (command) => {
      calls.attach += 1;
      return command;
    },
  });
  const app = new Application('probe', { ...packet, plugins: [counting] })
    .command(new Command('leaf').action(() => undefined))
    .command(
      new Command('caller').action(async ({ invoke, out }) => {
        const before = calls.attach;
        await invoke(['leaf'], {});
        await invoke(['leaf'], {});
        await out.print(String(calls.attach - before));
      }),
    );
  const ran = await app.invoke(['caller'], {});
  const afterOne = calls.attach;
  await app.invoke(['leaf'], {});
  const failing = plugin('@fixture/failing', {
    onCommandAttach: () => {
      throw new Error('the hook broke');
    },
  });
  const broken = await new Application('probe', { ...packet, plugins: [failing] })
    .action(() => undefined)
    .invoke([], {});
  print({
    broken,
    fromAction: ran.output,
    perBuild: afterOne,
    perCall: calls.attach - afterOne,
  });
} else if (scenario === 'invoked-by') {
  const seen = [];
  const watching = plugin('@fixture/watching', {
    onFailure: (_failure, { invokedBy }) => {
      seen.push({ hook: invokedBy });
      return undefined;
    },
  });
  const app = new Application('probe', {
    ...packet,
    plugins: [watching],
    views: [
      override(FatalError, {
        render: (failure, { invokedBy }) => `${failure.message} (${invokedBy})\n`,
      }),
    ],
  }).action(({ out }) => out.fatal('Stopped.'));
  const stderr = sink();
  await app.run({ host: { argv: [], stderr: stderr.stream } });
  const named = await app.invoke([], {});
  print({ argv: stderr.text(), named: named.messages, seen });
  process.exitCode = 0;
}

if (scenario === 'sigterm' || scenario === 'own-abort' || scenario === 'pre-aborted') {
  const marks = [];
  const owner = plugin('@fixture/owner', {
    middleware: {
      activate: 'always',
      load: () =>
        Promise.resolve({
          default: async ({ next }) => {
            marks.push('middleware');
            await next();
          },
        }),
    },
    signals: ['SIGINT', 'SIGTERM'],
  });
  const handled = [];
  const failure = (value) => {
    handled.push(value.name);
    return value;
  };
  const app = new Application('probe', { ...packet, plugins: [owner] })
    .command(
      new Command('slow').action(async ({ signal }) => {
        marks.push('action');
        // The harness waits for this line on the real stdout before it signals the process.
        process.stdout.write('ready\n');
        await new Promise((resolve) => {
          const held = setTimeout(resolve, 20_000);
          signal.addEventListener('abort', () => {
            clearTimeout(held);
            resolve();
          });
        });
      }),
    )
    .command(
      new Command('parent').action(async ({ invoke }) => {
        const outcome = await invoke(['slow'], {}, { failure });
        print({ handled, outcome });
      }),
    );
  if (scenario === 'sigterm') {
    const code = await app.run({ host: { argv: ['parent'] } });
    print({ code });
  } else if (scenario === 'own-abort') {
    const controller = new AbortController();
    const pending = app.invoke(['slow'], {}, { failure, signal: controller.signal });
    while (!marks.includes('action')) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    controller.abort(new Error('the caller stopped'));
    print({ handled, outcome: await pending });
  } else {
    const controller = new AbortController();
    controller.abort();
    print({ marks, outcome: await app.invoke(['slow'], {}, { signal: controller.signal }) });
  }
}

if (scenario === 'spellings') {
  const spelling = plugin('@fixture/spelling', {
    middleware: {
      activate: 'always',
      load: () =>
        Promise.resolve({
          default: async ({ next, out, spellings }) => {
            await out.print(JSON.stringify(spellings));
            await next();
          },
        }),
    },
    options: {
      loud: { short: 'l', type: 'boolean' },
      quiet: { polarity: 'negative', type: 'boolean' },
      tiny: { short: 't', shortOnly: true, type: 'boolean' },
    },
  });
  const app = new Application('probe', { ...packet, plugins: [spelling] }).action(() => undefined);
  print(await app.invoke([], { options: { loud: true, quiet: false, tiny: true } }));
}

/** The listeners the process holds on each signal a signals owner claims. */
function counts() {
  return [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
}

/** Counts every write to one real stream under `key`, and answers the call that stops counting. */
function countWrites(stream, tally, key) {
  const original = stream.write;
  stream.write = (...args) => {
    tally[key] += 1;
    return Reflect.apply(original, stream, args);
  };
  return () => {
    stream.write = original;
  };
}

/** A reader an override supplies, which the host must hand on as it is. */
function readSource() {
  return undefined;
}

/** An action that writes its label several times, yielding between writes, so overlap shows. */
function chatty(label) {
  return new Command(label).action(async ({ out }) => {
    for (let index = 0; index < 4; index += 1) {
      await out.print(`${label} ${String(index)}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  });
}

/** A stream that records every byte written to it. */
function sink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}
