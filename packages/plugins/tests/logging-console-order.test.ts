/*
 * The logging plugin's console destination off a terminal, under "Where" in "At -v" of
 * docs/core/logging.md and ADR-0157. A process fixture runs an application with the logging plugin
 * writing records to the console at `debug`, the verbose plugin, and a progress line, and the test
 * reads its stderr through a pipe, so stderr is not a terminal (ADR-0103):
 *
 * - Call order. The records, the `-v` lines, a warning, and the progress line's start and end lines
 *   reach stderr in the order the action made the calls, each record right after its own log line.
 * - The process's end. A record logged right before `process.exit()` still reaches stderr, after
 *   the warning queued before it. What `onShutdown` handlers log, and the event for a handler that
 *   throws, reach stderr at `process.exit(5)`, at SIGTERM's shutdown, and at SIGQUIT's.
 * - An abort. A record with nothing queued ahead of it reaches stderr in the log call, so a SIGKILL
 *   right after it, which emits no exit event, still finds it written, `-v`'s line included.
 */
import { expect, test } from 'vite-plus/test';

import { invokeWithoutCoreDump } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/logging-console-run.mjs', import.meta.url);

/** The stderr of one run, with each record's time and run id replaced by a stable marker. */
function stderrOf(argv: string[]): { status: number | null; stderr: string } {
  const { status, stderr } = invokeWithoutCoreDump(fixture, argv);
  return {
    status,
    stderr: stderr
      .replaceAll(/"time":"[^"]+"/gu, '"time":"<time>"')
      .replaceAll(/"run":"[0-9a-f]{32}"/gu, '"run":"<run>"'),
  };
}

/**
 * The bytes of one console record of the fixture application, as stderrOf marks them. The keys are
 * entries in the record order, which a lint fix cannot sort.
 */
function record(
  level: string,
  message: string,
  fields: Record<string, unknown>,
  path: string[],
): string {
  const entries: [string, unknown][] = [
    ['time', '<time>'],
    ['level', level],
    ['message', message],
    ['fields', fields],
    ['application', { name: 'ledger', version: '0.0.0' }],
    ['run', '<run>'],
    ['path', path],
    ['plugin', null],
  ];
  return `${JSON.stringify(Object.fromEntries(entries))}\n`;
}

test('off a terminal, console records keep call order with log lines, warnings, and a progress line', () => {
  expect(stderrOf(['-v', 'order'])).toEqual({
    status: 0,
    stderr: [
      'ℹ Fetching records\n',
      '› Fetched 3 records.\n',
      record('info', 'Fetched {count} records.', { count: 3 }, ['order']),
      '⚠ The cache is stale.\n',
      '› Retrying db.\n',
      record('warn', 'Retrying {host}.', { host: 'db' }, ['order']),
      '› Skipped 1 rows.\n',
      record('debug', 'Skipped {count} rows.', { count: 1 }, ['order']),
      '✔ Fetched 3 records.\n',
    ].join(''),
  });
});

// A process test under ADR-0103: the action ends a real process with process.exit().
test('off a terminal, a record logged right before process.exit() still reaches stderr in call order', () => {
  expect(stderrOf(['-v', 'leave'])).toEqual({
    status: 3,
    stderr: [
      '⚠ Leaving early.\n',
      '› Before the exit.\n',
      record('info', 'Before the exit.', {}, ['leave']),
    ].join(''),
  });
});

/** Each console record one run wrote to stderr, parsed. */
function recordsOf(argv: string[]): { status: number | null; records: unknown[] } {
  // SIGQUIT asks for a core dump, which a Bun process streams for gigabytes on a CI runner.
  const { status, stderr } = invokeWithoutCoreDump(fixture, argv);
  const records = stderr
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
  return { records, status };
}

/** What the fixture's shutdown handlers log, the newest handler's throw first. */
const stopped = [
  expect.objectContaining({
    fields: { error: expect.objectContaining({ message: 'Stuck.' }) },
    level: 'error',
    message: 'A shutdown handler failed.',
  }),
  expect.objectContaining({ fields: {}, level: 'info', message: 'Stopping.' }),
];

// A process test under ADR-0103: the action ends a real process with process.exit().
test("off a terminal, a shutdown handler's records reach stderr at process.exit()", () => {
  expect(recordsOf(['stop'])).toEqual({ records: stopped, status: 5 });
});

// A process test under ADR-0103: the process sends itself SIGTERM or SIGQUIT, and the re-raise ends it.
test.each(['term', 'quit'])(
  "off a terminal, a shutdown handler's records reach stderr at a shutdown's end (%s)",
  (command) => {
    expect(recordsOf([command])).toEqual({ records: stopped, status: null });
  },
);

// A process test under ADR-0103: SIGKILL ends the process inside the call, as an abort does.
test('off a terminal, a record with nothing queued ahead of it reaches stderr before a kill', () => {
  expect(stderrOf(['kill'])).toEqual({
    status: null,
    stderr: record('info', 'Before the kill.', {}, ['kill']),
  });
});

// A process test under ADR-0103: the log line and the record are both written in the call.
test('off a terminal, a log line and its record both reach stderr before a kill', () => {
  expect(stderrOf(['-v', 'kill'])).toEqual({
    status: null,
    stderr: ['› Before the kill.\n', record('info', 'Before the kill.', {}, ['kill'])].join(''),
  });
});

// A process test under ADR-0103: each end runs handlers after flushing the run's queue.
test.each([
  { command: 'handler-exit', flags: [], status: 7 },
  { command: 'handler-exit', flags: ['-v'], status: 7 },
  { command: 'handler-term', flags: [], status: null },
  { command: 'handler-term', flags: ['-v'], status: null },
])(
  'off a terminal, a shutdown warning precedes its record after the end flush ($command $flags)',
  ({ command, flags, status }) => {
    expect(stderrOf([...flags, command])).toEqual({
      status,
      stderr: [
        '⚠ handler warn\n',
        ...(flags.length === 0 ? [] : ['› handler record\n']),
        record('info', 'handler record', {}, [command]),
      ].join(''),
    });
  },
);
