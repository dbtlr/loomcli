import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { application } from './config-run.ts';

/**
 * The two cases that need a process, each an argv run on the real process handle: one whose own
 * working directory differs from the run's `cwd`, and one whose environment holds yaml's debug
 * variables, which the YAML reader's guard reads on the real global. `FIXTURE_SETTINGS` holds the plugin's settings
 * as JSON and `FIXTURE_CWD` the working directory the files resolve in.
 */
const { FIXTURE_CWD, FIXTURE_DEBUG_VARIABLES, FIXTURE_SETTINGS } = process.env;

/** One variable's value, or "absent" when the process environment does not hold it. */
const state = (name) => (name in process.env ? process.env[name] : 'absent');

const code = await application({
  settings: FIXTURE_SETTINGS === undefined ? undefined : JSON.parse(FIXTURE_SETTINGS),
}).run({
  process: processHandle({
    argv: process.argv.slice(2),
    ...(FIXTURE_CWD === undefined ? {} : { cwd: FIXTURE_CWD }),
    // The handle's home is the test's HOME as given, never the user database's.
    home: fixtureHome(),
  }),
});
process.stdout.write(`resolved:${code}\n`);
// The state of yaml's debug variables after the run, which reading a YAML file leaves as it was.
if (FIXTURE_DEBUG_VARIABLES !== undefined) {
  process.stdout.write(`debug:${state('LOG_STREAM')},${state('LOG_TOKENS')}\n`);
}
