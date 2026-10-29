import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions, StringOption } from '@loomcli/core';

import { configInput } from './extension.js';
import { configIdentity as identity } from './names.js';
import { envVariable, fileCandidates } from './pattern.js';

const options = {
  config: {
    control: true,
    description: 'Read configuration from this file alone.',
    type: 'string',
  },
} satisfies PluginOptions;

const directoryDescription = 'Look for the configuration file from this directory.';

type Short = NonNullable<StringOption['short']>;

/** A global option whose value is where the lookup's walk starts. */
interface DirectorySetting<Name extends string> {
  /** The global option's name: `'project'` declares `--project`. */
  readonly name: Name;
  /** Its short spelling, none by default. */
  readonly short?: Short;
  /** Its description. Defaults to `Look for the configuration file from this directory.` */
  readonly description?: string;
}

/** The options the plugin declares: `--config`, and the directory option when `directory` names one. */
type ConfigOptions<Directory extends string = never> = typeof options &
  Readonly<Record<Directory, { readonly description: string; readonly type: 'string' }>>;

/** What an application tells the configuration plugin: the file it looks for, and how an operator points the lookup elsewhere. */
interface ConfigSettings<Directory extends string = never> {
  /** The configuration file's name or relative path, a file pattern. Defaults to `.<app>.json`. */
  readonly file?: string;
  /** The short spelling of `--config`, none by default. */
  readonly short?: Short;
  /** A variable that names the configuration file, none by default. */
  readonly env?: string;
  /**
   * A global option whose value is where the lookup's walk starts, none by default. A directory
   * option named `config` would claim `--config`'s spelling, so the type rejects it.
   */
  readonly directory?: DirectorySetting<Directory> &
    ('config' extends Directory ? { readonly name: never } : unknown);
  /** Write one line when the lookup finds no file. Off by default. */
  readonly notice?: boolean;
}

/**
 * The plugin's options for the settings: `--config`, with the short spelling the settings give, and
 * the directory option when they declare one.
 */
function declaredOptions<const Directory extends string>(
  settings: ConfigSettings<Directory> | undefined,
): ConfigOptions<Directory> {
  const short = settings?.short;
  const configOption = { ...options.config, ...(short === undefined ? {} : { short }) };
  const directory = settings?.directory;
  const declared =
    directory === undefined
      ? {}
      : {
          [directory.name]: {
            description: directory.description ?? directoryDescription,
            type: 'string',
            ...(directory.short === undefined ? {} : { short: directory.short }),
          },
        };
  // Last resort: no typed path exists, because TypeScript types a computed key as a string index and cannot map the generic `Directory` onto it.
  // It holds because the only key added is `directory.name`, the `Directory` the settings were inferred from, and the type rejects `config`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { config: configOption, ...declared } as ConfigOptions<Directory>;
}

/**
 * The configuration plugin, the first-party configuration source. It answers the configuration tier
 * from one JSON, TOML, or YAML file per run: the file `--config` names, or else the file the
 * settings' `env` variable names, or else the first found of the settings' `file` in the walk from
 * the start directory up to the home directory, in the home directory, and in the user folder. It
 * judges the settings' `file` and `env` at the call, which it reads once. The resolver module loads
 * only when core calls the source.
 */
function config<const Directory extends string = never>(
  settings?: ConfigSettings<Directory>,
): Plugin<ConfigOptions<Directory>> {
  const candidates = fileCandidates(settings);
  const env = envVariable(settings);
  const directory = settings?.directory?.name;
  const notice = settings?.notice === true;
  return plugin(identity, {
    extensions: [configInput],
    options: declaredOptions(settings),
    source: {
      binding: configInput,
      load: async () => {
        const { configSource } = await import('./source.js');
        return { default: configSource({ candidates, directory, env, notice }) };
      },
    },
  });
}

export { config };
export type { ConfigOptions, ConfigSettings, DirectorySetting };
