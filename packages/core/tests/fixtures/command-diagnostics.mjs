import { Application, Command, DeclarationError, plugin } from '@loomcli/core';

const act = () => undefined;
const leaf = (name) => new Command(name).action(act);
const render = () => '';
const row = () => '';

/** The value every unreadable config throws, so a test reads that the fault keeps it as its cause. */
const boom = new Error('boom');

/** A validator that accepts any value, which is what lets a default hold an object. */
const anyValue = {
  '~standard': { validate: (value) => ({ value }), vendor: 'fixture', version: 1 },
};

/**
 * One faulty declaration per scenario. Each throws a declaration fault whose rule the Command and
 * naming family declares, and the fixture prints the diagnostic its message holds.
 */
const scenarios = {
  'alias-after-action': () => new Command('keys').action(act).alias('ls'),
  'alias-own-name': () => new Command('keys').alias('ls', 'keys'),
  'alias-portable': () => new Command('keys').alias('ls', 'bad name'),
  'alias-without-names': () => new Command('keys').alias(),
  'app-option-config': () => new Application('probe').option('format'),
  'application-description': () => new Application('probe', { description: '  ' }),
  'application-hidden': () => new Application('probe', { hidden: true }),
  'application-name': () => new Application('bad name'),
  'application-options': () => new Application('probe', 'fast'),
  'application-version': () => new Application('probe', { version: 1 }),
  'argument-after-optional': () => new Command('keys').argument('path', {}).argument('name', {}),
  'argument-beside-child': () =>
    new Command('store').command(leaf('get')).argument('files', { variadic: true }),
  'argument-config': () => new Command('get').argument('path', 'text'),
  'argument-hidden': () => new Command('get').argument('path', { hidden: true }),
  'argument-name': () => new Command('get').argument('-path', {}),
  'argument-twice': () =>
    new Command('get').argument('path', { required: true }).argument('path', {}),
  'argument-unreadable': () =>
    new Command('get').argument('path', {
      get default() {
        throw boom;
      },
    }),
  'attached-twice': () => {
    const clear = leaf('clear');
    return new Application('probe')
      .command(new Command('cache').command(clear))
      .command(new Command('tmp').command(clear));
  },
  'child-after-action': () => new Application('probe').action(act).command(leaf('get')),
  'child-beside-argument': () => new Command('store').argument('files', {}).command(leaf('get')),
  'child-without-action': () => new Command('store').command(new Command('get')),
  'command-deprecated': () => new Command('fetch', { deprecated: true }),
  'command-description': () => new Command('get', { description: 'Read\none value.' }),
  'command-globals': () => new Command('get', { globals: {} }),
  'command-hidden': () => new Command('fetch', { hidden: 'yes' }),
  'command-name': () => new Command('bad name'),
  'command-options': () => new Command('get', 'fast'),
  'global-option-config': () => new Application('probe').globalOption('quiet', null),
  'global-option-unreadable': () =>
    new Application('probe').globalOption('quiet', {
      get default() {
        throw boom;
      },
      type: 'string',
    }),
  'group-option': () =>
    new Command('store').command(
      new Command('cache').option('verbose', { type: 'boolean' }).command(leaf('clear')),
    ),
  'hook-argument-config': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/format', {
          onCommandAttach: (command) =>
            command.name === 'count' ? command.argument('path') : command,
        }),
      ],
    })
      .command(leaf('count'))
      .inspect(),
  'hook-option-config': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/format', {
          onCommandAttach: (command) =>
            command.name === 'count' ? command.option('format') : command,
        }),
      ],
    })
      .command(leaf('count'))
      .inspect(),
  'hook-option-unreadable': () =>
    new Application('probe', {
      plugins: [
        plugin('@acme/format', {
          onCommandAttach: (command) =>
            command.name === 'count'
              ? command.option('format', {
                  get default() {
                    throw boom;
                  },
                  type: 'string',
                })
              : command,
        }),
      ],
    })
      .command(leaf('count'))
      .inspect(),
  'multiple-actions': () => new Command('get').action(act).action(act),
  'multiple-results': () =>
    new Command('get').result({ views: { plain: { render } } }).rows({ views: { lines: { row } } }),
  'nesting-depth': () => new Command('cache').command(new Command('clear').command(leaf('all'))),
  'not-a-command': () => new Command('store').command({ name: 'get' }),
  'option-after-action': () => new Command('get').action(act).option('raw', { type: 'boolean' }),
  'option-config': () => new Command('get').option('format'),
  'option-default-unreadable': () =>
    new Command('get').option('format', {
      default: {
        get key() {
          throw boom;
        },
      },
      type: 'string',
      validate: anyValue,
    }),
  'option-description': () =>
    new Command('get').option('raw', { description: '', type: 'boolean' }),
  'option-prototype-unreadable': () =>
    new Command('get').option(
      'format',
      new Proxy(
        { type: 'string' },
        {
          getPrototypeOf() {
            throw boom;
          },
        },
      ),
    ),
  'option-unreadable': () =>
    new Command('get').option('format', {
      get default() {
        throw boom;
      },
      type: 'string',
    }),
  'optional-before-required': () =>
    new Command('keys').argument('path', {}).argument('name', { required: true }),
  'plugin-sibling': () =>
    plugin('@acme/doctor', {
      commands: [leaf('check'), new Command('probe').alias('check').action(act)],
    }),
  'result-after-action': () =>
    new Command('get').action(act).result({ views: { plain: { render } } }),
  'result-without-action': () =>
    new Command('store').command(new Command('get').result({ views: { plain: { render } } })),
  'result-without-views': () =>
    new Command('store').command(new Command('get').result({ views: {} }).action(act)),
  'row-view-on-value': () => new Command('get').result({ views: { lines: { row } } }),
  'sibling-alias': () =>
    new Command('store')
      .command(new Command('select').alias('ls').action(act))
      .command(new Command('keys').alias('ls').action(act)),
  'sibling-alias-name': () =>
    new Command('store').command(leaf('get')).command(new Command('keys').alias('get').action(act)),
  'sibling-name': () => new Command('store').command(leaf('get')).command(leaf('get')),
  'sibling-name-alias': () =>
    new Command('store').command(new Command('keys').alias('get').action(act)).command(leaf('get')),
  'unknown-default-view': () =>
    new Command('store').command(
      new Command('get')
        .result({ views: { plain: { render } } })
        .views({}, { default: 'json' })
        .action(act),
    ),
  'variadic-not-last': () =>
    new Command('get').argument('paths', { variadic: true }).argument('path', {}),
  'view-both': () => new Command('get').result({ views: { plain: { render, row } } }),
  'view-name': () => new Command('get').result({ views: { 1: { render } } }),
  'view-not-a-view': () => new Command('get').rows({ views: { lines: 'text' } }),
  'views-without-result': () => new Command('get').views({ plain: { render } }),
};

const scenario = process.argv[2];

if (scenario === 'root-group-option' || scenario === 'root-without-action') {
  // A root fault waits for build, which run() reports with the application name in a development build.
  const app = new Application('probe', { packet: { build: 'development' } });
  const faulty =
    scenario === 'root-group-option'
      ? app.option('verbose', { type: 'boolean' }).command(leaf('get'))
      : app;
  process.exitCode = await faulty.run({ host: { argv: [] } });
} else {
  try {
    scenarios[scenario]();
    process.stdout.write('returned\n');
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    // The cause mode reads whether the fault kept the thrown value itself.
    process.stdout.write(
      process.argv[3] === 'cause'
        ? `${JSON.stringify({ cause: error.cause === boom })}\n`
        : `${error.message}\n`,
    );
  }
}
