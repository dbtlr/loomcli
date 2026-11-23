import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

import { processHandle } from '@loomcli/core';

import { refreshApplication } from './refresh-app.ts';

/**
 * One run of the skills refresh application as a real process, for a child that handles SIGTERM
 * and a path the runtime's spawn throws on.
 * The scenario file, named by `SKILLS_SCENARIO`, holds the binary's path, the host environment and
 * working directory, the file every log event is appended to, and the marker file whose appearance
 * aborts the run.
 */
const scenario = JSON.parse(readFileSync(process.env.SKILLS_SCENARIO, 'utf8'));
const controller = new AbortController();

const timer = setInterval(() => {
  if (existsSync(scenario.abortMarker)) {
    clearInterval(timer);
    controller.abort();
  }
}, 10);
timer.unref();

const app = refreshApplication('skills', scenario.path, {
  observe: (event) => appendFileSync(scenario.events, `${JSON.stringify(event)}\n`),
  resolved: () => writeFileSync(scenario.resolved, 'resolved'),
});

process.exitCode = await app.run({
  process: processHandle({ argv: ['refresh'], cwd: scenario.cwd, env: scenario.env }),
  signal: controller.signal,
});
