import { DeclarationError } from '@loomcli/core';

import { configRootName, configRootWithoutProject } from '../rules.js';
import { configIdentity as identity } from './names.js';

/**
 * A scope the lookup may read: `project`, the walk up from the start directory, or `user`, the
 * home file and then the XDG user file.
 */
type Scope = 'project' | 'user';

/** The settings that choose the scopes and bound the project walk. */
interface ScopeSettings {
  /** The scopes the lookup reads, project before user whatever the order. Defaults to both. */
  readonly scopes?: readonly [Scope, ...Scope[]];
  /** The names whose presence stops the project walk after it looks in that directory, or false for none. */
  readonly root?: string | readonly [string, ...string[]] | false;
}

/** What the lookup reads, judged once at the call. */
interface Reach {
  /** Whether the lookup walks from the start directory. */
  readonly project: boolean;
  /** Whether the lookup reads the home file and the user file. */
  readonly user: boolean;
  /** The entry names whose presence ends the walk after the directory that holds one. */
  readonly markers: readonly string[];
}

/** Whether a name is one path segment: nonempty, with no `/` or `\`, and neither `.` nor `..`. */
function isEntryName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\]/u.test(name);
}

/** The fault of one `configuration(settings)` call, which rebuilds the call and marks a place in its `root`. */
function rootFault(settings: unknown, mark: string, fault: 'name' | 'scope'): DeclarationError {
  return fault === 'name'
    ? new DeclarationError(configRootName, {
        correction: "Name an entry in the project's root directory, such as package.json or .git.",
        findings: [{ arguments: [settings], call: 'configuration', mark }],
        sentence: `Plugin "${identity}" root is not a file name.`,
      })
    : new DeclarationError(configRootWithoutProject, {
        correction: "Add 'project' to scopes, or remove root.",
        findings: [{ arguments: [settings], call: 'configuration', mark }],
        sentence: `Plugin "${identity}" root bounds a project walk the lookup never takes.`,
      });
}

/** The names `root` gives, as a list: none for an omitted `root` or `false`. */
function rootNames(root: ScopeSettings['root']): readonly string[] {
  if (root === undefined || root === false) {
    return [];
  }
  return typeof root === 'string' ? [root] : root;
}

/** The marker names `root` gives, each judged, marking the first that is not one path segment. */
function markerNames(settings: ScopeSettings): readonly string[] {
  const { root } = settings;
  const names = rootNames(root);
  for (const [index, name] of names.entries()) {
    if (!isEntryName(name)) {
      throw rootFault(
        settings,
        typeof root === 'string' ? '0.root' : `0.root.${String(index)}`,
        'name',
      );
    }
  }
  return names;
}

/**
 * What the settings' `scopes` and `root` let the lookup read, judged at the call. Each is read
 * once. A marker name comes first, then a marker beside scopes that never walk the project.
 */
export function judgeReach(settings: ScopeSettings): Reach {
  const { scopes } = settings;
  const markers = markerNames(settings);
  const project = scopes === undefined || scopes.includes('project');
  const [marker] = markers;
  if (!project && marker !== undefined) {
    throw rootFault(settings, '0.root', 'scope');
  }
  return { markers, project, user: scopes === undefined || scopes.includes('user') };
}

export type { Reach, Scope, ScopeSettings };
