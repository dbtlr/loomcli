import { plugin, provider } from '@loomcli/core';
import type {
  Host,
  Plugin,
  PluginOptions,
  PluginOptionValues,
  Provider,
  StandardSchemaV1,
  StringOption,
} from '@loomcli/core';

import { configInput } from './extension.js';
import { judgeLinks } from './links.js';
import { configIdentity as identity } from './names.js';
import { envVariable, fileCandidates } from './pattern.js';
import { pointerListingSchema } from './pointer.js';
import type { EmptyFileGuard } from './schema-types.js';
import type { Loaded } from './shared.js';

const options = {
  config: {
    control: true,
    description: 'Read configuration from this file alone.',
    type: 'string',
  },
  'no-config': {
    control: true,
    description: 'Read no configuration file.',
    type: 'boolean',
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

/**
 * The options the plugin declares: `--config`, `--no-config`, and the directory option when
 * `directory` names one.
 */
type ConfigOptions<Directory extends string = never> = typeof options &
  Readonly<Record<Directory, { readonly description: string; readonly type: 'string' }>>;

/**
 * What an application tells the configuration plugin: the schema of its file, the file it looks
 * for, and how an operator points the lookup elsewhere.
 */
interface ConfigurationSettings<Schema extends StandardSchemaV1, Directory extends string = never> {
  /** One Standard Schema for the whole file. Every key is optional outside an array item or a record value. */
  readonly schema: Schema & EmptyFileGuard<Schema>;
  /** The configuration file's name or relative path, a file pattern. Defaults to `.<app>.json`. */
  readonly file?: string;
  /** The short spelling of `--config`, none by default. */
  readonly short?: Short;
  /** A variable that names the configuration file, none by default. */
  readonly env?: string;
  /**
   * A global option whose value is where the lookup's walk starts, none by default. A directory
   * option named `config` or `no-config` would claim the plugin's own spelling, so the type
   * rejects it.
   */
  readonly directory?: DirectorySetting<Directory> &
    ([Extract<'config' | 'no-config', Directory>] extends [never]
      ? unknown
      : { readonly name: never });
  /** Write one line when the lookup finds no file. Off by default. */
  readonly notice?: boolean;
}

/**
 * The plugin's options for the settings: `--config`, with the short spelling the settings give,
 * `--no-config`, and the directory option when they declare one.
 */
function declaredOptions<const Directory extends string>(settings: {
  readonly short?: Short;
  readonly directory?: DirectorySetting<Directory>;
}): ConfigOptions<Directory> {
  const { short } = settings;
  const configOption = { ...options.config, ...(short === undefined ? {} : { short }) };
  const { directory } = settings;
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
  // It holds because the only key added is `directory.name`, the `Directory` the settings were inferred from, and the type rejects `config` and `no-config`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { ...options, config: configOption, ...declared } as ConfigOptions<Directory>;
}

/** The provider of the validated configuration, read as `provided.config`. */
type ConfigProvider<Schema extends StandardSchemaV1, Directory extends string> = Provider<
  'config',
  StandardSchemaV1.InferOutput<Schema>,
  PluginOptionValues<ConfigOptions<Directory>>
>;

/** What `configuration()` returns: the plugin the Application installs, and the provider a Command opts in to. */
interface Configuration<Schema extends StandardSchemaV1, Directory extends string> {
  /** The plugin the Application installs. */
  readonly plugin: Plugin<ConfigOptions<Directory>>;
  /** The validated configuration, read as provided.config. */
  readonly values: ConfigProvider<Schema, Directory>;
}

/**
 * The configuration plugin and the provider that reads it, built from one settings object. The
 * plugin answers the configuration tier from one JSON, TOML, or YAML file per run, and from none
 * under `--no-config`: the file `--config` names, or else the file the settings' `env` variable
 * names, or else the first found of the settings' `file` in the walk from the start directory up to
 * the home directory, in the home directory, and in the user folder. The provider hands
 * application code the schema's output for that file, after the plugin has dropped every value the
 * schema rejects. The call judges the settings' `file` and `env`, which it reads once. The resolver
 * and the opener load only when core calls them, and they share one read per run, keyed by the
 * run's host.
 */
function configuration<
  const Schema extends StandardSchemaV1,
  const Directory extends string = never,
>(settings: ConfigurationSettings<Schema, Directory>): Configuration<Schema, Directory> {
  const shared = {
    candidates: fileCandidates(settings),
    directory: settings.directory?.name,
    env: envVariable(settings),
    notice: settings.notice === true,
    reads: new WeakMap<Host, Promise<Loaded<Schema>>>(),
    schema: settings.schema,
  };
  const installed: Plugin<ConfigOptions<Directory>> = plugin(identity, {
    extensions: [configInput],
    onGraphBuilt: judgeLinks,
    options: declaredOptions<Directory>(settings),
    source: {
      binding: configInput,
      load: async () => {
        const { configSource } = await import('./source.js');
        return { default: configSource<Schema, Directory>(shared) };
      },
      schema: pointerListingSchema(settings.schema),
    },
  });
  const values: ConfigProvider<Schema, Directory> = provider('config', {
    load: async () => {
      const { configOpener } = await import('./opener.js');
      return { default: configOpener<Schema, Directory>(shared) };
    },
  });
  return { plugin: installed, values };
}

export { configuration };
export type {
  ConfigOptions,
  ConfigProvider,
  Configuration,
  ConfigurationSettings,
  DirectorySetting,
};
export type { ConfigurationSchemaMustAcceptAnEmptyFile, EmptyFileGuard } from './schema-types.js';
