import { Application, Command, DeclarationError, plugin } from '@loomcli/core';

const act = () => undefined;
const leaf = (name) => new Command(name).action(act);

/** A validator that accepts every value it receives. */
const text = { '~standard': { validate: (value) => ({ value }), vendor: 'probe', version: 1 } };

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

/** A converter whose answer throws while core reads its keys. */
const getterThrowing = converting(() => ({
  get type() {
    throw new Error('getter boom');
  },
}));

/** A converter whose answer holds itself, which the graph copies with the same cycle. */
const cyclic = converting(() => {
  const schema = { type: 'string' };
  schema.self = schema;
  return schema;
});

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

/** An application in one build whose `get` Command declares one option validated by `validate`. */
const validated = (build, validate) =>
  new Application('probe', { packet: { build } }).command(
    new Command('get').option('limit', { type: 'string', validate }).action(act),
  );

/** A plugin that declares the options given, and nothing else. */
const optionsPlugin = (identity, options) => plugin(identity, { options });

/**
 * One faulty declaration per scenario. Each throws a declaration fault whose rule the input,
 * validator, global, and binding family declares, and the fixture prints the diagnostic its
 * message holds.
 */
const scenarios = {
  'argument-env': () => new Command('get').argument('path', { env: 'PATH' }),
  'boolean-default': () =>
    new Command('get').option('verbose', { default: false, type: 'boolean' }),
  'boolean-multiple': () =>
    new Command('list').option('verbose', { multiple: true, type: 'boolean' }),
  'default-shape': () => new Command('get').option('limit', { default: 7, type: 'string' }),
  'env-multiple': () =>
    new Command('get').option('field', { env: 'FIELD', multiple: true, type: 'string' }),
  'env-name': () => new Command('get').option('limit', { env: '9LIMIT', type: 'string' }),
  'global-after-command': () =>
    new Application('probe').command(leaf('get')).globalOption('file', { type: 'string' }),
  'global-local-key': () =>
    new Application('probe')
      .globalOption('file', { type: 'string' })
      .command(new Command('get').option('file', { type: 'boolean' }).action(act)),
  'global-local-spelling': () =>
    new Application('probe')
      .globalOption('file', { short: 'f', type: 'string' })
      .command(new Command('get').option('force', { short: 'f', type: 'boolean' }).action(act)),
  'global-presence': () =>
    new Application('probe').globalOption('file', { required: false, type: 'string' }),
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
  'multiple-flag': () => new Command('get').option('field', { multiple: 'yes', type: 'string' }),
  'negative-spelling': () =>
    new Command('get')
      .option('color', { polarity: 'both', type: 'boolean' })
      .option('no-color', { type: 'boolean' }),
  'not-a-validator': () => new Command('get').option('limit', { type: 'string', validate: {} }),
  'omission-default': () =>
    new Command('get').option('file', {
      default: 'a.json',
      type: 'string',
      validate: text,
      validateOmitted: true,
    }),
  'omission-required': () =>
    new Command('get').argument('path', { required: true, validate: text, validateOmitted: true }),
  'omission-variadic': () =>
    new Command('get').argument('paths', { validate: text, validateOmitted: true, variadic: true }),
  'omission-without-validator': () =>
    new Command('get').option('file', { type: 'string', validateOmitted: true }),
  'option-name': () => new Command('get').option('-raw', { type: 'boolean' }),
  'option-name-kind': () => new Command('get').option(7, { type: 'boolean' }),
  'option-polarity': () => new Command('get').option('color', { polarity: 'on', type: 'boolean' }),
  'option-twice': () =>
    new Command('get').option('raw', { type: 'boolean' }).option('raw', { type: 'string' }),
  'option-type': () => new Command('get').option('limit', { type: 'number' }),
  'plugin-boolean-default': () =>
    optionsPlugin('@acme/trace', { verbose: { default: true, type: 'boolean' } }),
  'plugin-global-key': () =>
    new Application('probe', {
      plugins: [optionsPlugin('@acme/trace', { verbose: { type: 'boolean' } })],
    }).globalOption('verbose', { type: 'boolean' }),
  'plugin-local-spelling': () =>
    new Application('probe', {
      plugins: [optionsPlugin('@acme/trace', { trace: { short: 't', type: 'boolean' } })],
    }).command(new Command('get').option('tail', { short: 't', type: 'string' }).action(act)),
  'plugins-key': () =>
    new Application('probe', {
      plugins: [
        optionsPlugin('@acme/log', { verbose: { type: 'boolean' } }),
        optionsPlugin('@acme/trace', { verbose: { polarity: 'both', type: 'boolean' } }),
      ],
    }),
  'polarity-on-string': () =>
    new Command('get').option('color', { polarity: 'both', type: 'string' }),
  'required-default': () =>
    new Command('get').option('limit', { default: '5', required: true, type: 'string' }),
  'required-flag': () => new Command('get').option('limit', { required: 'yes', type: 'string' }),
  'short-alias': () => new Command('get').option('file', { short: 'fi', type: 'string' }),
  'short-only-both': () =>
    new Command('get').option('color', {
      polarity: 'both',
      short: 'c',
      shortOnly: true,
      type: 'boolean',
    }),
  'short-only-flag': () =>
    new Command('get').option('file', { short: 'f', shortOnly: 'yes', type: 'string' }),
  'short-only-without-short': () =>
    new Command('get').option('file', { shortOnly: true, type: 'string' }),
  'short-spelling': () =>
    new Command('get')
      .option('force', { short: 'f', type: 'boolean' })
      .option('file', { short: 'f', type: 'string' }),
  'validate-omitted-flag': () =>
    new Command('get').option('file', { type: 'string', validate: text, validateOmitted: 'yes' }),
  'variable-twice': () =>
    new Application('probe')
      .globalOption('limit', { env: 'LIMIT', type: 'string' })
      .command(new Command('count').option('max', { env: 'LIMIT', type: 'string' }).action(act)),
  'variadic-default': () =>
    new Command('get').argument('paths', { default: 'a', validate: text, variadic: true }),
  'variadic-flag': () => new Command('get').argument('paths', { variadic: 'yes' }),
};

