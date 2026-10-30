import { Application, Command, extension, plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';
import { z } from 'zod';

/** The binding a configuration plugin defines: the key an option reads in its settings. */
const settingKey = extension('@fixture/settings/key', { schema: z.string(), target: 'option' });
const commandKey = extension('@fixture/settings/command', {
  schema: z.string(),
  target: 'command',
});

// A plugin's option binds a variable its author names, a string and a Boolean alike.
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

// A multiple option binds a variable only beside the delimiter its author declares.
// @ts-expect-error TS2345: A multiple option that binds env declares an envDelimiter.
const listed = new Command('listed').option('fields', {
  env: 'FIELDS',
  multiple: true,
  type: 'string',
});

// @ts-expect-error TS2322: A plugin's multiple option declares an envDelimiter beside env too.
const tags = { tags: { env: 'TAGS', multiple: true, type: 'string' } } satisfies PluginOptions;

// A multiple string option and a multiple content option each bind a list, one name or several.
const split = new Command('split')
  .option('fields', { env: 'FIELDS', envDelimiter: ',', multiple: true, type: 'string' })
  .option('paths', {
    env: ['PATHS', 'OLD_PATHS'],
    envDelimiter: ':',
    multiple: true,
    type: 'content',
  })
  .action(({ options }) => {
    const fields: string[] = options.fields;
    return fields;
  });

// The delimiter belongs to a multiple option that binds a variable and to nothing else.
// @ts-expect-error TS2345: A multiple option without env declares no envDelimiter.
const unbound = new Command('unbound').option('fields', {
  envDelimiter: ',',
  multiple: true,
  type: 'string',
});

// @ts-expect-error TS2345: An option that is not multiple declares no envDelimiter.
const single = new Command('single').option('field', {
  env: 'FIELD',
  envDelimiter: ',',
  type: 'string',
});

// @ts-expect-error TS2345: A Boolean option declares no envDelimiter.
const flag = new Command('flag').option('total', {
  env: 'TOTAL',
  envDelimiter: ',',
  type: 'boolean',
});

// A scalar string option that binds a variable may let an empty value supply it.
const allowing = new Command('allowing')
  .option('prefix', { env: 'APP_PREFIX', envAllowEmpty: true, type: 'string' })
  .option('suffix', { env: ['APP_SUFFIX', 'OLD_SUFFIX'], envAllowEmpty: false, type: 'string' })
  .option('tag', {
    env: 'APP_TAG',
    envAllowEmpty: true,
    required: 'non-interactive',
    type: 'string',
  });

// A binding whose variable another declaration names, or leaves out, still fits a string option.
declare const named: { env?: string };
const forwarded = new Command('forwarded')
  .option('tag', { ...named, type: 'string' })
  .option('label', { ...named, required: 'non-interactive', type: 'string' });

// @ts-expect-error TS2345: An option that binds no variable declares no envAllowEmpty.
const allowUnbound = new Command('allowUnbound').option('prefix', {
  envAllowEmpty: true,
  type: 'string',
});

// @ts-expect-error TS2345: A multiple option declares no envAllowEmpty.
const allowList = new Command('allowList').option('fields', {
  env: 'FIELDS',
  envAllowEmpty: true,
  envDelimiter: ',',
  multiple: true,
  type: 'string',
});

// @ts-expect-error TS2345: A Boolean option declares no envAllowEmpty.
const allowFlag = new Command('allowFlag').option('total', {
  env: 'TOTAL',
  envAllowEmpty: true,
  type: 'boolean',
});

// @ts-expect-error TS2345: A counted option declares no envAllowEmpty.
const allowCount = new Command('allowCount').option('level', {
  env: 'LEVEL',
  envAllowEmpty: true,
  type: 'count',
});

// @ts-expect-error TS2345: A content option declares no envAllowEmpty.
const allowContent = new Command('allowContent').option('file', {
  env: 'FILE',
  envAllowEmpty: true,
  type: 'content',
});

// An argument is identified by its place among bare tokens, so it cannot bind.
// @ts-expect-error TS2353: An argument config declares no env.
const positional = new Command('positional').argument('path', { env: 'PATH_TO' });

// A binding takes one name or a non-empty list of names, in either declaration form.
const migrated = new Command('migrated')
  .option('region', { env: ['AWS_REGION', 'AWS_DEFAULT_REGION'], type: 'string' })
  .option('debug', { env: ['APP_DEBUG'], type: 'boolean' })
  .option('level', { env: 'APP_LEVEL', type: 'count' });

// @ts-expect-error TS2322: A list names at least one variable.
const nameless = new Command('nameless').option('region', { env: [], type: 'string' });

// @ts-expect-error TS2322: A variable name is a string.
const numbered = new Command('numbered').option('limit', { env: 7, type: 'string' });

// The binding is an option-target descriptor.
const misbound = plugin('@fixture/misbound', {
  extensions: [commandKey],
  // @ts-expect-error TS2322: A Command-target descriptor cannot bind options.
  source: { binding: commandKey, load: async () => ({ default: async () => ({}) }) },
});

// A source declares the Standard Schema of its configuration, whose JSON Schema the graph publishes.
const described = plugin('@fixture/described', {
  extensions: [settingKey],
  source: {
    binding: settingKey,
    load: async () => ({ default: async () => ({}) }),
    schema: z.object({ retries: z.number().optional() }),
  },
});

const undescribed = plugin('@fixture/undescribed', {
  extensions: [settingKey],
  source: {
    binding: settingKey,
    load: async () => ({ default: async () => ({}) }),
    // @ts-expect-error TS2353: A configuration schema is a Standard Schema, not a plain record.
    schema: { retries: 'number' },
  },
});

export type { SettingsOptions };
export {
  allowContent,
  allowCount,
  allowFlag,
  allowList,
  allowUnbound,
  allowing,
  bound,
  described,
  flag,
  forwarded,
  listed,
  migrated,
  misbound,
  nameless,
  numbered,
  positional,
  settingKey,
  settings,
  single,
  split,
  tags,
  unbound,
  undescribed,
};
