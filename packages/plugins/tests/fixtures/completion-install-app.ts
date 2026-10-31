import { existsSync } from 'node:fs';

import { Application, Command } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';
import type { MockFields } from '@loomcli/testing';

import { runOnMock } from './in-process.ts';

interface Scenario {
  cwd?: string | undefined;
  env?: Record<string, string | undefined>;
  platform?: string | undefined;
  uid?: number | undefined;
  columns?: number | undefined;
  abortMarker?: string | undefined;
  programs?: MockFields['programs'];
}

/** One application for isolated installation runs and the process fixture. */
function completionInstallationApplication() {
  return new Application('jsonkit', {
    description: 'Read JSON.',
    plugins: [help(), completion()],
  }).command(
    new Command('ping', { description: 'Answer.' }).action(({ out }) => out.print('pong')),
  );
}

async function run(args: string[] = [], scenario: Scenario = {}) {
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
    return await runOnMock(
      completionInstallationApplication(),
      {
        argv: args,
        ...(scenario.cwd === undefined ? {} : { cwd: scenario.cwd }),
        env: scenario.env ?? {},
        home: scenario.env?.HOME ?? '',
        platform: scenario.platform ?? 'linux',
        ...(scenario.programs === undefined ? {} : { programs: scenario.programs }),
        ...(scenario.uid === undefined ? {} : { uid: scenario.uid }),
        ...(scenario.columns === undefined
          ? {}
          : {
              terminal: { columns: scenario.columns, rows: 24 },
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

export { completionInstallationApplication, run };
export type { Scenario };
