import { Application } from '@loomcli/core';

import { changelog } from './commands/changelog/command.js';
import { pr } from './commands/pr/command.js';
import { publication } from './commands/publication/command.js';

export const loom = new Application('loom').command(changelog).command(pr).command(publication);
