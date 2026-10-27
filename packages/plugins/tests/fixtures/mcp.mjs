import {
  Application,
  Command,
  DeclarationError,
  EX_DATAERR,
  FatalError,
  override,
  processHandle,
} from '@loomcli/core';
import { json, jsonl } from '@loomcli/plugins/format/views';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpArgument, mcpCommand, mcpInput } from '@loomcli/plugins/mcp/extension';
import { records } from '@loomcli/plugins/records';
import { table } from '@loomcli/plugins/table';
import { progress as progressLine } from '@loomcli/prompts';

import { ruleText } from '../../../core/tests/fixtures/rule-text.mjs';

// A test that reads a declaration fault's own sentence runs the fixture as a development build.
const release = { build: process.env.FIXTURE_BUILD ?? 'distributed' };

const dispatch = ({ out }) => out.print('dispatched');

/** A validator that accepts any value and publishes exactly the given input-side JSON Schema. */
function shaped(schema) {
  return {
    '~standard': {
      jsonSchema: { input: () => schema, output: () => ({}) },
      validate: (value) => ({ value }),
      vendor: 'fixture',
      version: 1,
    },
  };
}

const dialect = 'https://json-schema.org/draft/2020-12/schema';

/** A data failure the action raises, which declares its own failure code and exit code 65. */
class MissingError extends FatalError {
  static code = 'missing';

  static exitCode = EX_DATAERR;

  constructor(message) {
    super(message);
    this.name = 'MissingError';
  }
}

/** A failure whose view the application overrides with one that renders nothing. */
class SilentError extends FatalError {
  static code = 'silent';

  constructor() {
    super('Nothing to say.');
    this.name = 'SilentError';
  }
}

/** Every opted-in shape the listing projects, beside Commands that never become tools. */
function listing() {
  const read = new Command('read', {
    description: 'Read one value.',
    extensions: [mcpCommand({ annotations: { openWorld: false, readOnly: true } })],
  })
    .alias('r')
    .argument('path', {
      description: 'The path to read.',
      extensions: [mcpArgument({ description: 'A dot path from the document root.' })],
      required: true,
    })
    .option('depth', {
      default: '1',
      description: 'How deep to read.',
      type: 'string',
      validate: shaped({
        $schema: dialect,
        description: 'The schema says.',
        minimum: 1,
        type: 'integer',
      }),
    })
    .option('quiet', {
      description: 'Say less.',
      extensions: [mcpInput({ description: 'Print the value alone.' })],
      type: 'boolean',
    })
    .option('old-depth', {
      deprecated: 'Use depth instead.',
      description: 'The former depth.',
      type: 'string',
    })
    .option('internal', { description: 'An internal switch.', hidden: true, type: 'boolean' })
    .option('style', { control: true, description: 'Choose how to print.', type: 'string' })
    .action(dispatch);
  const kinds = new Command('kinds', {
    description: 'Take every kind of input.',
    extensions: [mcpCommand({})],
  })
    .argument('first', { description: 'One open word.', required: true })
    .argument('rest', { description: 'More open words.', variadic: true })
    .option('name', { default: 'anon', description: 'An open string.', type: 'string' })
    .option('flag', { description: 'A flag.', type: 'boolean' })
    .option('level', { description: 'A count.', type: 'count' })
    .option('tag', { description: 'A tag.', multiple: true, required: true, type: 'string' })
    .option('label', {
      default: ['a', 'b'],
      description: 'A label.',
      multiple: true,
      type: 'string',
    })
    .option('size', {
      description: 'A size.',
      multiple: true,
      type: 'string',
      validate: shaped({ $schema: dialect, enum: ['s', 'm'], type: 'string' }),
    })
    .option('unset', {
      default: undefined,
      description: 'No default to publish.',
      type: 'string',
      validate: shaped({ type: 'string' }),
    })
    .action(dispatch);
  const clearAll = new Command('clear-all', {
    description: 'Clear every entry.',
    extensions: [mcpCommand({ annotations: { destructive: true } })],
  }).action(dispatch);
  const cache = new Command('cache', { description: 'Manage the cache.' }).command(clearAll);
  const secret = new Command('secret', {
    description: 'A hidden tool.',
    extensions: [mcpCommand({})],
    hidden: true,
  }).action(dispatch);
  const old = new Command('old', {
    deprecated: 'Use read instead.',
    description: 'Read one value the old way.',
    extensions: [mcpCommand({})],
  }).action(dispatch);
  const worded = new Command('worded', {
    description: 'A core description.',
    extensions: [mcpCommand({ description: 'An agent description.\nIt keeps its line break.' })],
  }).action(dispatch);
  const bare = new Command('bare', { extensions: [mcpCommand({})] }).action(dispatch);
  const plain = new Command('plain', { description: 'Never a tool.' }).action(dispatch);
  return new Application('kit', {
    description: 'A fixture kit.',
    extensions: [mcpCommand({ annotations: { destructive: false, idempotent: true } })],
    plugins: [mcp()],
    version: '1.2.3',
  })
    .globalOption('file', { description: 'The document.', type: 'string' })
    .globalOption('verbose', { description: 'Say more.', type: 'count' })
    .globalOption('trace', { description: 'Trace the run.', hidden: true, type: 'boolean' })
    .globalOption('mode', { control: true, description: 'Choose a mode.', type: 'string' })
    .command(read)
    .command(kinds)
    .command(cache)
    .command(secret)
    .command(old)
    .command(worded)
    .command(bare)
    .command(plain)
    .action(dispatch);
}

