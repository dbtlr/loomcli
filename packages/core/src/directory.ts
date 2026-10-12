import { isAbsolute, join } from 'node:path';

import type { Host } from './types.js';

/** The directories of an application core resolves: its installation record and its logs. */
type ApplicationDirectory = 'installation' | 'logs';

/** The absolute directory, or the variable it needs that is unset, empty, or not absolute. */
type DirectoryLookup = { readonly path: string } | { readonly variable: string };

/** A variable's value when it is an absolute path by the running process's rules. */
function absoluteVariable(env: Host['env'], name: string): string | undefined {
  const value = env[name];
  return value !== undefined && isAbsolute(value) ? value : undefined;
}

/** The directory under one variable, or that variable's name when it cannot give it. */
function under(env: Host['env'], name: string, segments: readonly string[]): DirectoryLookup {
  const base = absoluteVariable(env, name);
  return base === undefined ? { variable: name } : { path: join(base, ...segments) };
}

/**
 * The directory an application keeps its installation record or its logs in, resolved from a
 * run's `env` and `platform` alone. The platform chooses the row and its variables; the running
 * process's path rules judge an absolute path and join the segments. It reads no file and creates
 * nothing.
 */
function applicationDirectory(
  kind: ApplicationDirectory,
  application: string,
  from: { readonly env: Host['env']; readonly platform: string },
): DirectoryLookup {
  const { env, platform } = from;
  const installation = kind === 'installation';
  switch (platform) {
    case 'darwin': {
      return under(
        env,
        'HOME',
        installation
          ? ['Library', 'Application Support', application, 'installation']
          : ['Library', 'Logs', application],
      );
    }
    case 'win32': {
      return under(env, 'LOCALAPPDATA', [application, installation ? 'installation' : 'Logs']);
    }
    default: {
      const segments = installation ? [application, 'installation'] : [application];
      const state = absoluteVariable(env, 'XDG_STATE_HOME');
      return state === undefined
        ? under(env, 'HOME', ['.local', 'state', ...segments])
        : { path: join(state, ...segments) };
    }
  }
}

export type { ApplicationDirectory, DirectoryLookup };
export { applicationDirectory };
