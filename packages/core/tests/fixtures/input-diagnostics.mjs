import { Application, Command, DeclarationError, plugin, processHandle } from '@loomcli/core';

const act = () => undefined;
const leaf = (name) => new Command(name, { description: 'Probe.' }).action(act);

/** A validator that accepts a string of digits alone. */
const digits = {
  '~standard': {
    validate: (value) =>
      typeof value === 'string' && /^\d+$/u.test(value)
        ? { value }
        : { issues: [{ message: 'Use a whole number.' }] },
    vendor: 'probe',
    version: 1,
  },
};

/** A validator that accepts one of the backup controls alone. */
const controls = {
  '~standard': {
    validate: (value) =>
      ['none', 'simple', 'numbered'].includes(value)
        ? { value }
        : { issues: [{ message: 'Use none, simple, or numbered.' }] },
    vendor: 'probe',
    version: 1,
  },
};

/** A validator whose JSON Schema converter answers with `answer`, or throws what `answer` returns. */
function converting(answer) {
  return {
    '~standard': {
      jsonSchema: { input: answer, output: () => ({}) },
      validate: (value) => ({ value }),
      vendor: 'probe',
      version: 1,
    },
  };
}

const throwing = converting(() => {
  throw new Error('No JSON Schema\nfor a transform.');
});

const listing = converting(() => ['string']);

/** A validator that throws on every value it receives. */
const broken = {
  '~standard': {
    validate: () => {
      throw new Error('Broken validator.');
    },
    vendor: 'probe',
    version: 1,
  },
};

/**
 * The graph a distributed run's plugins judge. `inspect()` learns its build from the release facts
 * a bundle bakes in, so a source run reads a distributed build's graph here instead.
 */
let judged = undefined;
const judging = plugin('@acme/judge', {
  onGraphBuilt: (graph) => {
    judged = graph;
  },
});

/** The options of an application in one build: a distributed one installs the judging plugin. */
const probe = (build) =>
  build === 'distributed'
    ? { description: 'Probe.', plugins: [judging] }
    : { description: 'Probe.' };

/** A plugin that declares the options given, and nothing else. */
const optionsPlugin = (identity, options) => plugin(identity, { options });

/**
 * One faulty declaration per scenario. Each throws a declaration fault whose rule the input,
 * validator, global, and binding family declares, and the fixture prints the diagnostic its
 * message holds.
 */
const scenarios = {
  'alias-global-local': () =>
    new Application('probe')
      .globalOption('file', { aliases: ['input'], type: 'string' })
      .command(new Command('get').option('input', { type: 'boolean' }).action(act)),
  'alias-name': () =>
    new Command('get').option('min-bytes', { aliases: ['bad=name'], type: 'string' }),
  'alias-negative-spelling': () =>
    new Command('get')
      .option('color', { aliases: ['colour'], polarity: 'both', type: 'boolean' })
      .option('no-colour', { type: 'boolean' }),
  'alias-spelling': () =>
    new Command('get')
      .option('min-bytes', { aliases: ['limit'], type: 'string' })
      .option('limit', { type: 'string' }),
  'env-delimiter': () =>
    new Command('get').option('fields', {
      env: 'FIELDS',
      envDelimiter: '',
      multiple: true,
      type: 'string',
    }),
  'global-local-key': () =>
    new Application('probe')
      .globalOption('file', { type: 'string' })
      .command(new Command('get').option('file', { type: 'boolean' }).action(act)),
  'global-local-spelling': () =>
    new Application('probe')
      .globalOption('file', { short: 'f', type: 'string' })
      .command(new Command('get').option('force', { short: 'f', type: 'boolean' }).action(act)),
  'hook-argument-option': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/tag', {
          onCommandAttach: (command) =>
            command.name === 'count' ? command.argument('tag', {}) : command,
        }),
      ],
    })
      .command(new Command('count').option('tag', { type: 'string' }).action(act))
      .inspect(),
  'negative-spelling': () =>
    new Command('get')
      .option('color', { polarity: 'both', type: 'boolean' })
      .option('no-color', { type: 'boolean' }),
  'option-name': () => new Command('get').option('-raw', { type: 'boolean' }),
  'option-twice': () =>
    new Command('get').option('raw', { type: 'boolean' }).option('raw', { type: 'string' }),
  'plugin-alias-spelling': () =>
    new Application('probe', {
      plugins: [optionsPlugin('@acme/trace', { trace: { aliases: ['tail'], type: 'boolean' } })],
    }).command(new Command('get').option('tail', { type: 'string' }).action(act)),
  'plugin-global-key': () =>
    new Application('probe', {
      plugins: [optionsPlugin('@acme/trace', { verbose: { type: 'boolean' } })],
    }).globalOption('verbose', { type: 'boolean' }),
  'plugin-local-spelling': () =>
    new Application('probe', {
      plugins: [optionsPlugin('@acme/trace', { trace: { short: 't', type: 'boolean' } })],
    }).command(new Command('get').option('tail', { short: 't', type: 'string' }).action(act)),
  'plugins-alias-spelling': () =>
    new Application('probe', {
      plugins: [
        optionsPlugin('@acme/log', { level: { aliases: ['verbosity'], type: 'string' } }),
        optionsPlugin('@acme/trace', { verbosity: { type: 'boolean' } }),
      ],
    }),
  'plugins-key': () =>
    new Application('probe', {
      plugins: [
        optionsPlugin('@acme/log', { verbose: { type: 'boolean' } }),
        optionsPlugin('@acme/trace', { verbose: { polarity: 'both', type: 'boolean' } }),
      ],
    }),
  'short-spelling': () =>
    new Command('get')
      .option('force', { short: 'f', type: 'boolean' })
      .option('file', { short: 'f', type: 'string' }),
  'variable-twice': () =>
    new Application('probe')
      .globalOption('limit', { env: 'LIMIT', type: 'string' })
      .command(new Command('count').option('max', { env: 'LIMIT', type: 'string' }).action(act)),
};

