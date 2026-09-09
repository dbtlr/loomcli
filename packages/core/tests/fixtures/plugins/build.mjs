import {
  Application,
  Command,
  DeclarationError,
  extension,
  GlobalOptions,
  InputError,
  plugin,
  renderFailure,
} from '@loomcli/core';
import { z } from 'zod';

const dispatch = ({ out }) => out.print('dispatched');

const load = () => import('./modules/silent.mjs');

/** One descriptor per target, so a value on the wrong slot is a value some extension produced. */
const facts = {
  argument: extension('@fixture/facts/argument', {
    schema: z.object({ hint: z.string() }),
    target: 'argument',
  }),
  command: extension('@fixture/facts/command', {
    schema: z.object({ details: z.string() }),
    target: 'command',
  }),
  option: extension('@fixture/facts/option', {
    schema: z.object({ placeholder: z.string() }),
    target: 'option',
  }),
};

/** A second descriptor object under one identity, which one graph may never hold twice. */
const twin = extension('@fixture/facts/command', {
  schema: z.object({ details: z.string() }),
  target: 'command',
});

/** A schema that answers with a promise, which build cannot wait for. */
const asynchronous = {
  '~standard': {
    validate: async () => Promise.resolve({ value: {} }),
    vendor: 'fixture',
    version: 1,
  },
};

/** A schema whose output holds a value the graph cannot freeze as plain data. */
const exotic = {
  '~standard': {
    validate: () => ({ value: { at: new Date(0) } }),
    vendor: 'fixture',
    version: 1,
  },
};

const named = (identity, definition) => plugin(identity, definition);

/** A schema whose validate call is the scenario's own, so the rule under test is the only rule. */
const schemaOf = (validate) => ({ '~standard': { validate, vendor: 'fixture', version: 1 } });

/** One application whose root carries one extension value, for the rules a schema output answers. */
function withOutput(identity, validate) {
  const descriptor = extension(identity, { schema: schemaOf(validate), target: 'command' });
  return new Application('app', { extensions: [descriptor({})] }).action(dispatch);
}

/** An output that is plain data except for the one property each scenario names. */
function output(value) {
  return () => ({ value });
}

