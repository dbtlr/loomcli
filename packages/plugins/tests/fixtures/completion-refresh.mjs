import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

import { Application, Command, plugin } from '@loomcli/core';
import { refreshCompletion } from '@loomcli/plugins/completion';

/**
 * One run of an application whose `refresh` Command calls `refreshCompletion` with the binary the
 * scenario names, as a self-update's `afterReplace` would. The scenario file, named by
 * `COMPLETION_SCENARIO`, holds the binary's path, the host environment and working directory, the file
 * every log event is appended to, and the marker file whose appearance aborts the run.
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

const observer = plugin('observer', {
  onLog: (event) => {
    appendFileSync(
      scenario.events,
      `${JSON.stringify({ fields: event.fields, level: event.level, message: event.message })}\n`,
    );
  },
});

const app = new Application('notes', {
  description: 'Refresh completion.',
  plugins: [observer],
}).command(
  new Command('refresh', { description: 'Refresh completion.' }).action(
    async ({ host, log, out, signal }) => {
      await refreshCompletion({ host, log, path: scenario.path, signal });
      writeFileSync(scenario.resolved, 'resolved');
      await out.print('resolved');
    },
  ),
);

process.exitCode = await app.run({
  host: { argv: ['refresh'], cwd: scenario.cwd, env: scenario.env },
  signal: controller.signal,
});
