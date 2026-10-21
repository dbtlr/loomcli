/*
 * Where each agent target keeps its skills: the global folders under the operator's home, and the
 * real paths two folders resolve to, so a link between them is seen.
 */
import { basename, dirname, isAbsolute, join } from 'node:path';

import type { Host } from '@loomcli/core';

import { homeOf, homeRefusal } from '../application-folders.js';
import { realPath } from '../installation/disk.js';

/** The agents the plugin installs for, in the order every child follows. */
const targets = ['claude', 'agents'] as const;

type Target = (typeof targets)[number];

/** The targets a child acts on: the one `--agent` names, or both. */
function selectedTargets(agent: Target | undefined): readonly Target[] {
  return agent === undefined ? targets : [agent];
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
      throw homeRefusal(name);
    }
    return { directory, target };
  });
}

/**
 * The real path of a skill folder: its directory resolved through every link, and its own name
 * kept as it is, because installing replaces a link at the folder and never follows it.
 */
function realFolder(folder: string): string {
  return join(realPath(dirname(folder)), basename(folder));
}

export type { Place, Target };
export { globalPlaces, realFolder, selectedTargets, skillsDirectory, targets };
