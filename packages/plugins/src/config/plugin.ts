import { DeclarationError, plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { configInput } from './extension.js';

const options = {
  config: { description: 'Read configuration from this file alone.', type: 'string' },
} satisfies PluginOptions;

const identity = `${Package.name}/config`;

/** A file entry: a nonempty path that holds no control character and no line separator. */
const pathEntry = /^[^\p{Cc}\p{Zl}\p{Zp}]+$/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The project files the settings list, checked at the call. A settings value that is not an object
 * and a `files` that is not an array are one fault, and each entry that is not a path names its
 * position, counted from 0.
 */
function checkFiles(settings: unknown): readonly string[] {
  if (settings === undefined) {
    return [];
  }
  const files: unknown = isPlainObject(settings) ? settings.files : settings;
  if (files === undefined) {
    return [];
  }
  if (!Array.isArray(files)) {
    throw new DeclarationError(
      `Plugin "${identity}" files is not a list. Supply an array of paths.`,
    );
  }
  return files.map((entry: unknown, index) => {
    if (typeof entry !== 'string' || !pathEntry.test(entry)) {
      throw new DeclarationError(
        `Plugin "${identity}" file ${index} is not a path. Supply a nonempty path with no control character.`,
      );
    }
    return entry;
  });
}

export type ConfigOptions = typeof options;

/** What an application tells the configuration plugin: the project files it reads, most specific first. */
export interface ConfigSettings {
  readonly files?: readonly string[];
}

/**
 * The configuration plugin, the first-party configuration source. It answers the configuration tier
 * from JSON files: a user file derived from the application name, and the project files `settings`
 * lists, combined key by key with the first listed file winning. `--config` names one file that
 * replaces them all for a run. The resolver module loads only when core calls the source.
 */
export function config(settings?: ConfigSettings): Plugin<ConfigOptions> {
  const files = checkFiles(settings);
  return plugin(identity, {
    extensions: [configInput],
    options,
    source: {
      binding: configInput,
      load: async () => {
        const { configSource } = await import('./source.js');
        return { default: configSource(files) };
      },
    },
  });
}