/** Applications whose fault waits for build, which run() reports in a development build. */
const reported = {
  'converter-list': () =>
    new Application('probe', { description: 'Probe.' }).command(
      new Command('get', { description: 'Probe.' })
        .option('limit', { description: 'Limit.', type: 'string', validate: listing })
        .action(act),
    ),
  'converter-throws': () =>
    new Application('probe', { description: 'Probe.' }).command(
      new Command('get', { description: 'Probe.' })
        .argument('path', { description: 'Path.', validate: throwing })
        .action(act),
    ),
  'converter-throws-distributed': () =>
    new Application('probe', probe('distributed')).command(
      new Command('get', { description: 'Probe.' })
        .argument('path', { description: 'Path.', validate: throwing })
        .action(act),
    ),
  'global-validator-throws': () =>
    new Application('probe', { description: 'Probe.' })
      .globalOption('limit', { description: 'Limit.', type: 'string', validate: broken })
      .command(leaf('get')),
  'invalid-default': () =>
    new Application('probe', { description: 'Probe.' }).command(
      new Command('get', { description: 'Probe.' })
        .option('limit', { default: 'x', description: 'Limit.', type: 'string', validate: digits })
        .action(act),
    ),
  'invalid-implied': () =>
    new Application('probe', { description: 'Probe.' }).command(
      new Command('get', { description: 'Probe.' })
        .option('backup', {
          description: 'Backup.',
          implied: 'x',
          type: 'string',
          validate: controls,
        })
        .action(act),
    ),
  // A plugin's option is a global option, so its default and its validator meet the same rules.
  'plugin-invalid-default': () =>
    new Application('probe', {
      description: 'Probe.',
      plugins: [
        plugin('@acme/log', {
          options: {
            level: { default: 'x', description: 'Level.', type: 'string', validate: digits },
          },
        }),
      ],
    }).command(leaf('get')),
  'plugin-invalid-implied': () =>
    new Application('probe', {
      description: 'Probe.',
      plugins: [
        plugin('@acme/copy', {
          options: {
            backup: { description: 'Backup.', implied: 'x', type: 'string', validate: controls },
          },
        }),
      ],
    }).command(leaf('get')),
  'plugin-validator-throws': () =>
    new Application('probe', {
      description: 'Probe.',
      plugins: [
        plugin('@acme/log', {
          options: { level: { description: 'Level.', type: 'string', validate: broken } },
        }),
      ],
    }).command(leaf('get')),
  'validator-throws': () =>
    new Application('probe', { description: 'Probe.' }).command(
      new Command('get', { description: 'Probe.' })
        .option('limit', { description: 'Limit.', type: 'string', validate: broken })
        .action(act),
    ),
};

/** The tokens each reported scenario runs with, when it needs more than the Command's name. */
const argvOf = {
  'global-validator-throws': ['get', '--limit', '5'],
  'plugin-validator-throws': ['get', '--level', '5'],
  'validator-throws': ['get', '--limit', '5'],
};

const [scenario, mode] = process.argv.slice(2);

/** The build a reported scenario runs in, which its name states. */
const build = scenario.endsWith('-distributed') ? 'distributed' : 'source';

/** One reported scenario's run, with its words and its build. */
const run = (app) =>
  app.run({ process: processHandle({ argv: argvOf[scenario] ?? ['get'], release: { build } }) });

/** The graph a scenario reads: `inspect()`'s from source, and a distributed run's otherwise. */
async function graphOf(app) {
  if (build === 'source') {
    return app.inspect();
  }
  await run(app);
  return judged;
}

if (scenario in reported) {
  const app = reported[scenario]();
  if (mode === 'inspect') {
    try {
      const graph = await graphOf(app);
      const [child] = graph.root.children;
      const [input] = [...child.arguments, ...child.options];
      process.stdout.write(`${JSON.stringify({ schema: input.schema })}\n`);
    } catch (error) {
      process.stdout.write(`${error.message}\n`);
    }
  } else if (mode === 'cause') {
    try {
      app.inspect();
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ cause: error.cause?.message ?? null })}\n`);
    }
  } else {
    process.exitCode = await run(app);
  }
} else {
  try {
    scenarios[scenario]();
    process.stdout.write('returned\n');
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    process.stdout.write(`${error.message}\n`);
  }
}
