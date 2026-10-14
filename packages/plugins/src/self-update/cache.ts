/**
 * The update notices' cache: `update.json` in the application's cache directory, one line that
 * says when the newest release on a repository's channel was last looked up and what it was.
 */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { replaceFile } from '../installation/disk.js';
import { isRecord } from '../plain-data.js';
import { parseVersion } from './version.js';

/** The cache file's name in the application's cache directory. */
const cacheFile = 'update.json';

/** The cache format this plugin reads and writes. */
const knownFormat = 1;

/** How long a lookup stays fresh: 24 hours, in milliseconds. */
const freshFor = 86_400_000;

/** The repository and channel a cache answers for, as the running binary's release facts hold them. */
interface Lookup {
  readonly repository: string;
  readonly channel: string;
}

/**
 * What the cache says for the running binary's repository and channel: whether it is fresh, and,
 * when it is a cache for them whose only possible fault is its `checked`, the `latest` it names, a
 * version or `null` for a channel that had none.
 */
interface CacheReading {
  readonly fresh: boolean;
  readonly latest?: string | null;
}

/** The reading of a cache that is missing, damaged, or for another repository or channel. */
const stale: CacheReading = { fresh: false };

/** Whether a value is a time in the `toISOString()` form, the form the cache writes. */
function isTime(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

/** Whether `checked` is a time less than 24 hours before `now` and not after it. */
function isFresh(checked: unknown, now: number): boolean {
  if (!isTime(checked)) {
    return false;
  }
  const time = Date.parse(checked);
  return time <= now && now - time < freshFor;
}

/** Whether a cache's `latest` is one it may hold: a version, or `null` for a channel with none. */
function isLatest(latest: unknown): latest is string | null {
  return latest === null || (typeof latest === 'string' && parseVersion(latest) !== undefined);
}

/** The JSON value of a cache's text, or `undefined` for text that does not parse. */
function parsed(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * Judges a cache's text for a repository and channel at `now`. Every member other than the five it
 * reads is passed over, in any order.
 */
function judgeCache(content: string, lookup: Lookup, now: number): CacheReading {
  const value = parsed(content);
  if (!isRecord(value)) {
    return stale;
  }
  const { channel, checked, format, latest, repository } = value;
  if (format !== knownFormat || repository !== lookup.repository || channel !== lookup.channel) {
    return stale;
  }
  return isLatest(latest) ? { fresh: isFresh(checked, now), latest } : stale;
}

/** The text of the cache in `directory`, or `undefined` when it is not a regular file that reads. */
function cacheText(directory: string): string | undefined {
  const path = join(directory, cacheFile);
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

/** Reads and judges the cache in `directory`; one that cannot be read is stale. */
function readCache(directory: string, lookup: Lookup, now: number): CacheReading {
  const content = cacheText(directory);
  return content === undefined ? stale : judgeCache(content, lookup, now);
}

/** What one cache line records: when it looked, where, and the newest version, if any. */
interface CacheEntry extends Lookup {
  readonly checked: Date;
  readonly latest: string | null | undefined;
}

/** The cache line, its members in the contract's order, with `null` for no version. */
function cacheLine({ channel, checked, latest, repository }: CacheEntry): string {
  const version = typeof latest === 'string' ? JSON.stringify(latest) : 'null';
  // The members keep the cache's order, which an object literal would not survive formatting in.
  return `{"format":${knownFormat},"checked":"${checked.toISOString()}","repository":${JSON.stringify(repository)},"channel":${JSON.stringify(channel)},"latest":${version}}\n`;
}

/**
 * Replaces the cache in `directory` whole, creating the directory and its missing parents, through a
 * staging file in the directory and a rename. A failure throws the runtime's error.
 */
function writeCache(directory: string, entry: CacheEntry): void {
  mkdirSync(directory, { recursive: true });
  replaceFile(join(directory, cacheFile), cacheLine(entry));
}

export type { CacheEntry, CacheReading, Lookup };
export { judgeCache, readCache, writeCache };