const scenarios = {
  'activation-undeclared': () =>
    withPlugin(
      named('@loomcli/help', {
        middleware: { activate: ['hlep'], load },
        options: { help: { short: 'h', type: 'boolean' } },
      }),
    ),
  'async-schema': () => {
    const descriptor = extension('@fixture/async', {
      schema: asynchronous,
      target: 'command',
    });
    return new Application('app', { extensions: [descriptor({})] }).action(dispatch);
  },
  'definition-not-object': () => withPlugin(named('@loomcli/help', 'nope')),
  'empty-activation': () =>
    withPlugin(named('@loomcli/help', { middleware: { activate: [], load } })),
  'empty-identity': () => withPlugin(plugin('', {})),
  'exotic-output': () => {
    const descriptor = extension('@fixture/exotic', { schema: exotic, target: 'command' });
    const globals = new GlobalOptions();
    const get = new Command('get', { extensions: [descriptor({})], globals }).action(dispatch);
    return new Application('app', { globals }).command(get).action(dispatch);
  },
  'extensions-not-array': () => withPlugin(named('@loomcli/help', { extensions: {} })),
  'failures-not-array': () =>
    withPlugin(
      named('@loomcli/help', { failures: renderFailure(InputError, { render: () => 'one\n' }) }),
    ),
  'identity-not-string': () => withPlugin(plugin(7, {})),
  installed: () => withPlugin(named('@loomcli/help', {})),
  'installed-twice': () =>
    new Application('app', {
      plugins: [named('@loomcli/help', {}), named('@loomcli/help', {})],
    }).action(dispatch),
  'invalid-value': () => {
    const globals = new GlobalOptions();
    const get = new Command('get', {
      extensions: [facts.command({ details: 7 })],
      globals,
    }).action(dispatch);
    return new Application('app', { globals }).command(get).action(dispatch);
  },
  'local-key': () => {
    const globals = new GlobalOptions();
    const get = new Command('get', { globals })
      .option('help', { type: 'boolean' })
      .action(dispatch);
    return new Application('app', {
      globals,
      plugins: [named('@loomcli/help', { options: { help: { type: 'boolean' } } })],
    })
      .command(get)
      .action(dispatch);
  },
  'middleware-not-object': () => withPlugin(named('@loomcli/help', { middleware: null })),
  'no-activation': () => withPlugin(named('@loomcli/help', { middleware: { load } })),
  'no-loader': () => withPlugin(named('@loomcli/help', { middleware: { activate: 'always' } })),
  'no-schema': () => {
    const bare = extension('@fixture/bare', { target: 'command' });
    return new Application('app', { extensions: [bare({})] }).action(dispatch);
  },
  'not-a-descriptor': () =>
    withPlugin(named('@loomcli/help', { extensions: [{ identity: '@fixture/forged' }] })),
  'not-a-plugin': () =>
    new Application('app', { plugins: [{ identity: '@loomcli/help' }] }).action(dispatch),
  'not-an-extension': () => {
    const globals = new GlobalOptions();
    const get = new Command('get', { extensions: [{ identity: 'forged' }], globals }).action(
      dispatch,
    );
    return new Application('app', { globals }).command(get).action(dispatch);
  },
  'option-boolean-default': () =>
    withPlugin(named('@loomcli/log', { options: { level: { default: 'warn', type: 'boolean' } } })),
  'option-global-key': () =>
    new Application('app', {
      globals: new GlobalOptions().option('help', { type: 'boolean' }),
      plugins: [named('@loomcli/help', { options: { help: { type: 'boolean' } } })],
    }).action(dispatch),
  'option-not-declaration': () => withPlugin(named('@loomcli/log', { options: { level: null } })),
  'option-raw-default': () =>
    withPlugin(named('@loomcli/log', { options: { level: { default: 7, type: 'string' } } })),
  'option-required': () =>
    withPlugin(named('@loomcli/log', { options: { level: { required: true, type: 'string' } } })),
  'option-spelling': () =>
    new Application('app', {
      globals: new GlobalOptions().option('host', { short: 'h', type: 'string' }),
      plugins: [named('@loomcli/help', { options: { help: { short: 'h', type: 'boolean' } } })],
    }).action(dispatch),
  'option-validate': () =>
    withPlugin(
      named('@loomcli/log', {
        options: { level: { type: 'string', validate: z.string() } },
      }),
    ),
  'option-validate-omitted': () =>
    withPlugin(
      named('@loomcli/log', {
        options: { level: { type: 'string', validateOmitted: true } },
      }),
    ),
  'options-not-object': () => withPlugin(named('@loomcli/log', { options: 'level' })),
  'output-accessor': () =>
    withOutput(
      '@fixture/output/accessor',
      output(Object.defineProperty({}, 'note', { enumerable: true, get: () => 'read' })),
    ),
  'output-cycle': () => {
    const cycle = { note: 'read' };
    cycle.self = cycle;
    return withOutput('@fixture/output/cycle', output(cycle));
  },
  'output-hidden': () =>
    withOutput(
      '@fixture/output/hidden',
      output(Object.defineProperty({ note: 'read' }, 'quiet', { enumerable: false, value: 1 })),
    ),
  'output-infinite': () =>
    withOutput('@fixture/output/infinite', output({ ratio: Number.POSITIVE_INFINITY })),
  'output-nan': () => withOutput('@fixture/output/nan', output({ ratio: Number.NaN })),
  // A hole reads as the `undefined` the walk rejects, so the hole is the fixture.
  // oxlint-disable-next-line eslint/no-sparse-arrays
  'output-sparse': () => withOutput('@fixture/output/sparse', output([, 'read'])),
  'output-symbol': () => withOutput('@fixture/output/symbol', output({ [Symbol('note')]: 'read' })),
  'plugin-renderers': () =>
    withPlugin(
      named('@loomcli/help', {
        failures: [
          renderFailure(InputError, { render: () => 'one\n' }),
          renderFailure(InputError, { render: () => 'two\n' }),
        ],
      }),
    ),
  'plugins-not-array': () => new Application('app', { plugins: 'help' }).action(dispatch),
  'root-extensions': () =>
    new Application('app', { extensions: [{ identity: '@fixture/forged' }] }).action(dispatch),
  'schema-silent': () => withOutput('@fixture/schema/silent', () => ({ issues: [] })),
  'schema-thenable': () =>
    // A hand-written thenable is exactly the value this rule rejects, so the shape is the fixture.
    // oxlint-disable-next-line unicorn/no-thenable
    withOutput('@fixture/schema/thenable', () => ({ then: () => undefined })),
  'schema-throws': () =>
    withOutput('@fixture/schema/throws', () => {
      throw new Error('the schema threw');
    }),
  'twice-on-one': () => {
    const globals = new GlobalOptions();
    const get = new Command('get', {
      extensions: [facts.command({ details: 'one' }), facts.command({ details: 'two' })],
      globals,
    }).action(dispatch);
    return new Application('app', { globals }).command(get).action(dispatch);
  },
  'twin-descriptors': () => {
    const globals = new GlobalOptions();
    const get = new Command('get', { extensions: [twin({ details: 'one' })], globals }).action(
      dispatch,
    );
    return new Application('app', {
      globals,
      plugins: [named('@fixture/facts', { extensions: [facts.command] })],
    })
      .command(get)
      .action(dispatch);
  },
  'two-plugin-keys': () =>
    new Application('app', {
      plugins: [
        named('@loomcli/log', { options: { verbose: { type: 'boolean' } } }),
        named('@acme/trace', { options: { verbose: { type: 'boolean' } } }),
      ],
    }).action(dispatch),
  'wrong-target': () => {
    const globals = new GlobalOptions();
    const get = new Command('get', {
      extensions: [facts.option({ placeholder: 'path' })],
      globals,
    }).action(dispatch);
    return new Application('app', { globals }).command(get).action(dispatch);
  },
};

/** The shortest application that installs one plugin, for a rule the plugin alone carries. */
function withPlugin(installed) {
  return new Application('app', { plugins: [installed] }).action(dispatch);
}

const build = scenarios[process.argv[2]];
const mode = process.argv[3];

if (mode === 'inspect') {
  try {
    build().inspect();
    process.stdout.write('inspected\n');
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'declaration' : 'other';
    process.stdout.write(`${kind}:${error.exitCode}: ${error.message}\n`);
  }
} else {
  const code = await build().run({ host: { argv: [] } });
  process.stdout.write(`resolved:${code}\n`);
}
