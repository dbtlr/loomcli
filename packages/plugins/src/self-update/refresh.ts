/**
 * `self-update --refresh-notice`: the lookup the update notices' middleware starts in a detached
 * child, which resolves the newest release on the running binary's channel and writes the cache.
 */
import { applicationDirectory } from '@loomcli/core';
import type { Host, Log } from '@loomcli/core';

import { fileWritten } from '../change-events.js';
import { releaseBinary } from './binary.js';
import { writeCache } from './cache.js';
import type { CacheEntry } from './cache.js';
import { fatal } from './fatal.js';
import { cacheNotAbsolute, cacheUnwritable, notReleaseBinary } from './messages.js';
import type { Requesting } from './request.js';
import { latestRelease } from './resolve.js';

/**
 * What the refresh reads: the graph's name, the run's host and log, and the requests' signal and
 * naming.
 */
interface RefreshRun {
  readonly name: string;
  readonly host: Host;
  readonly log: Log;
  readonly requesting: Requesting;
}

/**
 * Writes the cache and records it, or throws the cache failure with the runtime's error as its
 * cause.
 */
function writeOrFail(
  { log, name }: Pick<RefreshRun, 'log' | 'name'>,
  directory: string,
  entry: CacheEntry,
): void {
  try {
    fileWritten(log, { path: writeCache(directory, entry) });
  } catch (error) {
    throw fatal(cacheUnwritable(name, directory), error);
  }
}

/**
 * Resolves the newest release on `host.release.channel`, fetching only what resolving the channel
 * needs, and writes the cache with the time it finished. It reads no installation and hashes
 * nothing. A channel with no release writes `null`; a request that fails throws and writes nothing;
 * a write that fails is the cache failure, the runtime's error kept as its cause.
 */
async function refreshNotice({ name, host, log, requesting }: RefreshRun): Promise<void> {
  const binary = releaseBinary(host);
  if (binary === undefined) {
    throw fatal(notReleaseBinary(name));
  }
  const directory = applicationDirectory('cache', name, host);
  if ('variable' in directory) {
    throw fatal(cacheNotAbsolute(name, directory.variable));
  }
  const { channel, repository } = binary;
  const found = await latestRelease(repository, channel, requesting);
  const entry = { channel, checked: new Date(), latest: found?.version.text, repository };
  writeOrFail({ log, name }, directory.path, entry);
}

export { refreshNotice };
