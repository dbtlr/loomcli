import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command } from '@loom/core';
import type { Out } from '@loom/core';

import { readFragments } from '../../helpers/fragments.js';
import { prepareRelease, releaseDate } from '../../helpers/release.js';
import { writeRelease } from './write.js';

function prepare(
  root: string,
  options: {
    date: string | undefined;
    initial: boolean;
    since: string | undefined;
    narrative: string | undefined;
  },
) {
  return prepareRelease(root, {
    date: releaseDate(options.date),
    initial: options.initial,
    narrative:
      options.narrative === undefined
        ? undefined
        : readFileSync(resolve(root, options.narrative), 'utf8'),
    since: options.since,
  });
}

// Convert compiler failures to Loom's fatal channel; keep generated Markdown byte-for-byte.
async function output(out: Out, passthrough: string[], produce: () => string) {
  try {
    if (passthrough.length > 0) {
      out.fatal('Arguments after -- are not supported.');
    }
    const text = produce();
    await out.render(text, { render: (value) => value });
  } catch (error) {
    out.fatal(error instanceof Error ? error.message : String(error));
  }
}

export const changelog = new Command('changelog')
  .command(
    new Command('check').action(async ({ host, out, passthrough }) => {
      await output(out, passthrough, () => {
        const fragments = readFragments(host.cwd);
        return `Checked ${fragments.length} fragment${fragments.length === 1 ? '' : 's'}.\n`;
      });
    }),
  )
  .command(
    new Command('preview')
      .option('date', { type: 'string' })
      .option('initial', { type: 'boolean' })
      .option('since', { type: 'string' })
      .option('narrative', { type: 'string' })
      .action(async ({ host, options, out, passthrough }) => {
        await output(out, passthrough, () => prepare(host.cwd, options).section);
      }),
  )
  .command(
    new Command('write')
      .option('date', { type: 'string' })
      .option('initial', { type: 'boolean' })
      .option('since', { type: 'string' })
      .option('narrative', { type: 'string' })
      .action(async ({ host, options, out, passthrough }) => {
        await output(out, passthrough, () => {
          const release = prepare(host.cwd, options);
          writeRelease(host.cwd, release);
          return release.section;
        });
      }),
  );
