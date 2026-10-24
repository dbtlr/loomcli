import {
  Application,
  Command,
  DeclarationError,
  extension,
  plugin,
  processHandle,
} from '@loomcli/core';
import { z } from 'zod';

import { declare } from '../declare.mjs';
import { ruleText } from '../rule-text.mjs';

const dispatch = ({ out }) => out.print('dispatched');

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

/** The whole view a value result names, so a hook reshapes a record that already holds one. */
const text = { render: (value) => `${value}\n` };

/** The plugin every hook row names, whose hook one scenario supplies. */
function formatter(onCommandAttach) {
  return named('@loomcli/plugins/format', { onCommandAttach });
}

/** A hook that acts on the `count` Command alone, so the root passes through unchanged. */
function onCount(act) {
  return (command) => (command.name === 'count' ? act(command) : command);
}

/** The option every hook collision row declares. */
function declaresFormat(command) {
  return command.option('format', { type: 'string' });
}

/** The argument every hook argument collision row declares. */
function declaresTag(command) {
  return command.argument('tag', {});
}

/** The option every hook argument collision row against an option declares, named to match. */
function declaresTagOption(command) {
  return command.option('tag', { type: 'string' });
}

/** The Command a hook reshapes: one value result under one declared view. */
function counted() {
  return new Command('count').result({ views: { text } }).action(dispatch);
}

