import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command } from '@loom/core';
import type { Out } from '@loom/core';

import { readFragments } from './fragments.js';
import { prepareRelease } from './release.js';
import { writeRelease } from './write.js';

function releaseOptions(name: string) {
  return new Command(name)
    .option('date', { type: 'string' })
    .option('initial', { type: 'boolean' })
    .option('since', { type: 'string' })
    .option('narrative', { type: 'string' });
}

function prepare(
  root: string,
  options: {
    date: string | undefined;
    initial: boolean;
    since: string | undefined;
    narrative: string | undefined;
  },
) {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error('Expected a calendar date: YYYY-MM-DD.');
  }
  return prepareRelease(root, {
    date,
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
    releaseOptions('preview').action(async ({ host, options, out, passthrough }) => {
      await output(out, passthrough, () => prepare(host.cwd, options).section);
    }),
  )
  .command(
    releaseOptions('write').action(async ({ host, options, out, passthrough }) => {
      await output(out, passthrough, () => {
        const release = prepare(host.cwd, options);
        writeRelease(host.cwd, release);
        return release.section;
      });
    }),
  );
