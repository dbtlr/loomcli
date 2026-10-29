import { Application, InputError, override, processHandle } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { integer } from '@loomcli/validators';
import { z } from 'zod';

/**
 * An application named textstat, built from public APIs alone, that installs the configuration
 * plugin with the settings the first argument holds as JSON, or with none beside a loose schema
 * when it reads "none".
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

const schema = z.record(z.string(), z.unknown());

try {
  const app = new Application('textstat', {
    plugins: [
      configuration({ ...(settings === 'none' ? {} : JSON.parse(settings)), schema }).plugin,
    ],
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
  await app.run({ process: processHandle({ argv, cwd }) });
} catch (error) {
  process.stdout.write(`${error.name}: ${error.rule?.identity ?? error.message}\n`);
}
