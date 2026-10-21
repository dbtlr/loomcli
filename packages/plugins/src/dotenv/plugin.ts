import { DeclarationError, plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

import { packageName } from '../constants.js';
import { dotenvVariableName } from '../rules.js';
import { isVariableName } from '../variable-name.js';
import { readDotenv } from './read.js';

/**
 * Which names the plugin imports. With no settings it imports every name `.env` defines; `only`
 * imports the names it lists, and `except` imports every name but the ones it lists.
 */
type DotenvSettings =
  | { readonly only: readonly string[]; readonly except?: never }
  | { readonly except: readonly string[]; readonly only?: never };

const notFound = -1;

function listedNames(key: 'except' | 'only', names: readonly string[]): ReadonlySet<string> {
  const invalid = names.findIndex((name) => !isVariableName(name));
  if (invalid !== notFound) {
    throw new DeclarationError(dotenvVariableName, {
      correction:
        'Name each variable with a letter or underscore followed by letters, digits, or underscores, such as API_TOKEN.',
      findings: [
        { arguments: [{ [key]: names }], call: 'dotenv', mark: `0.${key}.${String(invalid)}` },
      ],
      sentence: `Plugin "${packageName}/dotenv" setting "${key}" lists a name that is not an environment variable name.`,
    });
  }
  return new Set(names);
}

/** Whether the plugin imports a name, from the one list the settings give. */
function importedNames(settings: DotenvSettings | undefined): (name: string) => boolean {
  if (settings?.only !== undefined) {
    const only = listedNames('only', settings.only);
    return (name) => only.has(name);
  }
  if (settings?.except !== undefined) {
    const except = listedNames('except', settings.except);
    return (name) => !except.has(name);
  }
  return () => true;
}

/** Imports the variables the working directory's .env file defines that the process has not set. */
export function dotenv(settings?: DotenvSettings): Plugin {
  const imports = importedNames(settings);
  return plugin(`${packageName}/dotenv`, {
    onEnvironment: (context) => readDotenv(context, imports),
  });
}

export type { DotenvSettings };
