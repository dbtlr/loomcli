import { Application, Command, plugin } from '@loomcli/core';

const scenario = process.argv[2];
const argv = process.argv.slice(3);

/** The run's own controller, so a scenario cancels from inside a validator or a middleware. */
const controller = new AbortController();

/** A schema that reads decimal digits, so a request carries the output and not the token. */
const digits = {
  '~standard': {
    validate: (value) =>
      /^\d+$/u.test(value)
        ? { value: Number(value) }
        : { issues: [{ message: 'Use decimal digits.' }] },
    vendor: 'fixture',
    version: 1,
  },
};

/** A schema that cancels the run where it stands, then answers as any other schema does. */
const aborting = {
  '~standard': {
    validate: (value) => {
      controller.abort();
      return { value };
    },
    vendor: 'fixture',
    version: 1,
  },
};

/** A schema that fails the way the author's own code fails, with a developer error and no issues. */
const breaking = {
  '~standard': {
    validate: () => {
      throw new Error('the validator broke');
    },
    vendor: 'fixture',
    version: 1,
  },
};

/** The schema the routed argument declares, which one scenario chooses. */
const schemas = {
  'cancel-validator': aborting,
  'throwing-bare': breaking,
  'throwing-takeover': breaking,
};

const rows = [{ source: 'one.txt' }, { source: 'two words.txt' }];

/** The default view of the rows result: one head, one line per row, one tail. */
const list = {
  head: () => 'PATHS\n',
  row: (row, index) => `${index}: ${row.source}\n`,
  tail: () => 'END\n',
};

/** A second row view, so a selection is visible row by row. */
const wide = { row: (row) => `[${row.source}]\n` };

/** A whole view over the collected rows, so a selection is visible in one line. */
const total = { render: (all) => `${all.length} rows\n` };

/** The view one selector assigns, read from its own environment name. */
function assigned(key) {
  const value = process.env[`LOOM_FIXTURE_VIEW_${key.toUpperCase()}`];
  // A selection that is not a string has no spelling in the environment, so one word stands for it.
  return value === 'not-a-string' ? 7 : value;
}

/** A middleware that assigns the view its environment names, before or after it continues. */
function selector(key, when) {
  return async (context) => {
    const name = assigned(key);
    if (when === 'before' && name !== undefined) {
      context.view = name;
    }
    await context.next();
    if (when === 'after' && name !== undefined) {
      context.view = name;
    }
  };
}

/** Writes what the chain reads before the action runs, then continues. */
async function reading({ next, out, request, view }) {
  await out.print(`request:${JSON.stringify(request)}`);
  await out.print(`frozen:${request === null ? 'none' : Object.isFrozen(request.args)}`);
  await out.print(`view:${String(view)}`);
  await next();
}

/** A middleware that takes the invocation over, as a help plugin does. */
async function taking({ out, request }) {
  await out.print(`help:${request === null ? 'null' : 'request'}`);
}

/** An always-on wrapper, which reports the outcome it wrapped. */
async function wrapping({ next, out }) {
  const outcome = await next();
  await out.print(`wrapper:${outcome}`);
}

/** A middleware that cancels the run and continues, so the chain never reaches the boundary. */
async function aborts({ next }) {
  controller.abort();
  await next();
}

/** Each fixture plugin, named by the key a scenario installs it under. */
const plugins = {
  canceller: () =>
    plugin('@fixture/canceller', {
      middleware: { activate: 'always', load: () => ({ default: aborts }) },
    }),
  first: () =>
    plugin('@fixture/first', {
      middleware: { activate: 'always', load: () => ({ default: selector('first', 'before') }) },
    }),
  help: () =>
    plugin('@fixture/help', {
      middleware: { activate: ['help'], load: () => ({ default: taking }) },
      options: { help: { short: 'h', type: 'boolean' } },
    }),
  late: () =>
    plugin('@fixture/late', {
      middleware: { activate: 'always', load: () => ({ default: selector('late', 'after') }) },
    }),
  reader: () =>
    plugin('@fixture/reader', {
      middleware: { activate: 'always', load: () => ({ default: reading }) },
    }),
  second: () =>
    plugin('@fixture/second', {
      middleware: { activate: 'always', load: () => ({ default: selector('second', 'before') }) },
    }),
  wrapper: () =>
    plugin('@fixture/wrapper', {
      middleware: { activate: 'always', load: () => ({ default: wrapping }) },
    }),
};

/** What each scenario installs, in the order the chain composes them. */
const installed = {
  bare: [],
  'cancel-chain': ['canceller'],
  'cancel-validator': ['reader'],
  late: ['late'],
  reading: ['reader'],
  select: ['first'],
  'select-takeover': ['first', 'help'],
  takeover: ['help'],
  'throwing-bare': [],
  'throwing-takeover': ['help'],
  two: ['first', 'second'],
  'wrapped-takeover': ['wrapper', 'help'],
};

/** One graph every scenario shares, so an invocation reads the same declarations throughout. */
function application() {
  const get = new Command('get')
    .argument('path', { required: true, validate: schemas[scenario] })
    .option('depth', { type: 'string', validate: digits })
    .option('raw', { type: 'boolean' })
    .action(({ args, options, out, passthrough }) =>
      out.print(`get:${JSON.stringify({ args, options, passthrough })}`),
    );
  const count = new Command('count')
    .rows({ views: { list, total, wide } })
    .action(({ out }) => out.results(rows));
  const cache = new Command('cache').command(
    new Command('clear').action(({ out }) => out.print('cleared')),
  );
  return new Application('app', {
    plugins: (installed[scenario] ?? []).map((name) => plugins[name]()),
    version: '1.2.0',
  })
    .globalOption('file', { short: 'f', type: 'string' })
    .command(get)
    .command(count)
    .command(cache)
    .action(({ out }) => out.print('root'));
}

const code = await application().run({ host: { argv }, signal: controller.signal });
process.stdout.write(`resolved:${code}\n`);
