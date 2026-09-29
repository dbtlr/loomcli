import { Command } from '@loomcli/core';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

import { dumpDocument } from '../actions/dump-document.js';
import { readFailures } from '../failures.js';

// `debug` is a hidden Command, so no listing shows it.
// It routes, runs, and prints its own page when an invocation routes to it directly.
export const debug = new Command('debug', {
  description: 'Dump the parsed document.',
  extensions: [manifestCommand({ failures: readFailures })],
  hidden: true,
}).action(dumpDocument);
