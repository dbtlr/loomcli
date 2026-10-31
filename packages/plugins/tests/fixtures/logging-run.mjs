import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { loggingApplication } from './logging-app.ts';

/**
 * One run of the logging fixture application as a real process, for the case whose action ends
 * the process with `process.exit()` right after it logs.
 */
process.exitCode = await loggingApplication().run({
  // The platform is pinned so a test reads the same row on every machine.
  // The handle's home is the test's HOME as given, never the user database's.
  process: processHandle({ argv: process.argv.slice(2), home: fixtureHome(), platform: 'linux' }),
});
