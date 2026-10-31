import type { Writable } from 'node:stream';

import type { MockFields } from '@loomcli/testing';

import { runOnMock } from './in-process.ts';
import { selfUpdateApplication } from './self-update-app.ts';
import type { UpdateScenario } from './self-update-app.ts';

/**
 * Run with a scoped fake GitHub and forward the observing sink into the mock's recording;
 * `requested` receives the URL of each request the fake answers.
 */
export async function runSelfUpdate(
  scenario: UpdateScenario,
  fields: MockFields,
  options: {
    readonly umask?: number | undefined;
    readonly requested?: (url: string) => void;
  } = {},
) {
  const { umask = 0o022, requested = () => {} } = options;
  let recording: Writable | undefined = undefined;
  const controller = new AbortController();
  const { app, fetch, stderr } = selfUpdateApplication(scenario, controller, {
    requested,
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
