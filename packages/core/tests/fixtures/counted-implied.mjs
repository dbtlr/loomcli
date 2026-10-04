import {
  Application,
  Command,
  extension,
  locate,
  override,
  plugin,
  UsageError,
  validationContext,
} from '@loomcli/core';
import { z } from 'zod';

const [scenario, mode, ...argv] = process.argv.slice(2);

/** What a usage failure carries and the path routing reached, so a test reads both. */
const facts = {
  render: (failure, { path }) =>
    `${JSON.stringify({
      commands: failure.commands,
      message: failure.message,
      name: failure.name,
      path,
      spelling: failure.spelling,
    })}\n`,
};

/** The fixture source's binding: the key an option reads in the settings `FIXTURE_SETTINGS` holds. */
const settingKey = extension('@fixture/settings/key', { schema: z.string(), target: 'option' });

/** A configuration source that answers each requested option its settings hold, under its key. */
const settings = plugin('@fixture/settings', {
  extensions: [settingKey],
  source: {
    binding: settingKey,
    load: () => ({
      default: async ({ requests }) => {
        const held = JSON.parse(process.env.FIXTURE_SETTINGS ?? '{}');
        const answers = {};
        for (const request of requests) {
          const key = request.extensions['@fixture/settings/key'];
          if (Object.hasOwn(held, key)) {
            answers[request.name] = { label: `${key} in settings`, value: held[key] };
          }
        }
        return answers;
      },
    }),
  },
});

/**
 * The backup controls, each read as its upper-case output, so a test tells the validator's output
 * from the raw value. Each call prints its phase and the value it received.
 */
const controls = {
  '~standard': {
    validate: (value, options) => {
      process.stdout.write(`validated:${validationContext(options)?.phase}:${value}\n`);
      return ['none', 'simple', 'numbered'].includes(value)
        ? { value: value.toUpperCase() }
        : { issues: [{ message: 'Use none, simple, or numbered.' }] };
    },
    vendor: 'probe',
    version: 1,
  },
};

/** A validator that receives the omission and prints the raw tokens every declared input received. */
const probe = {
  '~standard': {
    validate: (value, options) => {
      const context = validationContext(options);
      if (context?.phase === 'invocation') {
        process.stdout.write(`supplied:${JSON.stringify(context.supplied.options)}\n`);
      }
      return { value };
    },
    vendor: 'probe',
    version: 1,
  },
};

/** Every action prints the path it ran on and the values it received. */
function report(command) {
  return ({ args, options, out }) => out.print(`run:${JSON.stringify({ args, command, options })}`);
}

/** A plugin whose global option counts, and whose hook gives `get` a counted option of its own. */
const quiet = plugin('@fixture/quiet', {
  onCommandAttach: (command) =>
    command.name === 'get' ? command.option('depth', { short: 'd', type: 'count' }) : command,
  options: { quiet: { short: 'q', type: 'count' } },
});

/**
 * A leaf application: a Boolean `-t`, a counted `-v` with an alias and a binding, `backup` implying
 * `simple` with short alias `b`, `suffix` implying `.bak` beside a default, and the multiple `tag`
 * implying `all` with short alias `g`.
 */
function copyit() {
  return new Application('copyit', {
    packet: { build: 'development' },
    plugins: [settings],
    views: mode === 'facts' ? [override(UsageError, facts)] : [],
  })
    .argument('files', { variadic: true })
    .option('total', { short: 't', type: 'boolean' })
    .option('verbose', {
      aliases: ['chatty'],
      env: 'VERBOSE',
      extensions: [settingKey('verbose')],
      short: 'v',
      type: 'count',
    })
    .option('backup', {
      env: 'BACKUP',
      extensions: [settingKey('backup')],
      implied: 'simple',
      short: 'b',
      type: 'string',
      validate: controls,
    })
    .option('suffix', { default: '~', implied: '.bak', type: 'string' })
    .option('tag', { implied: 'all', multiple: true, short: 'g', type: 'string' })
    .option('probe', { type: 'string', validate: probe, validateOmitted: true })
    .action(report([]));
}

/** A global counted `-v`, a plugin's counted `-q`, and a hook's counted `-d` on `get`. */
function fetchit() {
  return new Application('fetchit', {
    plugins: [quiet],
    views: mode === 'facts' ? [override(UsageError, facts)] : [],
  })
    .globalOption('verbose', { short: 'v', type: 'count' })
    .command(new Command('get').argument('path', {}).action(report(['get'])))
    .action(report([]));
}

/** A global string option implying a value, judged before any token is read. */
function rejected() {
  return new Application('rejected', { packet: { build: 'development' } })
    .globalOption('color', { implied: 'sometimes', type: 'string', validate: controls })
    .action(report([]));
}

/**
 * A root with an action and children, whose own options each have one of the four value classes,
 * and two children that declare the same spellings, one with the same classes and one with others.
 */
function rebind() {
  const same = new Command('same')
    .argument('path', {})
    .option('flag', { short: 'f', type: 'boolean' })
    .option('verbose', { short: 'v', type: 'count' })
    .option('backup', { implied: 'numbered', short: 'b', type: 'string' })
    .option('name', { short: 'n', type: 'string' })
    .action(report(['same']));
  const other = new Command('other')
    .argument('path', {})
    .option('flag', { short: 'f', type: 'count' })
    .option('verbose', { short: 'v', type: 'boolean' })
    .option('backup', { short: 'b', type: 'string' })
    .option('name', { implied: 'x', short: 'n', type: 'string' })
    .action(report(['other']));
  return new Application('rebind', { views: [override(UsageError, facts)] })
    .option('flag', { short: 'f', type: 'boolean' })
    .option('verbose', { short: 'v', type: 'count' })
    .option('backup', { implied: 'simple', short: 'b', type: 'string' })
    .option('name', { short: 'n', type: 'string' })
    .command(same)
    .command(other)
    .action(report([]));
}

const applications = { copyit, fetchit, rebind, rejected };

const app = applications[scenario]();
if (mode === 'inspect') {
  const { globals, root } = app.inspect();
  const options = [...globals, ...root.options, ...root.children.flatMap((child) => child.options)];
  process.stdout.write(`${JSON.stringify(options)}\n`);
} else if (mode === 'locate') {
  const position = locate(app.inspect(), argv);
  process.stdout.write(
    `${JSON.stringify({ kind: position.kind, lead: position.lead, option: position.option?.name, prefix: position.prefix, supplied: position.supplied })}\n`,
  );
} else {
  const code = await app.run({ host: { argv } });
  process.stdout.write(`resolved:${code}\n`);
}
