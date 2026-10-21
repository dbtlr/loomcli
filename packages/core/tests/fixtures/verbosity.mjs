import {
  Application,
  Command,
  DeclarationError,
  diagnosticRule,
  extension,
  lanes,
  override,
  plugin,
} from '@loomcli/core';
import { dotenv } from '@loomcli/plugins/dotenv';
import { logging } from '@loomcli/plugins/logging';
import { loomTheme } from '@loomcli/plugins/theme';

/**
 * One run of a fetchit application that marks its own `-v, --verbose` and `-q, --quiet`, or of a
 * variant of it. argv[2] names the variant, argv[3] the terminal, `tty` or `pipe`, or `invoke` for
 * an invocation by name whose values argv[4] holds as JSON, and the rest is the command line.
 * `PROBE_CWD` names the working directory a dotenv variant reads.
 */
const [variant, terminal, ...argv] = process.argv.slice(2);

const terminals = {
  pipe: {
    stderr: { columns: undefined, isTTY: false, rows: undefined },
    stdin: { isTTY: false },
    stdout: { columns: undefined, isTTY: false, rows: undefined },
  },
  tty: {
    stderr: { columns: 40, isTTY: true, rows: 24 },
    stdin: { isTTY: false },
    stdout: { columns: 40, isTTY: true, rows: 24 },
  },
};

const unmarked = variant === 'unmarked';

/** The verbose option, marked unless the variant leaves the marks out. */
const verboseOption = {
  description: 'Show more detail.',
  short: 'v',
  type: 'count',
  ...(variant === 'short-only' ? { shortOnly: true } : { aliases: ['loud'] }),
  ...(unmarked ? {} : { verbose: true }),
};

/** The quiet option, marked unless the variant leaves the marks out. */
const quietOption = {
  description: 'Hide info and success messages.',
  short: 'q',
  type: 'count',
  ...(unmarked ? {} : { quiet: true }),
};

/** A whole view that renders its data as one line. */
const line = { render: (data) => `${data}\n` };

/** A view that draws its data on stderr without a newline. */
const drawn = { render: (data) => `[${data}]` };

const rejected = diagnosticRule('@fixture/judge/rejected', {
  explanation: 'The fixture judge rejects every graph.',
  headline: 'Rejected graph',
});

/** A schema that accepts any value. */
const accepting = {
  '~standard': { validate: (value) => ({ value }), vendor: 'fixture', version: 1 },
};

/** The binding the fixture source answers for. */
const tag = extension('@fixture/source/tag', { schema: accepting, target: 'option' });

const plugins = {
  /** A configuration source that names the file it read through out.debug. */
  config: [
    plugin('@fixture/source', {
      extensions: [tag],
      source: {
        binding: tag,
        load: async () => ({
          default: async ({ out }) => {
            await out.debug('Read .fetchit.json.');
            return {};
          },
        }),
      },
    }),
  ],
  /** The logging plugin writing every level's records to the console. */
  console: [logging({ level: 'trace', to: 'console' })],
  dotenv: [dotenv({ only: ['FETCHIT_TOKEN'] })],
  /** A hook that rejects every graph, a declaration error graph build raises. */
  graph: [
    plugin('@fixture/judge', {
      onGraphBuilt: () => {
        throw new DeclarationError(rejected, {
          correction: 'Remove the judge.',
          sentence: 'The judge rejects the graph.',
        });
      },
    }),
  ],
  /** A hook that declares a local `-x` on the routed Command, so `-vx` reads only after build. */
  hooked: [
    plugin('@fixture/hooked', {
      onCommandAttach: (command) =>
        command.name === 'get'
          ? command.option('extra', { description: 'Extra.', short: 'x', type: 'boolean' })
          : command,
    }),
  ],
  /** An onLog hook that records every event it hears. */
  logged: [
    plugin('@fixture/logged', {
      onLog: (event) => {
        heard.push(event.level);
      },
    }),
  ],
  /** A middleware that writes one debug line and one info line before the action. */
  middleware: [
    plugin('@fixture/middleware', {
      middleware: {
        activate: 'always',
        load: async () => ({
          default: async ({ next, out }) => {
            await out.debug('middleware debug');
            await out.info('middleware info');
            await next();
          },
        }),
      },
    }),
  ],
  /** The theme that styles the dim token, which core leaves plain. */
  themed: [loomTheme()],
};

