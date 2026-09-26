import { Application, InputError, override } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { help } from '@loomcli/plugins/help';
import { z } from 'zod';

const digits = z.string().regex(/^[0-9]+$/u, 'Supply a whole number.');

/** The settings each scenario installs the configuration plugin with. */
const settings = {
  absolute: () => ({ files: [process.env.FIXTURE_ABSOLUTE] }),
  'bad-entry': () => ({ files: ['ok.json', 7] }),
  'bad-list': () => ({ files: '.app.json' }),
  'control-entry': () => ({ files: [`ok${String.fromCodePoint(1)}.json`] }),
  'list-settings': () => ['.app.json'],
  none: () => undefined,
  'not-object': () => 5,
  project: () => ({ files: ['.app.json', 'shared/app.json'] }),
  twice: () => ({ files: ['.app.json', './.app.json'] }),
};

const print =
  (label) =>
  ({ options, out }) =>
    out.print(`${label}:${JSON.stringify(options)}`);

/** The view overrides a test installs, so a source's InputError problems reach one. */
const views = {
  input: [override(InputError, { render: (failure) => `${JSON.stringify(failure.problems)}\n` })],
  none: [],
};

/** Every value shape and spelling the plugin's rules touch, bound to dotted paths. */
function application(scenario) {
  const bound = scenario === 'bad-path' ? 'a..b' : 'limits.bytes';
  return (
    new Application('app', {
      plugins: [config(settings[scenario]?.()), help()],
      views: views[process.env.FIXTURE_VIEWS ?? 'none'],
    })
      .globalOption('level', {
        description: 'The log level.',
        env: 'FIXTURE_LEVEL',
        extensions: [configInput({ path: 'log.level' })],
        type: 'string',
      })
      .option('limit', {
        default: '10',
        description: 'The limit.',
        env: 'FIXTURE_LIMIT',
        extensions: [configInput({ path: bound })],
        type: 'string',
        validate: digits,
      })
      .option('total', {
        description: 'Add a total.',
        extensions: [configInput({ path: 'total' })],
        type: 'boolean',
      })
      .option('quiet', {
        description: 'Say less.',
        extensions: [configInput({ path: 'quiet' })],
        polarity: 'negative',
        type: 'boolean',
      })
      .option('fields', {
        description: 'The fields.',
        extensions: [configInput({ path: 'fields' })],
        multiple: true,
        type: 'string',
      })
      .option('title', {
        description: 'The title.',
        extensions: [configInput({ path: 'title' })],
        type: 'string',
      })
      // A path of Object.prototype member names, which only an own key may answer.
      .option('owner', {
        description: 'The owner.',
        extensions: [configInput({ path: 'constructor.name' })],
        type: 'string',
      })
      .action(print('root'))
  );
}

const [scenario, mode, ...argv] = process.argv.slice(2);

/** The host overrides a test sets: the platform, and the working directory the files resolve in. */
function host() {
  const overrides = { argv };
  if (process.env.FIXTURE_PLATFORM !== undefined) {
    overrides.platform = process.env.FIXTURE_PLATFORM;
  }
  if (process.env.FIXTURE_CWD !== undefined) {
    overrides.cwd = process.env.FIXTURE_CWD;
  }
  return overrides;
}

try {
  if (mode === 'inspect') {
    process.stdout.write(`${JSON.stringify(application(scenario).inspect())}\n`);
  } else {
    const code = await application(scenario).run({ host: host() });
    process.stdout.write(`resolved:${code}\n`);
  }
} catch (error) {
  process.stdout.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 3;
}
