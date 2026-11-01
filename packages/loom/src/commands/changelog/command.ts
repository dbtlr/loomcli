import { Command } from '@loomcli/core';
import { createValidator } from '@loomcli/validators';
import type { ParseResult } from '@loomcli/validators';

import { loomConfig } from '../../helpers/loom-config.js';
import { parseSemVer } from '../../helpers/version.js';
import type { SemVer } from '../../helpers/version.js';

/*
 * Each action imports its work when it runs, so a run of any other command, help included, loads
 * none of it.
 */

/** The version `notes` takes, in `--target`'s form: MAJOR.MINOR.PATCH and an optional prerelease part. */
const versionArgument = createValidator({
  inputSchema: { type: 'string' },
  parse: (raw): ParseResult<SemVer> => {
    const version = parseSemVer(raw);
    return version === undefined
      ? {
          issues: [
            {
              message:
                'Use MAJOR.MINOR.PATCH with an optional -prerelease part, such as 1.5.0 or 1.5.0-rc.1, and no leading v or build metadata.',
            },
          ],
        }
      : { value: version };
  },
});

export const changelogCheck = new Command('check', {
  description: 'Check every fragment in the fragment folder, by default .changes/, and count them.',
  uses: [loomConfig],
}).action(async (context) => {
  const { checkChangelog } = await import('./check.js');
  await checkChangelog(context);
});

export const changelogWrite = new Command('write', {
  description:
    'Cut the next version: prepend its section to the changelog, by default CHANGELOG.md, set the package.json version, and delete the consumed fragments. A prerelease --target sets the version and keeps the fragments pending.',
  uses: [loomConfig],
})
  .option('target', {
    description:
      'Cut this version, MAJOR.MINOR.PATCH with an optional -prerelease part, instead of the next version. Its release part must meet the fragment minimum.',
    type: 'string',
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
  .action(async (context) => {
    const { writeChangelog } = await import('./write.js');
    await writeChangelog(context);
  });

export const changelogNotes = new Command('notes', {
  description:
    "Print one version's release notes: a cut version's changelog section, or the current prerelease's pending fragments.",
  uses: [loomConfig],
})
  .argument('version', {
    description: 'The version, MAJOR.MINOR.PATCH with an optional -prerelease part.',
    required: true,
    type: 'string',
    validate: versionArgument,
  })
  .action(async (context) => {
    const { notesChangelog } = await import('./notes.js');
    await notesChangelog(context);
  });

export const changelog = new Command('changelog', {
  description: "Check the package's change fragments and cut its version from them.",
})
  .command(changelogCheck)
  .command(changelogWrite)
  .command(changelogNotes);
