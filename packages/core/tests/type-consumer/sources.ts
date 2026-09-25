import { Application, Command, extension, plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';
import { z } from 'zod';

/** The binding a configuration plugin defines: the key an option reads in its settings. */
const settingKey = extension('@fixture/settings/key', { schema: z.string(), target: 'option' });
const commandKey = extension('@fixture/settings/command', {
  schema: z.string(),
  target: 'command',
});

// A plugin option binds a variable its author names, a string and a Boolean alike.
const declared = {
  config: { env: 'SETTINGS_FILE', type: 'string' },
  verbose: { env: 'VERBOSE', type: 'boolean' },
} satisfies PluginOptions;

type SettingsOptions = typeof declared;

// The entry module annotates its factory, which breaks the type cycle with the resolver module.
function settings(): Plugin<SettingsOptions> {
  return plugin('@fixture/settings', {
    extensions: [settingKey],
    options: declared,
    source: { binding: settingKey, load: () => import('./sources-resolver.js') },
  });
}

// A string option, a Boolean option under each polarity, and a global option bind a variable.
const bound = new Application('bound', { plugins: [settings()] })
  .globalOption('limit', { env: 'BOUND_LIMIT', extensions: [settingKey('limit')], type: 'string' })
  .option('total', { env: 'BOUND_TOTAL', type: 'boolean' })
  .option('quiet', { env: 'BOUND_QUIET', polarity: 'negative', type: 'boolean' })
  .option('color', { env: 'BOUND_COLOR', polarity: 'both', type: 'boolean' })
  .action(({ options }) => {
    const limit: string | undefined = options.limit;
    const total: boolean = options.total;
    return [limit, total];
  });

// A multiple option takes its list from the configuration source, so it binds no variable.
// @ts-expect-error TS2345: A multiple option declares no env.
const listed = new Command('listed').option('fields', {
  env: 'FIELDS',
  multiple: true,
  type: 'string',
});

// @ts-expect-error TS2322: A multiple plugin option declares no env either.
const tags = { tags: { env: 'TAGS', multiple: true, type: 'string' } } satisfies PluginOptions;

// An argument is identified by its place among bare tokens, so it cannot bind.
// @ts-expect-error TS2353: An argument config declares no env.
const positional = new Command('positional').argument('path', { env: 'PATH_TO' });

// @ts-expect-error TS2322: A variable name is a string.
const numbered = new Command('numbered').option('limit', { env: 7, type: 'string' });

// The binding is an option-target descriptor.
const misbound = plugin('@fixture/misbound', {
  extensions: [commandKey],
  // @ts-expect-error TS2322: A Command-target descriptor cannot bind options.
  source: { binding: commandKey, load: async () => ({ default: async () => ({}) }) },
});

export type { SettingsOptions };
export { bound, listed, misbound, numbered, positional, settingKey, settings, tags };
