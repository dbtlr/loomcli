import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';

import { buildCommand } from './commands/build/command.js';
import { changelog } from './commands/changelog/command.js';
import { checkCommand } from './commands/check/command.js';
import { init } from './commands/init/command.js';
import { pr } from './commands/pr/command.js';
import { release } from './commands/release/command.js';
import { loomVersion } from './helpers/loom-version.js';

export const loom = new Application('loom', {
  description: 'The Loom toolchain. It acts on the package in the working directory.',
  plugins: [help(), version()],
  version: loomVersion,
})
  .command(buildCommand)
  .command(changelog)
  .command(checkCommand)
  .command(init)
  .command(pr)
  .command(release);