/** Applications whose fault waits for build, which run() reports in a development build. */
const reported = {
  'converter-cyclic': () => validated('development', cyclic),
  'converter-cyclic-distributed': () => validated('distributed', cyclic),
  'converter-getter': () => validated('development', getterThrowing),
  'converter-getter-distributed': () => validated('distributed', getterThrowing),
  'converter-list': () =>
    new Application('probe', { packet: { build: 'development' } }).command(
      new Command('get').option('limit', { type: 'string', validate: listing }).action(act),
    ),
  'converter-throws': () =>
    new Application('probe', { packet: { build: 'development' } }).command(
      new Command('get').argument('path', { validate: throwing }).action(act),
    ),
  'converter-throws-distributed': () =>
    new Application('probe', { packet: { build: 'distributed' } }).command(
      new Command('get').argument('path', { validate: throwing }).action(act),
    ),
  'global-validator-throws': () =>
    new Application('probe', { packet: { build: 'development' } })
      .globalOption('limit', { type: 'string', validate: broken })
      .command(leaf('get')),
  'invalid-default': () =>
    new Application('probe', { packet: { build: 'development' } }).command(
      new Command('get')
        .option('limit', { default: 'x', type: 'string', validate: digits })
        .action(act),
    ),
  'validator-throws': () =>
    new Application('probe', { packet: { build: 'development' } }).command(
      new Command('get').option('limit', { type: 'string', validate: broken }).action(act),
    ),
};

/** The tokens each reported scenario runs with, when it needs more than the Command's name. */
const argvOf = {
  'global-validator-throws': ['get', '--limit', '5'],
  'validator-throws': ['get', '--limit', '5'],
};

const [scenario, mode] = process.argv.slice(2);

if (scenario in reported) {
  const app = reported[scenario]();
  if (mode === 'inspect') {
    try {
      const graph = app.inspect();
      const [child] = graph.root.children;
      const [input] = [...child.arguments, ...child.options];
      process.stdout.write(`${JSON.stringify({ schema: input.schema })}\n`);
    } catch (error) {
      process.stdout.write(`${error.message}\n`);
    }
  } else if (mode === 'cycle') {
    const [child] = app.inspect().root.children;
    const { schema } = child.options[0];
    const cycle = schema.self === schema;
    process.stdout.write(
      `${JSON.stringify({ cycle, frozen: Object.isFrozen(schema), type: schema.type })}\n`,
    );
  } else if (mode === 'cause') {
    try {
      app.inspect();
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ cause: error.cause?.message ?? null })}\n`);
    }
  } else {
    process.exitCode = await app.run({ host: { argv: argvOf[scenario] ?? ['get'] } });
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
