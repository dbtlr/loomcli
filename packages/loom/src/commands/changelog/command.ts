import { Command } from '@loomcli/core';

import { readNarrative, releaseDate } from '../../helpers/changelog.js';
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
    }).action(async ({ host, onShutdown, out, passthrough, signal }) => {
      await report(out, passthrough, async () => {
        const fragments = await readFragments({
          host,
          onShutdown,
          root: packageDirectory(host.cwd),
          signal,
        });
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
      .action(async ({ host, onShutdown, options, out, passthrough, signal }) => {
        await report(out, passthrough, async () => {
          const directory = packageDirectory(host.cwd);
          const cut = await preparePackageCut(
            { host, onShutdown, root: directory, signal },
            {
              date: releaseDate(options.date),
              narrative: readNarrative(host.cwd, options.narrative),
            },
          );
          if (!options['dry-run']) {
            writePackageCut(directory, cut);
          }
          return `${cut.section}Next version: ${cut.version}\n`;
        });
      }),
  );
