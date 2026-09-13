import { Command } from '@loomcli/core';

import { dumpDocument } from '../actions/dump-document.js';

// `debug` is a hidden Command, so no listing shows it.
// It routes, runs, and prints its own page when an invocation routes to it directly.
export const debug = new Command('debug', {
  description: 'Dump the parsed document.',
  hidden: true,
}).action(dumpDocument);
