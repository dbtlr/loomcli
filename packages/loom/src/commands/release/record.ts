import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ActionHandler } from '@loomcli/core';

import { parseOrThrow } from '../../helpers/parse-or-throw.js';
import { planSchema } from '../../helpers/release-plan.js';
import { recordRelease } from '../../helpers/release-record.js';
import { report } from '../../helpers/report.js';
import type { releaseRecord } from './command.js';

/** Records a planned release as a tag and a GitHub release. */
export const recordPlannedRelease: ActionHandler<typeof releaseRecord> = async ({
  host,
  onShutdown,
  options,
  out,
  passthrough,
  signal,
}) => {
  await report({ out, passthrough, signal }, async () => {
    const token = host.env.GH_TOKEN;
    if (token === undefined || token === '') {
      throw new Error('Recording a release requires GH_TOKEN.');
    }
    const source: unknown = JSON.parse(readFileSync(resolve(host.cwd, options.plan), 'utf8'));
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
