import { GlobalOptions } from '@loomcli/core';

import { fileOrStdin } from './file-or-stdin.js';

/**
 * A document arrives from a file or from piped text, so the global names a source rather than
 * demanding one. Its schema decides omission too, so the rule holds before any action runs, and
 * the shared reader only selects between the two sources.
 */
export const globals = new GlobalOptions().option('file', {
  short: 'f',
  type: 'string',
  validate: fileOrStdin,
  validateOmitted: true,
});
