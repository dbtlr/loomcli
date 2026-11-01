import type { ActionHandler } from '@loomcli/core';

import { changelogFiles, packagePaths } from '../../helpers/loom-config.js';
import { packageDirectory } from '../../helpers/package-directory.js';
import { packageNotes } from '../../helpers/package-notes.js';
import { report } from '../../helpers/report.js';
import type { changelogNotes } from './command.js';

/** Prints one version's notes: a cut version's section body, or the current prerelease's pending fragments. */
export const notesChangelog: ActionHandler<typeof changelogNotes> = async ({
  args,
  host,
  onShutdown,
  out,
  passthrough,
  provided,
  signal,
}) => {
  await report({ out, passthrough, signal }, async () => {
    const directory = packageDirectory(host.cwd);
    return await packageNotes(
      { host, onShutdown, root: directory, signal },
      args.version,
      changelogFiles(directory, packagePaths(directory, provided.config)),
    );
  });
};
