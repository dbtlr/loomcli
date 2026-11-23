/*
 * The self-update plugin's wording, under ADR-0200's wording modules: the command lines and manager
 * names that sentences of `messages.ts` repeat, which a translation does not rebuild.
 * `tests/message-voice.test.ts` reads this module as a message module.
 */
import { escapeControlCharacters } from '@loomcli/core';

import type { PackageManagerMethod, UpgradeCommand } from './upgrade.js';

const shown = escapeControlCharacters;

/** A registry installer's install command, a fixed spelling that takes a package and a version. */
function registryInstall(method: Exclude<PackageManagerMethod, 'brew'>): string {
  return {
    bun: 'bun add -g',
    npm: 'npm install -g',
    pnpm: 'pnpm add -g',
    yarn: 'yarn global add',
  }[method];
}

/** The command a notice or a refusal tells the operator to run, escaped, with the version or dist-tag it names. */
function upgradeCommandLine(command: UpgradeCommand, version: string): string {
  switch (command.method) {
    case 'brew': {
      return `brew upgrade ${shown(command.formula)}`;
    }
    case 'script': {
      return `${shown(command.name)} self-update`;
    }
    default: {
      return `${registryInstall(command.method)} ${shown(command.pkg)}@${shown(version)}`;
    }
  }
}

/** The display name of a package manager. */
function managerName(method: PackageManagerMethod): string {
  return { brew: 'Homebrew', bun: 'Bun', npm: 'npm', pnpm: 'pnpm', yarn: 'Yarn' }[method];
}

export { managerName, upgradeCommandLine };
