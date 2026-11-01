import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { array, minLength, pipe, safeParse, string } from 'valibot';

import { parseManifest } from './manifest.js';
import { readWorkingFile } from './repository.js';

/** The value of `sharedVersion`, checked as one value: a list of nonempty strings. */
const entryList = array(pipe(string(), minLength(1)));

function refuse(entry: string, problem: string): never {
  throw new Error(
    `sharedVersion lists ${entry}, which ${problem}, so correct the entry or the file and cut again.`,
  );
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// The source of a listed file, or the failure naming why the entry cannot carry the version.
function sharedSource(entry: string, path: string) {
  if (!existsSync(path)) {
    return refuse(entry, 'does not exist');
  }
  try {
    return readWorkingFile(dirname(path), basename(path));
  } catch (error) {
    return refuse(entry, `cannot be read: ${describe(error)}`);
  }
}

// The `version` string of a listed file, or the failure naming why it has none.
function sharedVersion(entry: string, source: string, path: string) {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = parseManifest(source, path);
  } catch (error) {
    return refuse(entry, `does not parse: ${describe(error)}`);
  }
  const { version } = parsed;
  return typeof version === 'string' ? version : refuse(entry, 'has no version string');
}

/** A `package.json` that carries the package's version: its absolute path and its source. */
export interface SharedManifest {
  readonly path: string;
  readonly source: string;
}

/**
 * The entries `sharedVersion` holds, or the failure for a value that is not a list of nonempty
 * strings. The configuration file's schema passes the value through as written, so this is the
 * one place it is checked, and a rejected value fails the cut instead of dropping.
 */
export function sharedEntries(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  const parsed = safeParse(entryList, value);
  if (!parsed.success) {
    throw new Error(
      'sharedVersion must be a list of nonempty strings, so list package.json files such as ["../hub/package.json"] in the configuration file.',
    );
  }
  return parsed.output;
}

/**
 * Reads each manifest `sharedVersion` lists, resolved against the package directory. The package's own `package.json` and a repeated file count once. A file that
 * is missing, does not parse, has no `version` string, or holds a version other than the package's
 * current one fails the cut, naming the key and the file, before anything changes.
 */
export function sharedManifests(
  directory: string,
  value: unknown,
  own: string,
  current: string,
): SharedManifest[] {
  const seen = new Set([own]);
  const manifests: SharedManifest[] = [];
  for (const entry of sharedEntries(value)) {
    const path = resolve(directory, entry);
    if (!seen.has(path)) {
      seen.add(path);
      const source = sharedSource(entry, path);
      const version = sharedVersion(entry, source, path);
      if (version !== current) {
        refuse(entry, `holds version ${version}, not ${current}`);
      }
      manifests.push({ path, source });
    }
  }
  return manifests;
}
