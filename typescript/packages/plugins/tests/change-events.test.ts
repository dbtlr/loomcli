import { Application, plugin } from '@loomcli/core';
import type { Log, LogEvent, MiddlewareContext } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { binaryReplaced, fileRemoved, fileWritten, programRun } from '../src/change-events.js';

/**
 * The four change events every first-party plugin shares, under ADR-0165 and Change events in the
 * logging reference: each is one `info` event with its fixed message and fields, raised through
 * the `log` the plugin's context already holds, so its `plugin` field names that context's plugin.
 */

/** The events a run's `onLog` observer saw, in order. */
async function eventsOf(raise: (log: Log) => void): Promise<readonly LogEvent[]> {
  const seen: LogEvent[] = [];
  const observer = plugin('fixture/observer', {
    onLog: (event) => {
      seen.push(event);
      return undefined;
    },
  });
  const raiser = plugin('fixture/raiser', {
    middleware: {
      activate: 'always',
      load: async () => ({
        default: async ({ log, next }: Pick<MiddlewareContext, 'log' | 'next'>) => {
          raise(log);
          await next();
        },
      }),
    },
  });
  await new Application('app', { plugins: [observer, raiser] })
    .action(() => {})
    .run({ process: mockProcess() });
  return seen;
}

test('each change is one info event with its message and fields, under the raising plugin', async () => {
  const events = await eventsOf((log) => {
    fileWritten(log, { path: '/home/me/.local/state/notes/installation/completion.bash.json' });
    fileRemoved(log, { path: '/home/me/.local/share/bash-completion/completions/notes' });
    programRun(log, { arguments: ['--user', 'daemon-reload'], code: 0, program: 'systemctl' });
    binaryReplaced(log, { from: '1.5.0', path: '/home/me/.local/bin/notes', to: '1.5.1' });
  });
  expect(
    events.map(({ fields, level, message, plugin: name }) => ({ fields, level, message, name })),
  ).toEqual([
    {
      fields: { path: '/home/me/.local/state/notes/installation/completion.bash.json' },
      level: 'info',
      message: 'File written.',
      name: 'fixture/raiser',
    },
    {
      fields: { path: '/home/me/.local/share/bash-completion/completions/notes' },
      level: 'info',
      message: 'File removed.',
      name: 'fixture/raiser',
    },
    {
      fields: { arguments: ['--user', 'daemon-reload'], code: 0, program: 'systemctl' },
      level: 'info',
      message: 'Program run.',
      name: 'fixture/raiser',
    },
    {
      fields: { from: '1.5.0', path: '/home/me/.local/bin/notes', to: '1.5.1' },
      level: 'info',
      message: 'Binary replaced.',
      name: 'fixture/raiser',
    },
  ]);
});
