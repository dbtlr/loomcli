import type { ActionHandler } from '@loomcli/core';

import { readFragments } from '../../helpers/fragments.js';
import { packageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';
import type { changelogCheck } from './command.js';

/** Checks every fragment in the package's `.changes/` and counts them. */
export const checkChangelog: ActionHandler<typeof changelogCheck> = async ({
  host,
  onShutdown,
  out,
  passthrough,
  signal,
}) => {
  await report({ out, passthrough, signal }, async () => {
    const fragments = await readFragments({
      host,
      onShutdown,
      root: packageDirectory(host.cwd),
      signal,
    });
    return `Checked ${fragments.length} fragment${fragments.length === 1 ? '' : 's'}.\n`;
  });
};
