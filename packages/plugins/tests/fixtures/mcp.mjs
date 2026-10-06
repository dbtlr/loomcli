import {
  Application,
  Command,
  DeclarationError,
  EX_DATAERR,
  FatalError,
  override,
} from '@loomcli/core';
import { json, jsonl } from '@loomcli/plugins/format/views';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpArgument, mcpCommand, mcpInput } from '@loomcli/plugins/mcp/extension';

import { ruleText } from '../../../core/tests/fixtures/rule-text.mjs';

// A test that reads a declaration fault's own sentence runs the fixture as a development build.
const packet =
  process.env.FIXTURE_BUILD === undefined ? {} : { packet: { build: process.env.FIXTURE_BUILD } };

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
    ...packet,
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
    ...packet,
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

/** One application for each build fault the plugin's hook raises. */
/** The options every fault's application shares: the build, a description, and the plugin. */
const faulty = { ...packet, description: 'A faulty fixture.', plugins: [mcp()] };

const faults = {
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

const scenarios = { calls, listing, ...faults };

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
    process.exitCode = await application.run({ host: { argv }, signal: caller.signal });
  }
} catch (error) {
  if (!(error instanceof DeclarationError)) {
    throw error;
  }
  process.stdout.write(`thrown:${error.exitCode}:${error.rule?.identity}: ${ruleText(error)}\n`);
}