/** Descriptions and deprecation messages an author wrote across several lines. */
function multiline() {
  const fetch = new Command('fetch', {
    deprecated: 'Use get\ninstead.',
    description: 'Read one value\r\nat a path.',
    extensions: [mcpCommand({})],
  })
    .argument('path', { description: 'The\npath.' })
    .option('depth', {
      deprecated: 'Use\n--level.',
      description: 'How deep\nto walk.',
      type: 'string',
    })
    .action(dispatch);
  return new Application('kit', {
    description: 'A fixture\nkit.',
    plugins: [mcp()],
    version: '1.2.3',
  })
    .command(fetch)
    .action(dispatch);
}

/** Resolves when the call's signal aborts, reporting both moments on the process's own stderr. */
function waitForAbort({ args, signal }) {
  process.stderr.write(`started ${args.label}\n`);
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      process.stderr.write(`aborted ${args.label}\n`);
      resolve();
    });
  });
}

/** Tools whose calls take each path a run can end on. */
function calls() {
  const opted = { extensions: [mcpCommand({})] };
  const echo = new Command('echo', { description: 'Echo the inputs.', ...opted })
    .argument('word', { description: 'A word.', required: true })
    .option('times', { description: 'How many times.', type: 'string' })
    .option('loud', { description: 'Shout.', type: 'boolean' })
    .action(({ args, options, out }) =>
      out.print(
        JSON.stringify({ args, file: options.file, loud: options.loud, times: options.times }),
      ),
    );
  const members = new Command('members', { description: 'List the members.', ...opted })
    .rows({
      views: {
        lines: jsonl(),
        text: { row: (row) => `${row.key}\n` },
        wire: json({ map: (rows) => rows.map((row) => row.key) }),
      },
    })
    .action(({ out }) => out.results([{ key: 'a' }, { key: 'b' }]));
  const lines = new Command('lines', { description: 'List lines.', ...opted })
    .result({ views: { lines: jsonl() } })
    .action(({ out }) => out.results([1, 2]));
  const lies = new Command('lies', { description: 'Promise JSON and print text.', ...opted })
    .result({ views: { lies: { mediaType: 'application/json', render: () => 'not json\n' } } })
    .action(({ out }) => out.results(1));
  const warned = new Command('warned', { description: 'Print and warn.', ...opted }).action(
    async ({ out }) => {
      await out.print('the value');
      await out.warn('a warning');
    },
  );
  const quiet = new Command('quiet', { description: 'Print nothing.', ...opted }).action(() => {});
  const missing = new Command('missing', { description: 'Fail with data.', ...opted }).action(
    () => {
      throw new MissingError('Nothing is at "x". Read another path.');
    },
  );
  const partial = new Command('partial', { description: 'Print, then fail.', ...opted }).action(
    async ({ out }) => {
      await out.print('half');
      throw new MissingError('The rest is missing.');
    },
  );
  const crash = new Command('crash', { description: 'Throw a defect.', ...opted }).action(() => {
    throw new TypeError('The fixture broke.');
  });
  const silent = new Command('silent', { description: 'Fail with no text.', ...opted }).action(
    () => {
      throw new SilentError();
    },
  );
  const wait = new Command('wait', { description: 'Wait for the abort.', ...opted })
    .argument('label', { description: 'The label to report.', required: true })
    .action(waitForAbort);
  return new Application('calls', {
    ...(process.env.FIXTURE_BUILD === undefined ? {} : { description: 'Call each tool.' }),
    plugins: [mcp()],
    version: '2.0.0',
    views: [override(SilentError, { render: () => '' })],
  })
    .globalOption('file', { description: 'The document.', type: 'string' })
    .command(echo)
    .command(members)
    .command(lines)
    .command(lies)
    .command(warned)
    .command(quiet)
    .command(missing)
    .command(partial)
    .command(crash)
    .command(silent)
    .command(wait);
}

