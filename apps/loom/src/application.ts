import { Application } from '@loom/core';

import { changelog } from './changelog/command.js';
import { pr } from './pr/command.js';

export const loom = new Application('loom').command(changelog).command(pr);
