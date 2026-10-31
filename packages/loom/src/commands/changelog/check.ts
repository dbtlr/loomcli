import type { ActionHandler } from '@loomcli/core';

import { readFragments } from '../../helpers/fragments.js';
import { changelogFiles, packagePaths } from '../../helpers/loom-config.js';
import { packageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';
import type { changelogCheck } from './command.js';

/** Checks every fragment in the package's fragment folder, `paths.changes`, and counts them. */
export const checkChangelog: ActionHandler<typeof changelogCheck> = async ({
  host,
  onShutdown,
  out,
  passthrough,
  provided,
  signal,
}) => {
  await report({ out, passthrough, signal }, async () => {
    const root = packageDirectory(host.cwd);
    const { changes } = changelogFiles(root, packagePaths(root, provided.config));
    const fragments = await readFragments({ host, onShutdown, root, signal }, undefined, changes);
    return `Checked ${fragments.length} fragment${fragments.length === 1 ? '' : 's'}.\n`;
  });
};
