import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command } from '@loomcli/core';

import { releaseDate } from '../../helpers/changelog.js';
import { readFragments } from '../../helpers/fragments.js';
import { preparePackageCut, writePackageCut } from '../../helpers/package-changelog.js';
import { packageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';

export const changelog = new Command('changelog', {
  description: "Check the package's change fragments and cut its version from them.",
})
  .command(
    new Command('check', {
      description: 'Check every fragment in .changes/ and count them.',
    }).action(async ({ host, out, passthrough }) => {
      await report(out, passthrough, () => {
        const fragments = readFragments(packageDirectory(host.cwd));
        return `Checked ${fragments.length} fragment${fragments.length === 1 ? '' : 's'}.\n`;
      });
    }),
  )
  .command(
    new Command('write', {
      description:
        'Cut the next version: prepend its section to CHANGELOG.md, set the package.json version, and delete the consumed fragments.',
    })
      .option('date', {
        description: 'Date the release as YYYY-MM-DD instead of today.',
        type: 'string',
      })
      .option('narrative', {
        description: 'Copy the prose of this Markdown file above the entries.',
        type: 'string',
      })
      .option('dry-run', {
        description: 'Print the section and the next version, and write nothing.',
        type: 'boolean',
      })
      .action(async ({ host, options, out, passthrough }) => {
        await report(out, passthrough, () => {
          const directory = packageDirectory(host.cwd);
          const cut = preparePackageCut(directory, {
            date: releaseDate(options.date),
            narrative:
              options.narrative === undefined
                ? undefined
                : readFileSync(resolve(host.cwd, options.narrative), 'utf8'),
          });
          if (!options['dry-run']) {
            writePackageCut(directory, cut);
          }
          return `${cut.section}Next version: ${cut.version}\n`;
        });
      }),
  );
