import { Command } from '@loomcli/core';

import { dumpDocument } from '../actions/dump-document.js';
import { globals } from '../globals.js';

// `debug` is a hidden Command, so no listing shows it.
// It routes, runs, and prints its own page when an invocation routes to it directly.
export const debug = new Command('debug', {
  description: 'Dump the parsed document.',
  globals,
  hidden: true,
}).action(dumpDocument);
