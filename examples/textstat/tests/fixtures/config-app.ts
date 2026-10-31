import { Application, InputError, override } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import type { ConfigurationSettings } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { integer } from '@loomcli/validators';
import { z } from 'zod';

const schema = z.record(z.string(), z.unknown());

/** The settings a case installs the configuration plugin with, beside the schema the app supplies. */
export type Settings = Omit<ConfigurationSettings<typeof schema, 'project'>, 'schema'>;

/** The choices that shape the application: the path of the `limit` option, and the InputError view. */
export interface Choices {
  readonly limitPath?: string;
  readonly settings?: Settings;
  /** `input` overrides the InputError view so a source's problems print as JSON. */
  readonly view?: 'input';
}

/**
 * An application named textstat, built from public APIs alone, that installs the configuration
 * plugin with the settings given, or with none beside a loose schema.
 * It binds textstat's two options as textstat does, and adds a multiple option, a string option,
 * and an option whose path a case chooses, then prints the options its action receives.
 */
export function configApp({ limitPath = 'limits.bytes', settings = {}, view }: Choices = {}) {
  const views =
    view === 'input'
      ? [override(InputError, { render: (failure) => `${JSON.stringify(failure.problems)}\n` })]
      : [];
  return new Application('textstat', {
    plugins: [configuration({ ...settings, schema }).plugin],
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
      extensions: [configInput({ path: limitPath })],
      type: 'string',
    })
    .action(({ options, out }) => out.print(JSON.stringify(options)));
}
