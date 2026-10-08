import { Application, InputError, override } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { integer } from '@loomcli/validators';

/**
 * An application named textstat, built from public APIs alone, that installs the configuration
 * plugin with the settings the first argument holds as JSON, or with none when it reads "none".
 * It binds textstat's two options as textstat does, and adds a multiple option, a string option,
 * and an option whose path `FIXTURE_PATH` chooses, then prints the options its action receives.
 * The second argument is the host's working directory, and `FIXTURE_VIEWS=input` overrides the
 * InputError view so a source's problems print as JSON. A fault at a call prints its rule.
 */
const [settings, cwd, ...argv] = process.argv.slice(2);

const views =
  process.env.FIXTURE_VIEWS === 'input'
    ? [override(InputError, { render: (failure) => `${JSON.stringify(failure.problems)}\n` })]
    : [];

try {
  const app = new Application('textstat', {
    plugins: [config(settings === 'none' ? undefined : JSON.parse(settings))],
    views,
  })
    .option('min-bytes', {
      default: '0',
      env: 'TEXTSTAT_MIN_BYTES',
      extensions: [configInput({ path: 'minBytes' })],
      type: 'string',
      validate: integer({ min: 0 }),
    })
    .option('total', {
      env: 'TEXTSTAT_TOTAL',
      extensions: [configInput({ path: 'total' })],
      type: 'boolean',
    })
    .option('field', {
      extensions: [configInput({ path: 'fields' })],
      multiple: true,
      type: 'string',
    })
    .option('note', { extensions: [configInput({ path: 'note' })], type: 'string' })
    .option('limit', {
      default: 'none',
      extensions: [configInput({ path: process.env.FIXTURE_PATH ?? 'limits.bytes' })],
      type: 'string',
    })
    .action(({ options, out }) => out.print(JSON.stringify(options)));
  const platform = process.env.FIXTURE_PLATFORM;
  await app.run({
    host: {
      argv,
      cwd,
      release: { build: 'distributed' },
      ...(platform === undefined ? {} : { platform }),
    },
  });
} catch (error) {
  process.stdout.write(`${error.name}: ${error.rule?.identity ?? error.message}\n`);
}
