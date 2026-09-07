import { Application } from '@loom/core';

import { changelog } from './changelog/command.js';

export const loom = new Application('loom').command(changelog);
