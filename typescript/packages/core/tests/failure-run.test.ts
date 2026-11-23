/*
 * A failure hook reads the run it failed in, and the failure's event reaches every `onLog` hook
 * before the failure hooks run, so a hint can name a record the event made:
 *
 * - `context.run` is the `run` of the run's events, the failure event's included.
 * - The failure event is heard before the failure hook is called, and its form carries no hints,
 *   while the report the operator reads carries them.
 * - A log destination's `out.warn` reaches the operator's stderr at verbosity 0.
 */
import { Application, FatalError, plugin } from '@loomcli/core';
import type { LogEvent } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

test('a failure hook reads the run of the failure event it follows', async () => {
  const heard: LogEvent[] = [];
  const seen: { run: string; heard: number }[] = [];
  const observing = plugin('fixture/observing', {
    onFailure: (_failure, { run }) => {
      seen.push({ heard: heard.length, run });
      return 'A hint.';
    },
    onLog: (event) => {
      heard.push(event);
    },
  });
  const mock = mockProcess();
  await new Application('app', { plugins: [observing] })
    .action(() => {
      throw new FatalError('The run failed.');
    })
    .run({ process: mock });
  const [failure] = heard;
  expect(heard).toHaveLength(1);
  expect(failure?.failure?.hints).toEqual([]);
  expect(seen).toEqual([{ heard: 1, run: failure?.run }]);
  expect(mock.stderr.text).toContain('A hint.');
});

test("a log destination's warn reaches stderr at verbosity 0", async () => {
  const warning = plugin('fixture/warning', {
    onLog: (_event, destination) => {
      void destination.out.warn('Using the declared level.');
    },
  });
  const mock = mockProcess();
  await new Application('app', { plugins: [warning] })
    .action(({ log }) => {
      log.debug('Detail.');
    })
    .run({ process: mock });
  expect(mock.stderr.text).toContain('Using the declared level.');
  expect(mock.stderr.text).not.toContain('Detail.');
});