/**
 * One tool with a local and a global option the author excluded, both bound to a variable and
 * declaring a default, a group of two options that carry only an `mcpInput` description, and help
 * and the manifest installed, which still show the excluded options.
 */
function excluded() {
  const show = new Command('show', {
    description: 'Show the values the action read.',
    extensions: [mcpCommand({})],
  })
    .option('secret', {
      default: 'default-secret',
      description: 'A local option the tool leaves out.',
      env: 'FIXTURE_SECRET',
      extensions: [mcpInput({ exclude: true })],
      type: 'string',
    })
    .option('plain', { description: 'An option the tool lists.', type: 'string' })
    .option('left', {
      description: 'The left choice.',
      extensions: [mcpInput({ description: 'Choose left.' })],
      type: 'string',
    })
    .option('right', {
      description: 'The right choice.',
      extensions: [mcpInput({ description: 'Choose right.' })],
      type: 'string',
    })
    .oneRequired('left', 'right')
    .action(({ options, out }) => out.print(JSON.stringify(options)));
  return new Application('excl', {
    description: 'Exclude options.',
    plugins: [help(), manifest(), mcp()],
    version: '1.0.0',
  })
    .globalOption('region', {
      default: 'default-region',
      description: 'A global option the tool leaves out.',
      env: 'FIXTURE_REGION',
      extensions: [mcpInput({ exclude: true })],
      type: 'string',
    })
    .command(show);
}

/** Tools whose actions report progress, through progress lines and through regions drawn by hand. */
function progress() {
  const opted = { extensions: [mcpCommand({})] };
  const counted = new Command('counted', { description: 'Count three records.', ...opted }).action(
    async (context) => {
      const line = progressLine(context, { label: 'Fetching records', total: 3 });
      for (const completed of [1, 2, 3]) {
        line.update({ completed });
      }
      await line.end();
    },
  );
  const spinner = new Command('spinner', { description: 'Spin once.', ...opted }).action(
    async (context) => {
      const line = progressLine(context, { label: 'Building the index' });
      line.update({ label: 'Writing the index' });
      await line.end();
    },
  );
  const finished = new Command('finished', { description: 'End with a message.', ...opted }).action(
    async (context) => {
      await progressLine(context, { label: 'Fetching records' }).end('Fetched 3 records.');
    },
  );
  const pair = new Command('pair', { description: 'Run two lines.', ...opted }).action(
    async (context) => {
      const first = progressLine(context, { label: 'First' });
      const second = progressLine(context, { label: 'Second' });
      await first.end();
      await second.end();
    },
  );
  const bare = new Command('bare', { description: 'Report by hand.', ...opted }).action(
    ({ out }) => {
      out.region().report({ completed: 1 });
      out.region().report({});
    },
  );
  const waiting = new Command('waiting', { description: 'Wait with a line.', ...opted }).action(
    (context) => {
      progressLine(context, { label: 'Waiting' });
      return waitForAbort({ args: { label: 'waiting' }, signal: context.signal });
    },
  );
  return new Application('progress', { plugins: [mcp()], version: '1.0.0' })
    .command(counted)
    .command(spinner)
    .command(finished)
    .command(pair)
    .command(bare)
    .command(waiting);
}

/** One application for each build fault the plugin's hook raises. */
/** The options every fault's application shares: the build, a description, and the plugin. */
const faulty = { description: 'A faulty fixture.', plugins: [mcp()] };

/** A tool whose `file` option the author excluded, declared as the given settings say. */
function requiredExcluded(settings) {
  return new Application('app', faulty)
    .command(
      new Command('get', { description: 'Get.', extensions: [mcpCommand({})] })
        .option('file', {
          description: 'The file.',
          extensions: [mcpInput({ exclude: true })],
          type: 'string',
          ...settings,
        })
        .action(dispatch),
    )
    .command(new Command('plain', { description: 'Plain.' }).action(dispatch));
}

