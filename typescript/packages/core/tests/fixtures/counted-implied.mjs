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

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, env: fixtureEnv, stdout: writeStdout } = fixture;
  try {
    const [scenario, mode, ...argv] = words;

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
            const held = JSON.parse(fixtureEnv.FIXTURE_SETTINGS ?? '{}');
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
          writeStdout(`validated:${validationContext(options)?.phase}:${value}\n`);
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
            writeStdout(`supplied:${JSON.stringify(context.supplied.options)}\n`);
          }
          return { value };
        },
        vendor: 'probe',
        version: 1,
      },
    };

    /** Every action prints the path it ran on and the values it received. */

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
        description: 'Copy files.',
        plugins: [settings],
        views: mode === 'facts' ? [override(UsageError, facts)] : [],
      })
        .argument('files', { description: 'The files to copy.', variadic: true })
        .option('total', { description: 'Print a total.', short: 't', type: 'boolean' })
        .option('verbose', {
          aliases: ['chatty'],
          description: 'Print more.',
          env: 'VERBOSE',
          extensions: [settingKey('verbose')],
          short: 'v',
          type: 'count',
        })
        .option('backup', {
          description: 'Keep a backup.',
          env: 'BACKUP',
          extensions: [settingKey('backup')],
          implied: 'simple',
          short: 'b',
          type: 'string',
          validate: controls,
        })
        .option('suffix', {
          default: '~',
          description: 'The backup suffix.',
          implied: '.bak',
          type: 'string',
        })
        .option('tag', {
          description: 'Tag a copy.',
          implied: 'all',
          multiple: true,
          short: 'g',
          type: 'string',
        })
        .option('probe', {
          description: 'Probe the supplied tokens.',
          type: 'string',
          validate: probe,
          validateOmitted: true,
        })
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
      return new Application('rejected', {
        description: 'Reject an implied value.',
      })
        .globalOption('color', {
          description: 'Color the output.',
          implied: 'sometimes',
          type: 'string',
          validate: controls,
        })
        .action(report([]));
    }

    /** The config of one option of each value class, implying `value` where the class implies one. */
    const classes = {
      boolean: () => ({ type: 'boolean' }),
      count: () => ({ type: 'count' }),
      implied: (value) => ({ implied: value, type: 'string' }),
      separate: () => ({ type: 'string' }),
    };

    /**
     * Declares the four spellings `--boolean`, `--count`, `--implied`, and `--separate`, each with the
     * class `kindOf` names for it.
     */
    function declareAll(declarer, kindOf, implied) {
      return Object.keys(classes).reduce(
        // Each spelling's short alias is its name's first letter, whichever class declares it.
        (declared, name) =>
          declared.option(name, { ...classes[kindOf(name)](implied), short: name.charAt(0) }),
        declarer,
      );
    }

    /**
     * A root with an action and children, whose own options each have one of the four value classes,
     * and a child named for each class that declares all four spellings with that class alone, so a
     * parent's own option meets every pairing of classes.
     */
    function rebind() {
      const root = declareAll(
        new Application('rebind', { views: [override(UsageError, facts)] }),
        (name) => name,
        'parent',
      );
      return Object.keys(classes)
        .reduce(
          (app, kind) =>
            app.command(
              declareAll(new Command(kind).argument('path', {}), () => kind, 'child').action(
                report([kind]),
              ),
            ),
          root,
        )
        .action(report([]));
    }

    const applications = { copyit, fetchit, rebind, rejected };

    const app = applications[scenario]();
    if (mode === 'inspect') {
      const { globals, root } = app.inspect();
      const options = [
        ...globals,
        ...root.options,
        ...root.children.flatMap((child) => child.options),
      ];
      writeStdout(`${JSON.stringify(options)}\n`);
    } else if (mode === 'locate') {
      const position = locate(app.inspect(), argv);
      const counts = position.counts && Object.fromEntries(position.counts);
      writeStdout(
        `${JSON.stringify({ counts, kind: position.kind, lead: position.lead, option: position.option?.name, prefix: position.prefix, supplied: position.supplied })}\n`,
      );
    } else {
      const code = await app.run({ process: createProcess({ argv }) });
      writeStdout(`resolved:${code}\n`);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

function report(command) {
  return ({ args, options, out }) => out.print(`run:${JSON.stringify({ args, command, options })}`);
}

export { runFixture as run };
