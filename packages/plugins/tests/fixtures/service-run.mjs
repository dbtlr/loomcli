import { existsSync, readFileSync } from 'node:fs';

import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { serviceApplication } from './service-run-app.ts';

/**
 * One run of an application that installs `service()`, against fake service managers the test puts
 * first on `PATH`. The scenario file names the platform, the program, the release facts, the label
 * and run words, the probe, and the marker file whose appearance aborts the run.
 */
const [scenarioPath, ...argv] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const controller = new AbortController();

if (scenario.umask !== undefined) {
  process.umask(scenario.umask);
}

if (scenario.abortMarker !== undefined) {
  // A fake manager writes the marker when the scenario asks, and the run is cancelled as a caller would.
  const timer = setInterval(() => {
    if (existsSync(scenario.abortMarker)) {
      clearInterval(timer);
      controller.abort();
    }
  }, 10);
  timer.unref();
}

process.exitCode = await serviceApplication(scenario).run({
  process: processHandle({
    argv,
    env: scenario.env,
    // The handle's home is the test's HOME as given, never the user database's.
    home: fixtureHome(scenario.env),
    platform: scenario.platform,
    program: scenario.program,
    release: scenario.release,
    ...(scenario.terminal === undefined ? {} : { terminal: scenario.terminal }),
  }),
  signal: controller.signal,
});
