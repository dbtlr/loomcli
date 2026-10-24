import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import { Application, Command, plugin, processHandle } from '@loomcli/core';
import { refreshManpages } from '@loomcli/plugins/manpage';

/**
 * One run of an application whose `refresh` Command calls `refreshManpages` with the binary the
 * scenario names, as a self-update's `afterReplace` would. The scenario file, named by
 * `MANPAGE_SCENARIO`, holds the binary's path, the host environment and working directory, and the
 * file every log event is appended to.
 */
const scenario = JSON.parse(readFileSync(process.env.MANPAGE_SCENARIO, 'utf8'));

const observer = plugin('observer', {
  onLog: (event) => {
    appendFileSync(
      scenario.events,
      `${JSON.stringify({ fields: event.fields, level: event.level, message: event.message })}\n`,
    );
  },
});

const app = new Application('notes', {
  description: 'Refresh man pages.',
  plugins: [observer],
}).command(
  new Command('refresh', { description: 'Refresh the man pages.' }).action(
    async ({ host, log, out, signal }) => {
      await refreshManpages({ host, log, path: scenario.path, signal });
      writeFileSync(scenario.resolved, 'resolved');
      await out.print('resolved');
    },
  ),
);

process.exitCode = await app.run({
  process: processHandle({ argv: ['refresh'], cwd: scenario.cwd, env: scenario.env }),
});
