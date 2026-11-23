/*
 * Acceptance plan for bound fields (docs/core/logging.md#bound-fields).
 *
 * `log.with(fields)` is proven when public APIs alone produce these results:
 *
 * - Every event of the returned Log carries the bound fields, and a call's own field of the same
 *   name wins. The receiver is unchanged.
 * - It nests: `log.with(a).with(b)` carries both, and `b` wins over `a`.
 * - A bound field fills a template placeholder on the -v line, and trails as a field.
 * - The bound fields are copied at `with`, so a later change to the object changes nothing.
 * - It exists wherever a context carries `log`: an action, a middleware, a source, an `onFailure`
 *   hook, an `onEnvironment` hook, and a log destination.
 */
import { Application, InputError, plugin } from '@loomcli/core';
import type { JsonValue, Log, LogEvent } from '@loomcli/core';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** A plugin whose `onLog` hook keeps every event it hears. */
function collector(heard: LogEvent[]) {
  return plugin('fixture/collector', {
    onLog: (event) => {
      heard.push(event);
    },
  });
}

/** Each event's message and fields, as an action that logs through `body` raises them. */
async function eventsOf(
  body: (log: Log) => void,
): Promise<[string, Readonly<Record<string, JsonValue>>][]> {
  const heard: LogEvent[] = [];
  await new Application('app', { plugins: [collector(heard)] })
    .action(({ log }) => {
      body(log);
    })
    .run({ process: mockProcess() });
  return heard.map((event) => [event.message, event.fields]);
}

test("a bound Log's events carry its fields, and a call's own field of the same name wins", async () => {
  await expect(
    eventsOf((log) => {
      const request = log.with({ requestId: 'r1', user: 'u' });
      request.info('Handled.');
      request.info('Retried.', { attempt: 2, requestId: 'r2' });
      log.info('Unbound.');
    }),
  ).resolves.toEqual([
    ['Handled.', { requestId: 'r1', user: 'u' }],
    ['Retried.', { attempt: 2, requestId: 'r2', user: 'u' }],
    ['Unbound.', {}],
  ]);
});

test('with nests, the inner binding winning over the outer', async () => {
  await expect(
    eventsOf((log) => {
      log.with({ requestId: 'r1', stage: 'outer' }).with({ stage: 'inner', step: 1 }).debug('Ran.');
    }),
  ).resolves.toEqual([['Ran.', { requestId: 'r1', stage: 'inner', step: 1 }]]);
});

test('the bound fields are copied at with, so a later change to the object changes nothing', async () => {
  await expect(
    eventsOf((log) => {
      const bound = { requestId: 'r1' };
      const request = log.with(bound);
      bound.requestId = 'r2';
      request.info('Handled.');
    }),
  ).resolves.toEqual([['Handled.', { requestId: 'r1' }]]);
});

test('a bound field fills a placeholder on the -v line and trails as a field', async () => {
  const mock = mockProcess({ argv: ['-v'] });
  await new Application('app', { plugins: [verbose()] })
    .action(({ log }) => {
      log.with({ requestId: 'r1', user: 'u' }).debug('Handled {requestId}.');
    })
    .run({ process: mock });
  expect(mock.stderr.text).toBe('› Handled r1. user=u\n');
});

test('every context that carries log carries with', async () => {
  const heard: LogEvent[] = [];
  const reaching = plugin('fixture/reaching', {
    middleware: {
      activate: 'always',
      load: async () => ({
        default: async (context) => {
          context.log.with({ from: 'middleware' }).info('Bound.');
          await context.next();
        },
      }),
    },
    onEnvironment: ({ log }) => {
      log.with({ from: 'environment' }).info('Bound.');
    },
    onFailure: (_failure, { log }) => {
      log.with({ from: 'failure' }).info('Bound.');
      return undefined;
    },
  });
  const answering = plugin('fixture/answering', {
    onLog: (event, destination) => {
      if (event.fields.from === 'middleware') {
        destination.log.with({ from: 'destination' }).info('Bound.');
      }
    },
  });
  await new Application('app', { plugins: [reaching, answering, collector(heard)] })
    .action(({ log }) => {
      log.with({ from: 'action' }).info('Bound.');
      throw new InputError('Choose a value.', []);
    })
    .run({ process: mockProcess() });
  expect(
    heard.filter(({ message }) => message === 'Bound.').map(({ fields }) => fields.from),
  ).toEqual(['environment', 'destination', 'middleware', 'action', 'failure']);
});