const faults = {
  'both-keys': () =>
    new Application('app', faulty).command(
      new Command('get', { description: 'Get.', extensions: [mcpCommand({})] })
        .option('file', {
          description: 'The file.',
          // The types reject both keys, and this untyped fixture reaches the schema anyway.
          extensions: [mcpInput({ description: 'A file.', exclude: true })],
          type: 'string',
        })
        .action(dispatch),
    ),
  'optional-input-excluded': () => requiredExcluded({}),
  'property-name-taken': () =>
    new Application('app', faulty)
      .command(
        new Command('get', { description: 'Get.', extensions: [mcpCommand({})] })
          .argument('path', { description: 'A path.', required: true })
          .option('path', { description: 'Another path.', type: 'string' })
          .action(dispatch),
      )
      .command(new Command('plain', { description: 'Plain.' }).action(dispatch)),
  'property-name-taken-global': () =>
    new Application('app', faulty)
      .globalOption('path', { description: 'A global path.', type: 'string' })
      .command(
        new Command('get', { description: 'Get.', extensions: [mcpCommand({})] })
          .argument('path', { description: 'A path.', required: true })
          .action(dispatch),
      )
      .command(new Command('plain', { description: 'Plain.' }).action(dispatch)),
  'required-input-excluded': () => requiredExcluded({ required: true }),
  'required-input-excluded-content': () => requiredExcluded({ min: 1, type: 'content' }),
  'required-input-excluded-non-interactive': () =>
    requiredExcluded({ required: 'non-interactive' }),
  'root-arguments': () =>
    new Application('app', faulty)
      .argument('files', { description: 'The files.', variadic: true })
      .action(dispatch),
  'tool-name-taken': () => {
    const create = new Command('create', {
      description: 'Create.',
      extensions: [mcpCommand({})],
    }).action(dispatch);
    const scratch = new Command('scratch', { description: 'Scratch work.' }).command(create);
    const flat = new Command('scratch_create', {
      description: 'Create flat.',
      extensions: [mcpCommand({})],
    }).action(dispatch);
    return new Application('app', faulty)
      .command(scratch)
      .command(flat)
      .command(new Command('plain', { description: 'Plain.' }).action(dispatch));
  },
  'tool-name-taken-root': () =>
    new Application('app', { ...faulty, extensions: [mcpCommand({})] })
      .command(
        new Command('app', {
          description: 'Named like the application.',
          extensions: [mcpCommand({})],
        }).action(dispatch),
      )
      .action(dispatch),
  'tool-without-action': () => {
    const clear = new Command('clear', { description: 'Clear.' }).action(dispatch);
    const cache = new Command('cache', {
      description: 'The cache.',
      extensions: [mcpCommand({})],
    }).command(clear);
    return new Application('app', faulty)
      .command(cache)
      .command(new Command('plain', { description: 'Plain.' }).action(dispatch));
  },
  'tool-without-action-root': () =>
    new Application('app', { ...faulty, extensions: [mcpCommand({})] }).command(
      new Command('plain', { description: 'Plain.' }).action(dispatch),
    ),
};

/**
 * One tool that reports the columns its views read and warns at length, served from a process
 * whose environment holds a narrow COLUMNS. A tool call is an invocation by name, with no terminal.
 */
function columns() {
  process.env.COLUMNS = '20';
  const measure = new Command('measure', {
    description: 'Report the columns.',
    extensions: [mcpCommand({})],
  }).action(async ({ out }) => {
    await out.render(null, { render: (_value, context) => `${String(context.columns)}\n` });
    await out.warn('a warning long enough to wrap at twenty columns');
  });
  return new Application('columns', { description: 'Report columns.', plugins: [mcp()] }).command(
    measure,
  );
}

/** A format that adds a second line to its value. */
const twoLines = (value) => `${String(value)}\nsecond line`;

/**
 * One tool that renders a table with a multi-line format cell and records with an authored line
 * break, served from a process whose environment holds a narrow COLUMNS.
 */
function fitted() {
  process.env.COLUMNS = '10';
  const grid = new Command('grid', {
    description: 'Render a table and records.',
    extensions: [mcpCommand({})],
  }).action(async ({ out }) => {
    const rows = [
      { left: 'x y z', right: 'hello world' },
      { left: 'q', right: 'zz' },
    ];
    await out.render(
      rows,
      table({
        columns: [
          { header: 'A', key: 'left' },
          { align: 'right', format: twoLines, key: 'right' },
        ],
      }),
    );
    await out.render(
      [{ key: 'one', kind: 'first\nsecond words here' }],
      records({ identifier: 'key' }),
    );
  });
  return new Application('fitted', {
    description: 'Render fitted views.',
    plugins: [mcp()],
  }).command(grid);
}

const scenarios = { calls, columns, excluded, fitted, listing, multiline, progress, ...faults };

const [name, ...argv] = process.argv.slice(2);

// A fault the call that declares it can detect throws before any run.
try {
  const application = scenarios[name]();
  if (argv[0] === 'inspect') {
    application.inspect();
    process.stdout.write('inspected\n');
  } else {
    // A caller that owns the run aborts it on SIGUSR2, which the test sends as the caller's abort.
    const caller = new AbortController();
    if (process.env.FIXTURE_CALLER_SIGNAL !== undefined) {
      process.once('SIGUSR2', () => caller.abort());
    }
    process.exitCode = await application.run({
      process: processHandle({ argv, release }),
      signal: caller.signal,
    });
  }
} catch (error) {
  if (!(error instanceof DeclarationError)) {
    throw error;
  }
  process.stdout.write(`thrown:${error.exitCode}:${error.rule?.identity}: ${ruleText(error)}\n`);
}
