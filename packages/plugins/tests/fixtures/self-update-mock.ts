import type { Writable } from 'node:stream';

import type { MockFields } from '@loomcli/testing';

import { runOnMock } from './in-process.ts';
import { selfUpdateApplication } from './self-update-app.ts';
import type { UpdateScenario } from './self-update-app.ts';

/** Run with a scoped fake GitHub and forward the observing sink into the mock's recording. */
export async function runSelfUpdate(scenario: UpdateScenario, fields: MockFields, umask = 0o022) {
  let recording: Writable | undefined = undefined;
  const controller = new AbortController();
  const { app, fetch, stderr } = selfUpdateApplication(scenario, controller, {
    holdForRun: async () => {},
    record: () => {},
    writeStderr: (chunk) => {
      if (recording === undefined) {
        throw new Error('The stderr recorder is not attached.');
      }
      recording.write(chunk);
    },
  });
  const previousFetch = globalThis.fetch;
  const previousUmask = process.umask(umask);
  globalThis.fetch = fetch;
  try {
    return await runOnMock(
      app,
      { cwd: '/loom-test', env: {}, platform: 'linux', ...fields },
      {
        signal: controller.signal,
        stderr: (sink) => {
          recording = sink;
          return stderr;
        },
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
    process.umask(previousUmask);
  }
}
