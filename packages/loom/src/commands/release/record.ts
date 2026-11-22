import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ActionHandler } from '@loomcli/core';

import { jsonFault } from '../../helpers/json-fault.js';
import { cannotUseFile } from '../../helpers/messages.js';
import { parseOrThrow } from '../../helpers/parse-or-throw.js';
import { planSchema } from '../../helpers/release-plan.js';
import { recordRelease } from '../../helpers/release-record.js';
import { report } from '../../helpers/report.js';
import { requireWorkspaceDirectory } from '../../helpers/repository.js';
import { systemErrorFacts } from '../../helpers/system-error.js';
import type { releaseRecord } from './command.js';
import { planNotJson, planNotJsonAt, tokenRequired } from './messages.js';

/**
 * The plan `--plan` names, parsed as JSON. A plan that cannot be read names the path as the operator
 * typed it with the cause, and one that is not JSON names where it breaks.
 */
function readPlan(cwd: string, path: string): unknown {
  let source = '';
  try {
    source = readFileSync(resolve(cwd, path), 'utf8');
  } catch (error) {
    const facts = systemErrorFacts(error);
    if (facts === undefined) {
      throw error;
    }
    throw new Error(cannotUseFile('read', path, facts.code), { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    const fault = jsonFault(source);
    const sentence = fault === undefined ? planNotJson(path) : planNotJsonAt(path, fault);
    throw new Error(sentence, { cause: error });
  }
}

/** Records a planned release as a tag and a GitHub release. */
export const recordPlannedRelease: ActionHandler<typeof releaseRecord> = async ({
  host,
  onShutdown,
  options,
  out,
  signal,
}) => {
  await report({ out, signal }, async () => {
    requireWorkspaceDirectory(host.cwd, 'release record');
    const token = host.env.GH_TOKEN;
    if (token === undefined || token === '') {
      throw new Error(tokenRequired);
    }
    const source = readPlan(host.cwd, options.plan);
    return recordRelease({
      checkout: { host, onShutdown, root: host.cwd, signal },
      githubApi: options['github-api'],
      plan: parseOrThrow(planSchema, source),
      registry: options.registry,
      repository: options.repository,
      retry: {
        attempts: options['retry-attempts'],
        delayMs: options['retry-delay-ms'],
        requestTimeoutMs: options['request-timeout-ms'],
      },
      token,
    });
  });
};
