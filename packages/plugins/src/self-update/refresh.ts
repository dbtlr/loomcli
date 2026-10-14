/**
 * `self-update --refresh-notice`: the lookup the update notices' middleware starts in a detached
 * child, which resolves the newest release on the running binary's channel and writes the cache.
 */
import { applicationDirectory } from '@loomcli/core';
import type { Host } from '@loomcli/core';

import { releaseBinary } from './binary.js';
import { writeCache } from './cache.js';
import { refusals } from './messages.js';
import { latestRelease } from './resolve.js';

/** What the refresh reads: the graph's name, the run's host, and the run signal. */
interface RefreshRun {
  readonly name: string;
  readonly host: Host;
  readonly signal: AbortSignal;
}

/**
 * Resolves the newest release on `host.release.channel`, fetching only what resolving the channel
 * needs, and writes the cache with the time it finished. It reads no installation and hashes
 * nothing. A channel with no release writes `null`; a request that fails throws and writes nothing.
 */
async function refreshNotice({ name, host, signal }: RefreshRun): Promise<void> {
  const binary = releaseBinary(host);
  if (binary === undefined) {
    throw refusals.notBuilt(name);
  }
  const directory = applicationDirectory('cache', name, host);
  if ('variable' in directory) {
    throw refusals.cache(name, directory.variable);
  }
  const { channel, repository } = binary;
  const found = await latestRelease(repository, channel, signal);
  writeCache(directory.path, {
    channel,
    checked: new Date(),
    latest: found?.version.text,
    repository,
  });
}

export { refreshNotice };
