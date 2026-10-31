import { Command } from '@loomcli/core';

/*
 * Each action imports its work when it runs, so a run of any other command, help included, loads
 * none of it.
 */

export const changelogCheck = new Command('check', {
  description: 'Check every fragment in .changes/ and count them.',
}).action(async (context) => {
  const { checkChangelog } = await import('./check.js');
  await checkChangelog(context);
});

export const changelogWrite = new Command('write', {
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
  .action(async (context) => {
    const { writeChangelog } = await import('./write.js');
    await writeChangelog(context);
  });

export const changelog = new Command('changelog', {
  description: "Check the package's change fragments and cut its version from them.",
})
  .command(changelogCheck)
  .command(changelogWrite);
