import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { Application, Command } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { service } from '@loomcli/plugins/service';

/**
 * One run of an application that installs `service()`, against fake service managers the test puts
 * first on `PATH`. The scenario file names the platform, the program, the release facts, the label
 * and run words, the probe, and the marker file whose appearance aborts the run.
 */
const [scenarioPath, ...argv] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const controller = new AbortController();

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

/** The probe the scenario names: one that records what it received, or one that throws. */
function probe() {
  if (scenario.probe === undefined) {
    return {};
  }
  return {
    probe: async ({ host, invoke, log, signal, state }) => {
      writeFileSync(
        scenario.probeLog,
        JSON.stringify({
          aborted: signal.aborted,
          log: typeof log.info,
          platform: host.platform,
          state,
        }),
      );
      if (scenario.probe === 'throw') {
        throw new Error('The probe failed.');
      }
      const outcome = await invoke(['health'], {});
      return [{ name: 'health', value: outcome.output.trim() }];
    },
  };
}

const app = new Application('notes', {
  ...(scenario.description === null
    ? {}
    : { description: scenario.description ?? 'Keep notes in sync.' }),
  plugins: [
    format(),
    service({
      label: scenario.label ?? 'com.acme.notes',
      run: scenario.run ?? ['serve'],
      ...probe(),
    }),
  ],
})
  .command(
    new Command('serve', { description: 'Serve the notes.' })
      .option('port', { description: 'The port to serve on.', type: 'string' })
      .action(({ out }) => out.print('serving')),
  )
  .command(
    new Command('health', { description: 'Report the health.' }).action(({ out }) =>
      out.print('ok, v1.5.0'),
    ),
  )
  .command(
    new Command('cache', { description: 'Manage the cache.' }).command(
      new Command('clear', { description: 'Clear the cache.' }).action(({ out }) =>
        out.print('cleared'),
      ),
    ),
  );

process.exitCode = await app.run({
  host: {
    argv,
    env: scenario.env,
    platform: scenario.platform,
    program: scenario.program,
    release: scenario.release,
  },
  signal: controller.signal,
});
