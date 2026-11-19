import { realpathSync } from 'node:fs';

import { isNpmPackageName, packageManagerInstallation } from '@loomcli/core';
import type { ReleaseFacts } from '@loomcli/core';

import { isChannelName } from './version.js';

/** The facts that give a command once the message supplies a version or dist-tag. */
type UpgradeCommand =
  | { readonly method: 'script'; readonly name: string }
  | { readonly method: 'brew'; readonly formula: string }
  | { readonly method: 'npm'; readonly pkg: string };

const formulaName = /^[a-z0-9][a-z0-9+.@_-]*$/u;

/** The npm ranges that fit in a single SemVer prerelease identifier. */
const npmChannelRange = /^v*(?:\d+|[xX])$/u;

/** Whether npm can read a release channel as a dist-tag in an install command. */
function isNpmDistTag(channel: string): boolean {
  return isChannelName(channel) && !npmChannelRange.test(channel);
}

/**
 * The installation that owns the running binary, which the refusal and the notice both read. A
 * matching script record whose path resolves into a Cellar or npm's global root reads as that
 * package manager's installation, and any other installation, or a path that no longer resolves,
 * reads as recorded.
 */
function effectiveInstallation(
  { installation }: ReleaseFacts,
  platform: string,
): ReleaseFacts['installation'] {
  if (installation?.method !== 'script') {
    return installation;
  }
  try {
    return packageManagerInstallation(realpathSync(installation.path), platform) ?? installation;
  } catch {
    return installation;
  }
}

/** The installation's upgrade command, when its facts give one safe to print as plain words. */
function upgradeCommand(
  name: string,
  { installation, release }: ReleaseFacts,
): UpgradeCommand | undefined {
  switch (installation?.method) {
    case 'script': {
      return release?.asset !== undefined && installation.digest !== undefined
        ? { method: 'script', name }
        : undefined;
    }
    case 'brew': {
      const { formula } = installation;
      return formula !== undefined && formulaName.test(formula)
        ? { formula, method: 'brew' }
        : undefined;
    }
    case 'npm': {
      const pkg = release?.npmPackage;
      return pkg !== undefined && isNpmPackageName(pkg) ? { method: 'npm', pkg } : undefined;
    }
    default: {
      return undefined;
    }
  }
}

export type { UpgradeCommand };
export { effectiveInstallation, isNpmDistTag, upgradeCommand };
