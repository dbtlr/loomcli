/*
 * Whether man finds the installed pages, read from MANPATH and PATH, and the line that sets
 * MANPATH for an operator whose man will not. The plugin never edits a startup file.
 */
import { join } from 'node:path';

import { fishQuoted } from '../completion/name.js';

/** The folder `man` searches, the parent of the pages' `man1`, and the line that adds it. */
interface Advice {
  readonly folder: string;
  readonly line: string;
}

/** An entry with one trailing `/` removed, unless the entry is the root alone. */
function withoutSlash(entry: string): string {
  return entry !== '/' && entry.endsWith('/') ? entry.replace(/\/$/u, '') : entry;
}

/** Whether an entry of `PATH` maps to the folder: `<home>/.local/bin`, with a trailing `/` removed. */
function pathMaps(home: string, path: string | undefined): boolean {
  const bin = join(home, '.local', 'bin');
  return (path ?? '').split(':').some((entry) => withoutSlash(entry) === bin);
}

/**
 * Whether `man` finds `<home>/.local/share/man`: with `MANPATH` unset or empty and `PATH` mapping
 * to it, with `MANPATH` listing it, or with `MANPATH` holding an empty entry, which both `man`
 * programs read as their default search, and `PATH` mapping to it.
 */
function manFinds(home: string, env: Readonly<Record<string, string | undefined>>): boolean {
  const folder = join(home, '.local', 'share', 'man');
  const maps = pathMaps(home, env.PATH);
  const manpath = env.MANPATH;
  if (manpath === undefined || manpath === '') {
    return maps;
  }
  const entries = manpath.split(':');
  if (entries.some((entry) => withoutSlash(entry) === folder)) {
    return true;
  }
  return entries.includes('') && maps;
}

/** The folder in double quotes, with each `"`, `\`, `$`, and backtick escaped with a `\`. */
function doubleQuoted(folder: string): string {
  return folder.replaceAll(/["$\\`]/gu, (character) => `\\${character}`);
}

/** Whether the login shell is Fish: the last segment of `SHELL`, after the last `/` or `\`. */
function isFish(shell: string | undefined): boolean {
  return /(?:^|[/\\])fish$/u.test(shell ?? '');
}

/**
 * The advice for an install, or none when `man` finds the pages: the folder, and the line that
 * puts it first on `MANPATH`, leaving a trailing colon when `MANPATH` was unset so the default
 * search still follows.
 */
function advice(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): Advice | undefined {
  if (manFinds(home, env)) {
    return undefined;
  }
  const folder = join(home, '.local', 'share', 'man');
  const line = isFish(env.SHELL)
    ? `set -gx MANPATH ${fishQuoted(folder)} "$MANPATH"`
    : `export MANPATH="${doubleQuoted(folder)}:\${MANPATH-}"`;
  return { folder, line };
}

export { advice };
