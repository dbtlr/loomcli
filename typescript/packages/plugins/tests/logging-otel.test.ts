import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command, FatalError, plugin } from '@loomcli/core';
import type { LogEvent } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';
import type { OpenTelemetryLogger, OpenTelemetryLogRecord } from '@loomcli/plugins/logging';
import { mockProcess } from '@loomcli/testing';
import { logs } from '@opentelemetry/api-logs';
import { expect, test } from 'vite-plus/test';

test('an OpenTelemetry destination emits the template and redacted fields with run facts', async () => {
  const records: OpenTelemetryLogRecord[] = [];
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
  const records: OpenTelemetryLogRecord[] = [];
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

test('a logger may mutate its copies without changing later OpenTelemetry or file records', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loom-otel-'));
  const file = join(root, 'notes.jsonl');
  const first: OpenTelemetryLogRecord[] = [];
  const second: OpenTelemetryLogRecord[] = [];
  const app = new Application('notes', {
    plugins: [
      logging({
        destinations: [
          {
            logger: {
              emit: (record) => {
                const {
                  'loom.failure': failure,
                  'loom.fields': fields,
                  'loom.path': path,
                } = record.attributes;
                if (fields !== null && typeof fields === 'object' && !Array.isArray(fields)) {
                  fields.sdk = true;
                  const items = fields.items;
                  if (Array.isArray(items)) {
                    items.push('SDK item');
                    const [item] = items;
                    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                      item.name = 'SDK name';
                    }
                  }
                }
                if (Array.isArray(path)) {
                  path.push('sdk');
                }
                if (failure !== null && typeof failure === 'object' && !Array.isArray(failure)) {
                  failure.message = 'SDK failure';
                  const hints = failure.hints;
                  if (Array.isArray(hints)) {
                    hints.push('SDK hint');
                  }
                }
                first.push(record);
              },
            },
            to: 'otel',
          },
          {
            logger: {
              emit: (record) => {
                second.push(record);
              },
            },
            to: 'otel',
          },
          { file },
        ],
      }),
    ],
  })
    .command(
      new Command('load').action(({ log }) => {
        log.info('Loading notes.', { items: [{ name: 'one' }] });
        throw new FatalError('Could not load notes.');
      }),
    )
    .action(async ({ invoke }) => {
      const result = await invoke(['load'], {});
      expect(result.status).toBe('failed');
    });

  try {
    const process = mockProcess({ cwd: root, env: {}, home: root, platform: 'linux' });
    const outcome = await app.invoke([], {}, { process });
    expect(outcome.status).toBe('completed');
    const event = { fields: { items: [{ name: 'one' }] }, path: ['load'] };
    const failure = { code: 'fatal', exitCode: 1, hints: [], message: 'Could not load notes.' };
    expect(first.map(({ attributes }) => attributes)).toMatchObject([
      {
        'loom.fields': { items: [{ name: 'SDK name' }, 'SDK item'], sdk: true },
        'loom.path': ['load', 'sdk'],
      },
      {
        'loom.failure': { ...failure, hints: ['SDK hint'], message: 'SDK failure' },
        'loom.path': ['load', 'sdk'],
      },
    ]);
    const unchanged = [
      [event.fields, event.path, undefined],
      [{}, event.path, failure],
    ];
    expect(
      second.map(({ attributes }) => [
        attributes['loom.fields'],
        attributes['loom.path'],
        attributes['loom.failure'],
      ]),
    ).toEqual(unchanged);
    const written = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const { fields, path, failure: loggedFailure } = JSON.parse(line);
        return [fields, path, loggedFailure];
      });
    expect(written).toEqual(unchanged);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('destinations filter independently and emit in declaration order at the OTel severities', async () => {
  const records: OpenTelemetryLogRecord[] = [];
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
  const later: OpenTelemetryLogRecord[] = [];
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
