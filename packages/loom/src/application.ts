import { Application } from '@loomcli/core';

import { changelog } from './commands/changelog/command.js';
import { pr } from './commands/pr/command.js';
import { release } from './commands/release/command.js';

export const loom = new Application('loom', {
  description: "Run the Loom repository's changelog, pull request, and release tooling.",
})
  .command(changelog)
  .command(pr)
  .command(release);
