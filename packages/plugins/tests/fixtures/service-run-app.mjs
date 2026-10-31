import { existsSync, writeFileSync } from 'node:fs';

import { Application, Command } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { service } from '@loomcli/plugins/service';
import { mockProcess } from '@loomcli/testing';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], given = {}) {
  const env = given.env ?? {};
  let status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  let captured = output;
  const capture = (fields) => {
    const { terminal, ...facts } = fields;
    const handle = mockProcess({
      env,
      ...facts,
      cwd: given.cwd,
      programs: given.programs,
      uid: given.uid,
      ...(terminal !== undefined
        ? {
            terminal: {
              columns: terminal.stdout?.columns ?? terminal.stderr?.columns,
              rows: 24,
              streams: ['stdout', 'stderr'].filter((name) => terminal[name]?.isTTY),
              ...(terminal.background === undefined ? {} : { background: terminal.background }),
            },
          }
        : {}),
    });
    handles.push(handle);
    captured = handle;
    return handle;
  };

  /** Service commands on the scenario's platform, program, release, and scripted managers. */
  const argv = args;

  const scenario = given;

  const controller = new AbortController();
  let timer = undefined;
  try {
    if (scenario.abortMarker !== undefined) {
      // A fake manager writes the marker when the scenario asks, and the run is cancelled as a caller would.
      timer = setInterval(() => {
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

    status = await app.run({
      process: capture({
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
  } finally {
    if (timer !== undefined) {
      clearInterval(timer);
    }
  }
  return {
    status: captured.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

export { run };
