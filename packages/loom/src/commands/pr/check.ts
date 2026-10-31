import type { ActionHandler } from '@loomcli/core';

import { checkPullRequest } from '../../helpers/pr-check.js';
import { report } from '../../helpers/report.js';
import type { prCheck } from './command.js';

/** Checks a pull request against its base for changelog and release rules. */
export const checkPr: ActionHandler<typeof prCheck> = async ({
  host,
  onShutdown,
  options,
  out,
  passthrough,
  signal,
}) => {
  await report({ out, passthrough, signal }, async () => {
    await checkPullRequest(
      { host, onShutdown, root: host.cwd, signal },
      {
        base: options.base,
        head: options.head,
        labels: options.label,
        title: options.title,
      },
    );
    return 'PR checks passed.\n';
  });
};
