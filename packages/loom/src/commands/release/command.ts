import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command } from '@loomcli/core';
import type { Out } from '@loomcli/core';
import { z } from 'zod';

import { planRelease, planSchema, renderPlan } from '../../helpers/release-plan.js';
import { recordRelease } from '../../helpers/release-record.js';

const defaultRegistry = 'https://registry.npmjs.org';
const defaultGitHubApi = 'https://api.github.com';

const count = z
  .string()
  .regex(/^\d+$/u, 'Supply a whole number.')
  .transform((value) => Number(value));

// Convert reconciliation failures to Loom's fatal channel and render the summary verbatim.
async function report(out: Out, passthrough: string[], work: () => Promise<string>) {
  try {
    if (passthrough.length > 0) {
      out.fatal('Arguments after -- are not supported.');
    }
    const summary = await work();
    await out.render(summary, { render: (value) => value });
  } catch (error) {
    out.fatal(error instanceof Error ? error.message : String(error));
  }
}

export const release = new Command('release', {
  description: 'Plan and record a release.',
  hidden: true,
})
  .command(
    new Command('plan', {
      description: 'Reconcile the head with the registry and write a release plan.',
    })
      .option('repository', {
        description: 'Name the GitHub repository as owner/name.',
        required: true,
        type: 'string',
      })
      .option('output', {
        description: 'Write the release plan JSON to this file.',
        required: true,
        type: 'string',
      })
      .option('registry', {
        default: defaultRegistry,
        description: 'Name the package registry URL.',
        type: 'string',
      })
      .option('github-api', {
        default: defaultGitHubApi,
        description: 'Name the GitHub API URL.',
        type: 'string',
      })
      .option('head', {
        default: 'HEAD',
        description: 'Name the revision to plan the release for.',
        type: 'string',
      })
      .option('request-timeout-ms', {
        default: '30000',
        description: 'Give the milliseconds each request may take.',
        type: 'string',
        validate: count,
      })
      .action(async ({ host, options, out, passthrough }) => {
        await report(out, passthrough, async () => {
          const plan = await planRelease({
            githubApi: options['github-api'],
            head: options.head,
            policy: { requestTimeoutMs: options['request-timeout-ms'] },
            registry: options.registry,
            repository: options.repository,
            root: host.cwd,
            token: host.env.GH_TOKEN,
          });
          writeFileSync(resolve(host.cwd, options.output), `${JSON.stringify(plan, null, 2)}\n`);
          return renderPlan(plan);
        });
      }),
  )
  .command(
    new Command('record', {
      description: 'Record a planned release as a tag and a GitHub release.',
    })
      .option('repository', {
        description: 'Name the GitHub repository as owner/name.',
        required: true,
        type: 'string',
      })
      .option('plan', {
        description: 'Read the release plan JSON from this file.',
        required: true,
        type: 'string',
      })
      .option('registry', {
        default: defaultRegistry,
        description: 'Name the package registry URL.',
        type: 'string',
      })
      .option('github-api', {
        default: defaultGitHubApi,
        description: 'Name the GitHub API URL.',
        type: 'string',
      })
      .option('request-timeout-ms', {
        default: '30000',
        description: 'Give the milliseconds each request may take.',
        type: 'string',
        validate: count,
      })
      .option('retry-attempts', {
        default: '8',
        description: 'Give how many times to retry a pending read.',
        type: 'string',
        validate: count,
      })
      .option('retry-delay-ms', {
        default: '5000',
        description: 'Give the milliseconds to wait between retries.',
        type: 'string',
        validate: count,
      })
      .action(async ({ host, options, out, passthrough }) => {
        await report(out, passthrough, async () => {
          const token = host.env.GH_TOKEN;
          if (token === undefined || token === '') {
            throw new Error('Recording a release requires GH_TOKEN.');
          }
          const source: unknown = JSON.parse(readFileSync(resolve(host.cwd, options.plan), 'utf8'));
          return recordRelease({
            githubApi: options['github-api'],
            plan: planSchema.parse(source),
            registry: options.registry,
            repository: options.repository,
            retry: {
              attempts: options['retry-attempts'],
              delayMs: options['retry-delay-ms'],
              requestTimeoutMs: options['request-timeout-ms'],
            },
            root: host.cwd,
            token,
          });
        });
      }),
  );
