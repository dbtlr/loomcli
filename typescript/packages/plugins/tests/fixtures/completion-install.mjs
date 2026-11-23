import { existsSync, readFileSync } from 'node:fs';

import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { completionInstallationApplication } from './completion-install-app.ts';

/**
 * One run of an application named `jsonkit` that installs `completion()`. The scenario file, named
 * by `COMPLETION_SCENARIO`, holds the host's environment, working directory, and platform, the
 * umask, and the marker file whose appearance aborts the run, so a test sets every folder the
 * plugin reads and nothing reaches the real home.
 */
const scenario = JSON.parse(readFileSync(process.env.COMPLETION_SCENARIO, 'utf8'));
const controller = new AbortController();

if (scenario.abortMarker !== undefined) {
  const timer = setInterval(() => {
    if (existsSync(scenario.abortMarker)) {
      clearInterval(timer);
      controller.abort();
    }
  }, 10);
  timer.unref();
}

if (scenario.umask !== undefined) {
  process.umask(scenario.umask);
}

process.exitCode = await completionInstallationApplication().run({
  process: processHandle({
    argv: process.argv.slice(2),
    cwd: scenario.cwd,
    env: scenario.env,
    // The handle's home is the test's HOME as given, never the user database's.
    home: fixtureHome(scenario.env),
    platform: scenario.platform ?? 'linux',
    // A scenario with `columns` runs on a terminal that wide, so lanes wrap.
    ...(scenario.columns === undefined
      ? {}
      : {
          terminal: {
            stderr: { columns: scenario.columns, isTTY: true, rows: 24 },
            stdin: { isTTY: false },
            stdout: { columns: scenario.columns, isTTY: true, rows: 24 },
          },
        }),
  }),
  signal: controller.signal,
});
