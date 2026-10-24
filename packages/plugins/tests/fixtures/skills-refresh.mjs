import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

import { Application, Command, plugin, processHandle } from '@loomcli/core';
import { refreshSkills } from '@loomcli/plugins/skills';

/**
 * One run of an application whose `refresh` Command calls `refreshSkills` with the binary the
 * scenario names, as a self-update's `afterReplace` would. The scenario file, named by
 * `SKILLS_SCENARIO`, holds the binary's path, the host environment and working directory, the file
 * every log event is appended to, and the marker file whose appearance aborts the run.
 */
const scenario = JSON.parse(readFileSync(process.env.SKILLS_SCENARIO, 'utf8'));
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

const observer = plugin('observer', {
  onLog: (event) => {
    appendFileSync(
      scenario.events,
      `${JSON.stringify({ fields: event.fields, level: event.level, message: event.message })}\n`,
    );
  },
});

const app = new Application('notes', {
  description: 'Refresh skills.',
  plugins: [observer],
}).command(
  new Command('refresh', { description: 'Refresh the skills.' }).action(
    async ({ host, log, out, signal }) => {
      await refreshSkills({ host, log, path: scenario.path, signal });
      writeFileSync(scenario.resolved, 'resolved');
      await out.print('resolved');
    },
  ),
);

process.exitCode = await app.run({
  process: processHandle({ argv: ['refresh'], cwd: scenario.cwd, env: scenario.env }),
  signal: controller.signal,
});
