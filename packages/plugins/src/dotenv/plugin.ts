import { DeclarationError, plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

import { packageName } from '../constants.js';
import { dotenvVariables } from '../rules.js';
import { readDotenv } from './read.js';

interface DotenvSettings {
  /** The nonempty allowlist of distinct names the plugin may import. */
  readonly variables: readonly string[];
}

const empty = 0;

function readVariables(settings: DotenvSettings | undefined): ReadonlySet<string> {
  const list: unknown = settings?.variables;
  const names = new Set<string>();
  if (Array.isArray(list) && list.length > empty) {
    for (const name of list) {
      if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || names.has(name)) {
        break;
      }
      names.add(name);
    }
    if (names.size === list.length) {
      return names;
    }
  }
  throw new DeclarationError(dotenvVariables, {
    correction:
      'Supply a nonempty variables list of distinct names, each a letter or underscore followed by letters, digits, or underscores.',
    findings: [
      { arguments: settings === undefined ? [] : [settings], call: 'dotenv', mark: '0.variables' },
    ],
    sentence: `Plugin "${packageName}/dotenv" declares an invalid variables allowlist.`,
  });
}

/** Imports only explicitly named variables from the working directory's .env file. */
export function dotenv(settings: DotenvSettings): Plugin {
  const variables = readVariables(settings);
  return plugin(`${packageName}/dotenv`, {
    onEnvironment: (context) => readDotenv(context, variables),
  });
}

export type { DotenvSettings };
