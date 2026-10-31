import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ActionHandler } from '@loomcli/core';

import { planRelease, renderPlan } from '../../helpers/release-plan.js';
import { report } from '../../helpers/report.js';
import type { releasePlan } from './command.js';

/** Reconciles the head with the registry and writes the release plan. */
export const writeReleasePlan: ActionHandler<typeof releasePlan> = async ({
  host,
  onShutdown,
  options,
  out,
  passthrough,
  signal,
}) => {
  await report({ out, passthrough, signal }, async () => {
    const plan = await planRelease({
      checkout: { host, onShutdown, root: host.cwd, signal },
      githubApi: options['github-api'],
      head: options.head,
      policy: { requestTimeoutMs: options['request-timeout-ms'] },
      registry: options.registry,
      repository: options.repository,
      token: host.env.GH_TOKEN,
    });
    writeFileSync(resolve(host.cwd, options.output), `${JSON.stringify(plan, null, 2)}\n`);
    return renderPlan(plan);
  });
};
