import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { array, minLength, pipe, safeParse, string } from 'valibot';

import {
  sharedFileDenied,
  sharedFileIrregular,
  sharedFileMissing,
  sharedFileOtherVersion,
  sharedFileUnparsed,
  sharedFileUnreadable,
  sharedFileWithoutVersion,
  sharedVersionNotList,
  sharedVersionRefused,
} from '../commands/changelog/messages.js';
import { parseManifest } from './manifest.js';
import { systemErrorCode } from './system-error.js';

/** The value of `sharedVersion`, checked as one value: a list of nonempty strings. */
const entryList = array(pipe(string(), minLength(1)));

function refuse(entry: string, problem: string): never {
  throw new Error(sharedVersionRefused(entry, problem));
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The failure of a listed file that could not be read, named from the system error's code: a file
 * gone by the time it is read reads as missing.
 */
function unreadable(entry: string, error: unknown): Error {
  const code = systemErrorCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new Error(sharedVersionRefused(entry, sharedFileMissing), { cause: error });
  }
  const sentence =
    code === 'EACCES' || code === 'EPERM'
      ? sharedFileDenied(entry, code)
      : sharedFileUnreadable(entry, code);
  return new Error(sentence, { cause: error });
}

/** What a listed file is, or `undefined` when it is missing. A failure names the entry and the cause. */
function entryStats(entry: string, path: string) {
  try {
    return lstatSync(path, { throwIfNoEntry: false });
  } catch (error) {
    throw unreadable(entry, error);
  }
}

/**
 * The source of a listed file, or the failure naming why the entry cannot carry the version. The
 * entry's own file type tells a directory or a symbolic link from a regular file.
 */
function sharedSource(entry: string, path: string) {
  const stats = entryStats(entry, path);
  if (stats === undefined) {
    return refuse(entry, sharedFileMissing);
  }
  if (!stats.isFile()) {
    return refuse(entry, sharedFileIrregular);
  }
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw unreadable(entry, error);
  }
}

// The `version` string of a listed file, or the failure naming why it has none.
function sharedVersion(entry: string, source: string, path: string) {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = parseManifest(source, path);
  } catch (error) {
    return refuse(entry, sharedFileUnparsed(describe(error)));
  }
  const { version } = parsed;
  return typeof version === 'string' ? version : refuse(entry, sharedFileWithoutVersion);
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
    throw new Error(sharedVersionNotList);
  }
  return parsed.output;
}

/**
 * Reads each manifest `sharedVersion` lists, resolved against the package directory. The package's
 * own `package.json` and a repeated file count once. A file that is missing, is not a regular file,
 * cannot be read, does not parse, has no `version` string, or holds a version other than the
 * package's current one fails the cut, naming the key and the file, before anything changes.
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
        refuse(entry, sharedFileOtherVersion(version, current));
      }
      manifests.push({ path, source });
    }
  }
  return manifests;
}
