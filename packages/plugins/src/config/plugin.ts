import { checkShortSetting, plugin } from '@loomcli/core';
import type { Plugin, PluginOptions, StringOption } from '@loomcli/core';

import { configInput } from './extension.js';
import { configIdentity as identity } from './names.js';
import { fileCandidates } from './pattern.js';

const options = {
  config: { description: 'Read configuration from this file alone.', type: 'string' },
} satisfies PluginOptions;

export type ConfigOptions = typeof options;

/** What an application tells the configuration plugin: the file it looks for, and the short spelling of `--config`. */
export interface ConfigSettings {
  /** The configuration file's name or relative path, a file pattern. Defaults to `.<app>.json`. */
  readonly file?: string;
  /** The short spelling of `--config`, none by default. */
  readonly short?: NonNullable<StringOption['short']>;
}

/**
 * The configuration plugin, the first-party configuration source. It answers the configuration tier
 * from one JSON, TOML, or YAML file per run: the file `--config` names, or else the first found of
 * the settings' `file` in the working directory and then in the home directory. It judges the
 * settings at the call, `short` under core's rules and then `file`, which it reads once. The
 * resolver module loads only when core calls the source.
 */
export function config(settings?: ConfigSettings): Plugin<ConfigOptions> {
  checkShortSetting(settings, { call: 'config', option: 'config', plugin: identity });
  const short = settings?.short;
  const candidates = fileCandidates(settings);
  return plugin(identity, {
    extensions: [configInput],
    options: { config: { ...options.config, ...(short === undefined ? {} : { short }) } },
    source: {
      binding: configInput,
      load: async () => {
        const { configSource } = await import('./source.js');
        return { default: configSource(candidates) };
      },
    },
  });
}
