/*
 * Where each agent target keeps its skills: the global folders under the operator's home, and the
 * real paths two folders resolve to, so a link between them is seen.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { applicationDirectory } from '@loomcli/core';
import type { Host } from '@loomcli/core';

import { errorCode } from '../installation/disk.js';
import { refusals } from './messages.js';

/** The agents the plugin installs for, in the order every child follows. */
const targets = ['claude', 'agents'] as const;

type Target = (typeof targets)[number];

/** The targets a child acts on: the one `--agent` names, or both. */
function selectedTargets(agent: Target | undefined): readonly Target[] {
  return agent === undefined ? targets : [agent];
}

/** The name of the variable that holds the home folder on a platform. */
function homeVariable(platform: string): 'HOME' | 'USERPROFILE' {
  return platform === 'win32' ? 'USERPROFILE' : 'HOME';
}

/** The absolute home folder the host's environment names, or none. */
function homeOf(host: Host): string | undefined {
  const home = host.env[homeVariable(host.platform)];
  return home !== undefined && isAbsolute(home) ? home : undefined;
}

/** The absolute `CLAUDE_CONFIG_DIR` the host's environment names, or none. */
function claudeConfigOf(host: Host): string | undefined {
  const directory = host.env.CLAUDE_CONFIG_DIR;
  return directory !== undefined && isAbsolute(directory) ? directory : undefined;
}

/** The skills directory of a target under the operator's home, or none when no home names it. */
function skillsDirectory(target: Target, host: Host): string | undefined {
  const configured = target === 'claude' ? claudeConfigOf(host) : undefined;
  if (configured !== undefined) {
    return join(configured, 'skills');
  }
  const home = homeOf(host);
  return home === undefined ? undefined : join(home, `.${target}`, 'skills');
}

/** One target's global skills directory. */
interface Place {
  readonly target: Target;
  readonly directory: string;
}

/**
 * The global skills directory of each selected target, or the refusal of a home folder that is not
 * an absolute path when a selected target needs one.
 */
function globalPlaces(name: string, host: Host, selected: readonly Target[]): readonly Place[] {
  return selected.map((target) => {
    const directory = skillsDirectory(target, host);
    if (directory === undefined) {
      throw refusals.home(name, homeVariable(host.platform));
    }
    return { directory, target };
  });
}

/** The installation record's directory, or the refusal of an environment that cannot name one. */
function recordDirectory(name: string, host: Host): string {
  const directory = applicationDirectory('installation', name, host);
  if ('variable' in directory) {
    throw refusals.recordDirectory(name, directory.variable);
  }
  return directory.path;
}

/** Whether a runtime error says the path, or a part of it, does not exist. */
function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * The real path of `path` through the nearest ancestor that exists: that ancestor is resolved
 * through every link, and the parts below it that do not exist are kept as they are.
 */
function realPath(path: string, below: readonly string[] = []): string {
  try {
    return join(realpathSync(path), ...below);
  } catch (error) {
    const parent = dirname(path);
    if (!isMissing(error) || parent === path) {
      throw error;
    }
    return realPath(parent, [basename(path), ...below]);
  }
}

/**
 * The real path of a skill folder: its directory resolved through every link, and its own name
 * kept as it is, because installing replaces a link at the folder and never follows it.
 */
function realFolder(folder: string): string {
  return join(realPath(dirname(folder)), basename(folder));
}

export type { Place, Target };
export {
  globalPlaces,
  homeOf,
  realFolder,
  realPath,
  recordDirectory,
  selectedTargets,
  skillsDirectory,
  targets,
};
