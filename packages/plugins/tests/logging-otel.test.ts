import { Application, Command, plugin } from '@loomcli/core';
import type { LogEvent } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';
import type { OpenTelemetryLogger } from '@loomcli/plugins/logging';
import { logs } from '@opentelemetry/api-logs';
import type { LogRecord } from '@opentelemetry/api-logs';
import { expect, test } from 'vite-plus/test';

test('an OpenTelemetry destination emits the template and redacted fields with run facts', async () => {
  const records: LogRecord[] = [];
  const events: LogEvent[] = [];
  const app = new Application('notes', {
    log: { redact: ['session.token'] },
    plugins: [
      plugin('capture', {
        onLog: (event) => {
          events.push(event);
          return undefined;
        },
      }),
      logging({
        destinations: [
          {
            logger: {
              emit: (record) => {
                records.push(record);
              },
            },
            to: 'otel',
          },
        ],
      }),
    ],
    version: '1.2.3',
  }).command(
    new Command('index').action(({ log }) => {
      log.info('Indexed {count} sessions.', {
        count: 3,
        items: [null, { name: 'one' }],
        'service.name': 'field name stays distinct',
        session: { active: true, token: 'secret' },
      });
    }),
  );

  await app.invoke(['index'], {});
  expect(records).toEqual([
    {
      attributes: {
        'loom.fields': {
          count: 3,
          items: [null, { name: 'one' }],
          'service.name': 'field name stays distinct',
          session: { active: true, token: '[Redacted]' },
        },
        'loom.path': ['index'],
        'loom.plugin': null,
        'loom.run': expect.stringMatching(/^[0-9a-f]{32}$/u),
        'service.name': 'notes',
        'service.version': '1.2.3',
      },
      body: 'Indexed {count} sessions.',
      severityNumber: 9,
      severityText: 'info',
      timestamp: new Date(events[0]?.time ?? ''),
    },
  ]);
});

test('a failure event carries its form and defect using exception semantic attributes', async () => {
  const records: LogRecord[] = [];
  const events: LogEvent[] = [];
  const app = new Application('notes', {
    plugins: [
      plugin('capture', {
        onLog: (event) => {
          events.push(event);
          return undefined;
        },
      }),
      logging({
        destinations: [
          {
            level: 'error',
            logger: {
              emit: (record) => {
                records.push(record);
              },
            },
            to: 'otel',
          },
        ],
      }),
    ],
  }).command(
    new Command('fail').action(() => {
      throw new TypeError('The action failed.');
    }),
  );

  await app.invoke(['fail'], {});
  expect(records).toEqual([
    {
      attributes: {
        'exception.message': 'The action failed.',
        'exception.stacktrace': expect.stringContaining('TypeError: The action failed.'),
        'exception.type': 'TypeError',
        'loom.failure': { code: 'internal', exitCode: 1, hints: [], message: 'The action failed.' },
        'loom.fields': {},
        'loom.path': ['fail'],
        'loom.plugin': null,
        'loom.run': expect.stringMatching(/^[0-9a-f]{32}$/u),
        'service.name': 'notes',
        'service.version': '0.0.0',
      },
      body: 'The action failed.',
      severityNumber: 21,
      severityText: 'fatal',
      timestamp: new Date(events[0]?.time ?? ''),
    },
  ]);
});

test('an API Logger satisfies the structural destination contract', () => {
  const logger: OpenTelemetryLogger = logs.getLogger('loom-test');
  expect(logging({ destinations: [{ logger, to: 'otel' }] })).toBeDefined();
});

test('destinations filter independently and emit in declaration order at the OTel severities', async () => {
  const records: LogRecord[] = [];
  const order: string[] = [];
  const app = new Application('notes', {
    plugins: [
      logging({
        destinations: [
          {
            level: 'trace',
            logger: {
              emit: (record) => {
                records.push(record);
                order.push(`all:${record.severityText}`);
              },
            },
            to: 'otel',
          },
          {
            level: 'warn',
            logger: {
              emit: (record) => {
                order.push(`warn:${record.severityText}`);
              },
            },
            to: 'otel',
          },
        ],
      }),
    ],
  }).action(({ log }) => {
    log.trace('Trace.');
    log.debug('Debug.');
    log.info('Info.');
    log.warn('Warn.');
    log.error('Error.');
  });
  await app.invoke([], {});
  expect(records.map(({ severityNumber, severityText }) => [severityNumber, severityText])).toEqual(
    [
      [1, 'trace'],
      [5, 'debug'],
      [9, 'info'],
      [13, 'warn'],
      [17, 'error'],
    ],
  );
  expect(order).toEqual([
    'all:trace',
    'all:debug',
    'all:info',
    'all:warn',
    'warn:warn',
    'all:error',
    'warn:error',
  ]);
});

test('an author emit that throws follows the ordinary hook failure path', async () => {
  const later: LogRecord[] = [];
  const app = new Application('notes', {
    plugins: [
      logging({
        destinations: [
          {
            logger: {
              emit: () => {
                throw new Error('The logger broke.');
              },
            },
            to: 'otel',
          },
          {
            logger: {
              emit: (record) => {
                later.push(record);
              },
            },
            to: 'otel',
          },
        ],
      }),
    ],
  }).action(({ log }) => {
    log.info('Before the throw.');
  });
  const outcome = await app.invoke([], {});
  expect(outcome.status).toBe('failed');
  expect(outcome).toMatchObject({
    exitCode: 1,
    failure: { rule: { identity: '@loomcli/core/foreign-throw' } },
  });
  expect(later).toEqual([]);
});
