import { Command } from '@loomcli/core';
import { createValidator } from '@loomcli/validators';

/*
 * Each action imports its work when it runs, so a run of any other command, help included, loads
 * none of it.
 */

const defaultRegistry = 'https://registry.npmjs.org';
const defaultGitHubApi = 'https://api.github.com';

const wholeNumber = /^\d+$/u;

const count = createValidator({
  inputSchema: { type: 'string', pattern: wholeNumber.source },
  parse: (raw) =>
    wholeNumber.test(raw)
      ? { value: Number(raw) }
      : { issues: [{ message: 'Supply a whole number.' }] },
});

/** This repository's synchronized cut under ADR-0012. */
export const releaseCut = new Command('cut', {
  description:
    'Cut the next synchronized release: update the changelog, versions, and lockfile, and consume the fragments.',
})
  .option('target', {
    description: 'Select a stable 0.x version at or above the fragment-derived minimum.',
    type: 'string',
  })
  .option('dry-run', {
    description: 'Print the next release section without writing any file.',
    type: 'boolean',
  })
  .option('date', {
    description: 'Date the release as YYYY-MM-DD instead of today.',
    type: 'string',
  })
  .option('initial', {
    description: 'Cut the first release from version 0.0.0.',
    type: 'boolean',
  })
  .option('since', {
    description: 'Name the revision whose changes the release covers.',
    type: 'string',
  })
  .option('narrative', {
    description: 'Read the release narrative from this Markdown file.',
    type: 'string',
  })
  .action(async (context) => {
    const { cutRelease } = await import('./cut.js');
    await cutRelease(context);
  });

export const releasePlan = new Command('plan', {
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
  .action(async (context) => {
    const { writeReleasePlan } = await import('./plan.js');
    await writeReleasePlan(context);
  });

export const releaseRecord = new Command('record', {
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
  .action(async (context) => {
    const { recordPlannedRelease } = await import('./record.js');
    await recordPlannedRelease(context);
  });

export const release = new Command('release', {
  description: 'Cut, plan, and record a release.',
  hidden: true,
})
  .command(releaseCut)
  .command(releasePlan)
  .command(releaseRecord);
