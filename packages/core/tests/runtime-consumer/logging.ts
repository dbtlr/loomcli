import { Application } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';
import type { LoggingError } from '@loomcli/plugins/logging';

// The packed logging plugin appends one record for each event to the file under the state directory.
// The consumer compiles against its declaration, `onError` and its error included. The host pins the
// Linux platform, so every OS writes under the temporary XDG_STATE_HOME the check passes, never home.
const failures: LoggingError['kind'][] = [];

const app = new Application('packed-logging', {
  plugins: [
    logging({
      level: 'debug',
      onError: (error) => {
        failures.push(error.kind);
        return undefined;
      },
    }),
  ],
}).action(async ({ log, out }) => {
  log.info('Logged from the packed plugin.', { count: 3 });
  await out.print(`failures:${failures.length}`);
});

await app.run({
  host: { argv: process.argv.slice(2), platform: 'linux', release: { build: 'distributed' } },
});