/** The events the logged variant's hook heard. */
const heard = [];

const views = {
  /** A debug lane override that fails the run if any call reaches it. */
  override: [
    override(lanes.debug, {
      render: () => {
        throw new Error('The debug lane view was called.');
      },
    }),
  ],
};

/** Writes every lane once, then the options it read on stdout. */
async function everyLane({ options, out }) {
  await out.trace('trace');
  await out.debug('debug');
  await out.info('info');
  await out.success('success');
  await out.warn('warn');
  await out.error('error');
  await out.print('print');
  await out.render('render', line);
  await out.draw('draw', drawn);
  await out.print(JSON.stringify({ quiet: options.quiet, verbose: options.verbose }));
}

/** Rows whose source breaks after its first row, so the sequence stops early. */
async function* brokenRows() {
  yield 'first';
  throw new Error('The source broke.');
}

/** The actions a variant swaps in for `get`'s own. */
const actions = {
  /** One log event beside every lane, so the console destination shows it writes records. */
  console: async (context) => {
    context.log.trace('logged');
    await everyLane(context);
  },
  long: ({ out }) =>
    Promise.all([
      out.debug('one two three four five six seven eight nine ten'),
      out.trace('one two three four five six seven eight nine ten'),
    ]),
};

let app = new Application('fetchit', {
  description: 'Fetch records.',
  plugins: plugins[variant] ?? [],
  views: views[variant] ?? [],
})
  .globalOption('verbose', verboseOption)
  .globalOption('quiet', quietOption);
if (variant === 'config') {
  app = app.globalOption('tint', {
    description: 'The tint.',
    extensions: [tag(true)],
    type: 'string',
  });
}

const fetchit = app
  .command(
    new Command('get', { description: 'Fetch one URL.' })
      .option('field', { description: 'A field to keep.', short: 'F', type: 'string' })
      .argument('url', { description: 'The URL to fetch.' })
      .action(actions[variant] ?? everyLane),
  )
  .command(
    new Command('show', { description: 'Show one record.' })
      .result({ views: { plain: line } })
      .action(async ({ out }) => {
        await out.debug('debug');
        await out.trace('trace');
        await out.results('record');
      }),
  )
  .command(
    new Command('list', { description: 'List records that stop early.' })
      .rows({ views: { lines: { row: (row) => `${JSON.stringify(row)}\n` } } })
      .action(({ out }) => out.results(brokenRows())),
  )
  .command(
    new Command('fail', { description: 'Fail.' }).action(({ out }) => out.fatal('It failed.')),
  )
  .command(
    new Command('nested', { description: 'Fetch by name inside this run.' }).action(
      async ({ invoke, out }) => {
        const outcome = await invoke(['get'], { args: { url: 'u' } });
        await out.print(JSON.stringify(outcome.messages));
      },
    ),
  );

if (terminal === 'invoke') {
  const [values] = argv;
  const outcome = await fetchit.invoke(['get'], {
    args: { url: 'u' },
    options: JSON.parse(values ?? '{}'),
  });
  process.stdout.write(JSON.stringify(outcome));
  process.exit(0);
}

process.exitCode = await fetchit.run({
  host: {
    argv,
    ...(process.env.PROBE_CWD === undefined ? {} : { cwd: process.env.PROBE_CWD }),
    release: { build: variant === 'graph' ? 'development' : 'distributed' },
    terminal: terminals[terminal],
  },
});
if (variant === 'logged') {
  process.stdout.write(`heard ${JSON.stringify(heard)}\n`);
}
