import { readFileSync } from 'node:fs';

import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { manpageApplication } from './manpage-app.ts';

/**
 * One run of an application that installs `manpage()`. The scenario file, named by
 * `MANPAGE_SCENARIO`, holds the names of the Commands the application declares, its version, the
 * host's environment, working directory, and platform, and the umask.
 */
const scenario = JSON.parse(readFileSync(process.env.MANPAGE_SCENARIO, 'utf8'));
const argv = process.argv.slice(2);

if (scenario.umask !== undefined) {
  process.umask(scenario.umask);
}

process.exitCode = await manpageApplication(scenario).run({
  process: processHandle({
    argv,
    cwd: scenario.cwd,
    env: scenario.env,
    // The handle's home is the test's HOME as given, never the user database's.
    home: fixtureHome(scenario.env),
    platform: scenario.platform ?? 'linux',
    release: scenario.release ?? { build: 'distributed' },
  }),
});
