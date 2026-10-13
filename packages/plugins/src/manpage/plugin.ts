import { Command, plugin } from '@loomcli/core';
import type { ActionContext, Plugin } from '@loomcli/core';

import { packageName } from '../constants.js';
import { helpInput } from '../help/extension.js';
import { generatePages, installPages, uninstallPages, updatePages } from './children.js';
import type { ChildRun } from './children.js';
import { judgePageNames } from './pages.js';

/** What every child reads from its action context. */
type ChildContext = Pick<ActionContext<unknown>, 'graph' | 'host' | 'out' | 'signal'>;

/** The run a child acts on, read from its action context. */
function childRun({ graph, host, out, signal }: ChildContext): ChildRun {
  return {
    graph,
    host,
    info: (message) => out.info(message),
    print: (message) => out.print(message),
    signal,
    success: (message) => out.success(message),
    warn: (message) => out.warn(message),
  };
}

const generateCommand = new Command('generate', {
  description: 'Write the man pages to a folder.',
})
  .option('out', {
    description: 'The folder to write the man pages in. It is created when missing.',
    extensions: [helpInput({ placeholder: 'folder' })],
    required: true,
    type: 'string',
  })
  .action(async (context) => {
    await generatePages(childRun(context), context.options.out);
  });

const installCommand = new Command('install', {
  description: 'Install the man pages in your home folder.',
}).action(async (context) => {
  await installPages(childRun(context));
});

const updateCommand = new Command('update', {
  description: 'Bring installed man pages up to date with this version.',
}).action(async (context) => {
  await updatePages(childRun(context));
});

const uninstallCommand = new Command('uninstall', {
  description: 'Remove the installed man pages.',
}).action(async (context) => {
  await uninstallPages(childRun(context));
});

/** The `manpage` group and its four children. */
const manpageCommand = new Command('manpage', { description: 'Write or install the man pages.' })
  .command(generateCommand)
  .command(installCommand)
  .command(updateCommand)
  .command(uninstallCommand);

/**
 * A plugin that writes one man page for each Command an operator can find, and installs,
 * refreshes, and removes the set in the operator's home folder. It contributes the `manpage` group
 * and a graph hook that rejects two page names one file would hold on a file system that ignores
 * case.
 */
function manpage(): Plugin {
  return plugin(`${packageName}/manpage`, {
    commands: [manpageCommand],
    onGraphBuilt: judgePageNames,
  });
}

export type { RefreshContext } from '../refresh.js';
export { refreshManpages } from './refresh.js';
export { manpage };
