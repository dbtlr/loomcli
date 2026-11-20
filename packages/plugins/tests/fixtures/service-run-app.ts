import { existsSync, writeFileSync } from 'node:fs';

import { Application, Command } from '@loomcli/core';
import type { ProcessTerminal, ReleaseFacts } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { logging } from '@loomcli/plugins/logging';
import { service } from '@loomcli/plugins/service';
import type { ServiceSettings } from '@loomcli/plugins/service';
import type { MockFields } from '@loomcli/testing';

import { runOnMock } from './in-process.ts';

interface Scenario {
  environment?: Readonly<Record<string, string>> | undefined;
  output?: string | undefined;
  stopTimeout?: number | undefined;
  logging?: 'files' | 'console' | undefined;
  logFiles?: readonly string[] | undefined;
  cwd: string;
  env: Record<string, string | undefined>;
  platform: string;
  program: readonly string[];
  release: ReleaseFacts;
  uid: number;
  label?: string | undefined;
  description?: string | null | undefined;
  run?: readonly string[] | undefined;
  probe?: 'rows' | 'throw' | undefined;
  probeLog?: string | undefined;
  abortMarker?: string | undefined;
  terminal?: ProcessTerminal | undefined;
  programs?: MockFields['programs'];
}

function serviceApplication(scenario: Scenario) {
  /** The probe the scenario names: one that records what it received, or one that throws. */
  function probe(): Pick<ServiceSettings, 'probe'> {
    if (scenario.probe === undefined) {
      return {};
    }
    return {
      probe: async ({ host, invoke, log, signal, state }) => {
        if (scenario.probeLog === undefined) {
          throw new Error('A probe requires probeLog.');
        }
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
        if (outcome.status !== 'completed') {
          throw new Error('The health probe did not complete.');
        }
        return [{ name: 'health', value: outcome.output.trim() }];
      },
    };
  }

  return new Application('notes', {
    ...(scenario.description === null
      ? {}
      : { description: scenario.description ?? 'Keep notes in sync.' }),
    plugins: [
      format(),
      ...(scenario.logging === undefined
        ? []
        : [
            logging({
              destinations:
                scenario.logging === 'console'
                  ? [{ to: 'console' }]
                  : (scenario.logFiles ?? []).map((file) => ({ file, level: 'error', to: 'file' })),
            }),
          ]),
      service({
        label: scenario.label ?? 'com.acme.notes',
        run: scenario.run ?? ['serve'],
        ...(scenario.environment === undefined
          ? {}
          : { environment: ({ env }) => ({ ...scenario.environment, PATH: env.PATH ?? '' }) }),
        ...(scenario.output === undefined ? {} : { output: scenario.output }),
        ...(scenario.stopTimeout === undefined ? {} : { stopTimeout: scenario.stopTimeout }),
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
}

async function run(args: string[], scenario: Scenario) {
  const controller = new AbortController();
  const marker = scenario.abortMarker;
  const timer =
    marker === undefined
      ? undefined
      : setInterval(() => {
          if (existsSync(marker)) {
            controller.abort();
          }
        }, 10);
  timer?.unref();
  try {
    const streams: ('stdout' | 'stderr')[] = [];
    if (scenario.terminal?.stdout.isTTY) {
      streams.push('stdout');
    }
    if (scenario.terminal?.stderr.isTTY) {
      streams.push('stderr');
    }
    return await runOnMock(
      serviceApplication(scenario),
      {
        argv: args,
        cwd: scenario.cwd,
        env: scenario.env,
        home: scenario.env.HOME ?? '',
        platform: scenario.platform,
        program: scenario.program,
        release: scenario.release,
        uid: scenario.uid,
        ...(scenario.programs === undefined ? {} : { programs: scenario.programs }),
        ...(scenario.terminal === undefined
          ? {}
          : {
              terminal: {
                columns: scenario.terminal.stdout.columns ?? scenario.terminal.stderr.columns ?? 80,
                rows: 24,
                streams,
                ...(scenario.terminal.background === undefined
                  ? {}
                  : { background: scenario.terminal.background }),
              },
            }),
      },
      { signal: controller.signal },
    );
  } finally {
    if (timer !== undefined) {
      clearInterval(timer);
    }
  }
}

export { run, serviceApplication };
export type { Scenario };
