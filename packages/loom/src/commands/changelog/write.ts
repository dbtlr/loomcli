import type { ActionHandler } from '@loomcli/core';

import { readNarrative, releaseDate } from '../../helpers/changelog.js';
import { changelogFiles, packagePaths } from '../../helpers/loom-config.js';
import { preparePackageCut, writePackageCut } from '../../helpers/package-changelog.js';
import { packageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';
import type { changelogWrite } from './command.js';

/**
 * Cuts the package's next version from its fragments, or prints the section and the version alone
 * under `--dry-run`.
 */
export const writeChangelog: ActionHandler<typeof changelogWrite> = async ({
  host,
  onShutdown,
  options,
  out,
  passthrough,
  provided,
  signal,
}) => {
  await report({ out, passthrough, signal }, async () => {
    const directory = packageDirectory(host.cwd);
    const cut = await preparePackageCut(
      { host, onShutdown, root: directory, signal },
      {
        date: releaseDate(options.date),
        narrative: readNarrative(host.cwd, options.narrative),
      },
      changelogFiles(directory, packagePaths(directory, provided.config)),
    );
    if (!options['dry-run']) {
      writePackageCut(directory, cut);
    }
    return `${cut.section}Next version: ${cut.version}\n`;
  });
};
