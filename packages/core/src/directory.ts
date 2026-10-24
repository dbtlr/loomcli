import { isAbsolute, join } from 'node:path';

import type { Host } from './types.js';

/**
 * The directories of an application core resolves: its installation record, its logs, and its
 * cache, which holds data the application can lose.
 */
type ApplicationDirectory = 'installation' | 'logs' | 'cache';

/** The absolute directory, or the variable it needs that is unset, empty, or not absolute. */
type DirectoryLookup = { readonly path: string } | { readonly variable: string };

/** A variable's value when it is an absolute path by the running process's rules. */
function absoluteVariable(env: Host['env'], name: string): string | undefined {
  const value = env[name];
  return value !== undefined && isAbsolute(value) ? value : undefined;
}

/**
 * The directory under the home, or `HOME`, the variable an operator sets to fix it, when the home
 * is empty or not an absolute path.
 */
function underHome(home: string, segments: readonly string[]): DirectoryLookup {
  return isAbsolute(home) ? { path: join(home, ...segments) } : { variable: 'HOME' };
}

/** The folder under `<home>/Library` on darwin, for each kind. */
const darwinFolders: Readonly<Record<ApplicationDirectory, string>> = {
  cache: 'Caches',
  installation: 'Application Support',
  logs: 'Logs',
};

/**
 * The XDG base directory each kind lives under on any other platform, and the directory under
 * `$HOME` that stands in for an unset, empty, or relative one.
 */
function xdgBase(kind: ApplicationDirectory): {
  readonly variable: string;
  readonly home: string[];
} {
  return kind === 'cache'
    ? { home: ['.cache'], variable: 'XDG_CACHE_HOME' }
    : { home: ['.local', 'state'], variable: 'XDG_STATE_HOME' };
}

/**
 * The directory an application keeps its installation record, its logs, or its cache in, resolved
 * from a run's `env`, `home`, and `platform` alone. Darwin keeps it under `<home>/Library`, and
 * every other platform under the XDG base directories from `env`, an absolute one winning, and
 * the home. The home is `from.home`, the run's `host.home`, never `HOME` in `env`. The running
 * process's path rules judge an absolute path and join the segments. It reads no file and creates
 * nothing.
 */
function applicationDirectory(
  kind: ApplicationDirectory,
  application: string,
  from: { readonly env: Host['env']; readonly home: string; readonly platform: string },
): DirectoryLookup {
  const { env, home, platform } = from;
  const segments = kind === 'installation' ? [application, 'installation'] : [application];
  switch (platform) {
    case 'darwin': {
      return underHome(home, ['Library', darwinFolders[kind], ...segments]);
    }
    default: {
      const base = xdgBase(kind);
      const absolute = absoluteVariable(env, base.variable);
      return absolute === undefined
        ? underHome(home, [...base.home, ...segments])
        : { path: join(absolute, ...segments) };
    }
  }
}

export type { ApplicationDirectory, DirectoryLookup };
export { applicationDirectory };
