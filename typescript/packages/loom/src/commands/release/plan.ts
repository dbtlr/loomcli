import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ActionHandler } from '@loomcli/core';

import { cannotUseFile } from '../../helpers/messages.js';
import { planRelease, renderPlan } from '../../helpers/release-plan.js';
import { report } from '../../helpers/report.js';
import { requireWorkspaceDirectory } from '../../helpers/repository.js';
import { systemErrorFacts } from '../../helpers/system-error.js';
import type { releasePlan } from './command.js';
import { outputFolderMissing } from './messages.js';

/**
 * Writes the plan to the file `--output` names. A plan that cannot be written names the path as the
 * operator typed it with the cause: a write that finds no entry lacks the file's folder, because the
 * file itself need not exist.
 */
function writePlan(cwd: string, path: string, text: string): void {
  try {
    writeFileSync(resolve(cwd, path), text);
  } catch (error) {
    const facts = systemErrorFacts(error);
    if (facts === undefined) {
      throw error;
    }
    const sentence =
      facts.code === 'ENOENT'
        ? outputFolderMissing(path)
        : cannotUseFile('write', path, facts.code);
    throw new Error(sentence, { cause: error });
  }
}

/** Reconciles the head with the registry and writes the release plan. */
export const writeReleasePlan: ActionHandler<typeof releasePlan> = async ({
  host,
  onShutdown,
  options,
  out,
  signal,
}) => {
  await report({ out, signal }, async () => {
    requireWorkspaceDirectory(host.cwd, 'release plan');
    const plan = await planRelease({
      checkout: { host, onShutdown, root: host.cwd, signal },
      githubApi: options['github-api'],
      head: options.head,
      policy: { requestTimeoutMs: options['request-timeout-ms'] },
      registry: options.registry,
      repository: options.repository,
      token: host.env.GH_TOKEN,
    });
    writePlan(host.cwd, options.output, `${JSON.stringify(plan, null, 2)}\n`);
    return renderPlan(plan);
  });
};