/** One application whose plugins carry hooks, over the `count` Command each row names. */
function withHooks(plugins, count = counted()) {
  return new Application('app', { plugins }).command(count).action(dispatch);
}

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
  'async-schema': () => {
    const descriptor = extension('@fixture/async', {
      schema: asynchronous,
      target: 'command',
    });
    return new Application('app', { extensions: [descriptor({})] }).action(dispatch);
  },
  'exotic-output': () => {
    const descriptor = extension('@fixture/exotic', { schema: exotic, target: 'command' });

    const get = new Command('get', { extensions: [descriptor({})] }).action(dispatch);
    return new Application('app').command(get).action(dispatch);
  },
  'hook-argument-author-collision': () =>
    withHooks(
      [formatter(onCount(declaresTag))],
      new Command('count').argument('tag', {}).result({ views: { text } }).action(dispatch),
    ),
  'hook-argument-collision': () =>
    withHooks(
      [formatter(onCount(declaresFormat))],
      new Command('count').argument('format', {}).action(dispatch),
    ),
  'hook-argument-global-collision': () =>
    new Application('app', { plugins: [formatter(onCount(declaresTag))] })
      .globalOption('tag', { type: 'string' })
      .command(counted())
      .action(dispatch),
  'hook-argument-hook-collision': () =>
    withHooks([
      named('@acme/out', { onCommandAttach: onCount(declaresTag) }),
      formatter(onCount(declaresTag)),
    ]),
  'hook-argument-hook-option-collision': () =>
    withHooks([
      named('@acme/out', { onCommandAttach: onCount(declaresTagOption) }),
      formatter(onCount(declaresTag)),
    ]),
  'hook-argument-local-collision': () =>
    withHooks(
      [formatter(onCount(declaresTag))],
      new Command('count').option('tag', { type: 'string' }).action(dispatch),
    ),
  'hook-argument-plugin-collision': () =>
    withHooks([
      named('@acme/out', { options: { tag: { type: 'string' } } }),
      formatter(onCount(declaresTag)),
    ]),
  'hook-global-collision': () =>
    new Application('app', { plugins: [formatter(onCount(declaresFormat))] })
      .globalOption('format', { type: 'string' })
      .command(counted())
      .action(dispatch),
  'hook-hook-collision': () =>
    withHooks([
      named('@acme/out', { onCommandAttach: onCount(declaresFormat) }),
      formatter(onCount(declaresFormat)),
    ]),
  'hook-late-option': () =>
    withHooks([formatter(onCount(declaresFormat))], new Command('count').action(dispatch)),
  'hook-local-collision': () =>
    withHooks(
      [formatter(onCount(declaresFormat))],
      new Command('count').option('format', { type: 'string' }).action(dispatch),
    ),
  'hook-plugin-collision': () =>
    withHooks([
      named('@acme/out', { options: { format: { type: 'string' } } }),
      formatter(onCount(declaresFormat)),
    ]),
  'hook-spelling-collision': () =>
    new Application('app', {
      plugins: [
        formatter(onCount((command) => command.option('format', { short: 'f', type: 'string' }))),
      ],
    })
      .globalOption('file', { short: 'f', type: 'string' })
      .command(counted())
      .action(dispatch),
  'hook-throws': () =>
    withHooks([
      formatter(
        onCount(() => {
          throw new Error('the hook broke');
        }),
      ),
    ]),
  'hook-throws-declaration': () =>
    withHooks([
      formatter(
        onCount(() => {
          throw new DeclarationError(
            'Plugin "@loomcli/plugins/format" requires a result on Command "count". Declare one or omit the plugin.',
          );
        }),
      ),
    ]),
  installed: () => withPlugin(named('@loomcli/help', {})),
  'installed-twice': () =>
    new Application('app', {
      plugins: [named('@loomcli/help', {}), named('@loomcli/help', {})],
    }).action(dispatch),
  'invalid-value': () => {
    const get = new Command('get', {
      extensions: [facts.command({ details: 7 })],
    }).action(dispatch);
    return new Application('app').command(get).action(dispatch);
  },
  'local-key': () => {
    const get = new Command('get').option('help', { type: 'boolean' }).action(dispatch);
    return new Application('app', {
      plugins: [named('@loomcli/help', { options: { help: { type: 'boolean' } } })],
    })
      .command(get)
      .action(dispatch);
  },
  'option-global-key': () =>
    new Application('app', {
      plugins: [named('@loomcli/help', { options: { help: { type: 'boolean' } } })],
    })
      .globalOption('help', { type: 'boolean' })
      .action(dispatch),
  'option-spelling': () =>
    new Application('app', {
      plugins: [named('@loomcli/help', { options: { help: { short: 'h', type: 'boolean' } } })],
    })
      .globalOption('host', { short: 'h', type: 'string' })
      .action(dispatch),
  // A plugin's option meets every rule an option declaration meets, so its validator is a schema.
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
  'schema-sentence': () =>
    withOutput('@fixture/schema/sentence', () => ({ issues: [{ message: 'Supply one word.' }] })),
  'schema-silent': () => withOutput('@fixture/schema/silent', () => ({ issues: [] })),
  'schema-throws': () =>
    withOutput('@fixture/schema/throws', () => {
      throw new Error('the schema threw');
    }),
  // An empty claim leaves the slot free, so the second plugin owns it and the build succeeds.
  'signals-empty-claim': () =>
    new Application('app', {
      plugins: [
        named('@loomcli/signals', { signals: [] }),
        named('@acme/trace', { signals: ['SIGINT'] }),
      ],
    }).action(dispatch),
  'signals-second-claim': () =>
    new Application('app', {
      plugins: [
        named('@loomcli/signals', { signals: ['SIGINT', 'SIGTERM'] }),
        named('@acme/trace', { signals: ['SIGINT'] }),
      ],
    }).action(dispatch),
  'twin-descriptors': () => {
    const get = new Command('get', { extensions: [twin({ details: 'one' })] }).action(dispatch);
    return new Application('app', {
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
};

/** The shortest application that installs one plugin, for a rule the plugin alone carries. */
function withPlugin(installed) {
  return new Application('app', { plugins: [installed] }).action(dispatch);
}

const app = declare(scenarios[process.argv[2]]);
const mode = process.argv[3];

if (mode === 'rule') {
  try {
    app.inspect();
    process.stdout.write('inspected\n');
  } catch (error) {
    process.stdout.write(`${error.rule?.identity ?? 'none'}\n`);
  }
} else if (mode === 'inspect') {
  try {
    app.inspect();
    process.stdout.write('inspected\n');
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'declaration' : 'other';
    process.stdout.write(`${kind}:${error.exitCode}: ${ruleText(error)}\n`);
  }
} else {
  const code = await app.run({
    process: processHandle({ argv: [], release: { build: 'distributed' } }),
  });
  process.stdout.write(`resolved:${code}\n`);
}
