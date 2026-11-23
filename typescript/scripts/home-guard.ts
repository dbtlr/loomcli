/**
 * A guard for Loom's own test suite: it snapshots what the installing plugins and the logging
 * plugin write under a home, and names every entry a run added or changed there. It records names
 * and modification times only, never contents.
 */
import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * The application names Loom's fixtures, examples, and packed consumers run under that install or
 * log: an entry is Loom's when a word of its name, split at `.`, `-`, and `_`, is one of these.
 * Keep it in step with a new fixture that installs files or logs.
 */
const fixtureNames: ReadonlySet<string> = new Set([
  'app',
  'copyit',
  'doctor',
  'explain',
  'fetchit',
  'heimdall',
  'jsonkit',
  'kit',
  'notes',
  'packed',
  'probe',
  'textstat',
]);

/** The rc files the completion plugin adds a line to. */
const rcFiles = ['.bashrc', '.zshrc', '.config/fish/config.fish', '.profile', '.bash_profile'];

/** The folders the installing plugins and the logging plugin write an application's entries into. */
const watchedFolders = [
  '.agents/skills',
  '.cache',
  '.claude/skills',
  '.config/fish/completions',
  '.config/systemd/user',
  '.local/share',
  '.local/share/man/man1',
  '.local/state',
  'Library/Application Support',
  'Library/Caches',
  'Library/LaunchAgents',
  'Library/Logs',
];

/** How deep the guard walks into an entry named after a fixture application. */
const depth = 4;

/** Every path the guard watches under one home, with its modification time. */
type HomeSnapshot = ReadonlyMap<string, { readonly mtimeMs: number; readonly top: string }>;

/** Whether a name is one of Loom's fixture applications', by any word of it. */
function isFixtureName(name: string): boolean {
  return name.split(/[.\-_]/u).some((word) => fixtureNames.has(word));
}

/** The modification time of a path, or none when nothing is there. */
function mtimeOf(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** The names a folder holds, or none when it cannot be read. */
function namesIn(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

/** Records a path and, for a folder, every path beneath it to the guard's depth. */
function walk(
  path: string,
  top: string,
  level: number,
  into: Map<string, { mtimeMs: number; top: string }>,
): void {
  const mtimeMs = mtimeOf(path);
  if (mtimeMs === undefined) {
    return;
  }
  into.set(path, { mtimeMs, top });
  if (level < depth) {
    for (const name of namesIn(path)) {
      walk(join(path, name), top, level + 1, into);
    }
  }
}

/** The rc files and every entry named after a fixture application under one home. */
function homeSnapshot(home: string): HomeSnapshot {
  const into = new Map<string, { mtimeMs: number; top: string }>();
  for (const file of rcFiles) {
    const path = join(home, file);
    const mtimeMs = mtimeOf(path);
    if (mtimeMs !== undefined) {
      into.set(path, { mtimeMs, top: path });
    }
  }
  for (const folder of watchedFolders) {
    for (const name of namesIn(join(home, folder)).filter((entry) => isFixtureName(entry))) {
      const top = join(home, folder, name);
      walk(top, top, 1, into);
    }
  }
  return into;
}

/**
 * The paths a run added or changed between two snapshots: a new or changed rc file, a new entry
 * named after a fixture application, and, inside an entry that existed before, a new or changed
 * file whose own name is a fixture application's. Another application's files inside an entry it
 * owns, such as its database, are not Loom's.
 */
function homeChanges(before: HomeSnapshot, after: HomeSnapshot): string[] {
  return [...after]
    .filter(([path, { mtimeMs, top }]) => {
      const earlier = before.get(path);
      if (earlier?.mtimeMs === mtimeMs) {
        return false;
      }
      if (path === top) {
        // A folder another application owns changes as it works.
        // So a folder that was there before the run is not Loom's.
        return earlier === undefined || !statSync(path).isDirectory();
      }
      return before.has(top) && isFixtureName(basename(path));
    })
    .map(([path]) => path);
}

export { homeChanges, homeSnapshot };
export type { HomeSnapshot };
