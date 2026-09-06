import { Application } from '@loom/core';

import { summarize } from '../actions/summarize.js';
import { globals } from '../globals.js';

export const root = new Application('jsonkit', globals).action(summarize);
