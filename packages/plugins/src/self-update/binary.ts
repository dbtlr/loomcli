/**
 * The running binary as its release facts describe it: the one reading that `self-update`, its
 * `--refresh-notice` lookup, and the update notices share of whether a run is a release binary.
 */
import type { Host } from '@loomcli/core';

import { parseVersion } from './version.js';
import type { Version } from './version.js';

/** A release binary: the asset it was built as, where its releases are, and its version. */
interface ReleaseBinary {
  readonly asset: string;
  readonly repository: string;
  readonly channel: string;
  readonly running: Version;
}

/**
 * The running binary, when its release group names an asset and a version that parses, or
 * `undefined` for any other run.
 */
function releaseBinary(host: Host): ReleaseBinary | undefined {
  const { release } = host.release;
  const running = release === undefined ? undefined : parseVersion(release.version);
  if (release?.asset === undefined || running === undefined) {
    return undefined;
  }
  const { asset, channel, repository } = release;
  return { asset, channel, repository, running };
}

export type { ReleaseBinary };
export { releaseBinary };
