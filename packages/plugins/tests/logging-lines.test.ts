/*
 * The logging plugin's -v and -vv lines, under "At -v and in the log" in its reference and
 * ADR-0165. Each case logs to a file in a fresh directory under the temporary directory, runs an
 * application with the logging and verbose plugins on a mock, and removes the directory.
 *
 * - The default verbosity writes no line of the plugin's own.
 * - At -v the plugin names its file once per outermost run, after the first record it appends, and
 *   a run that appends none writes no line; with `to: 'console'` it writes neither line. Its lines
 *   are log events of its own, which never come back to its hook, so the file holds none of them.
 * - At -vv each rotation that renamed or deleted the file is named, `keep: 0` included.
 * - The lines follow the outermost run: an action's invoke writes them on the outer run's stderr,
 *   and an invocation by name in its messages, when its values ask for them.
 * - A control character in the path is escaped.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command } from '@loomcli/core';
import type { Log } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';
import type { LoggingSettings } from '@loomcli/plugins/logging';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** Runs a case with a fresh directory for the log file, and removes it after. */
async function inDirectory(body: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'loom-logging-lines-'));
  try {
    await body(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** The application: logging with the settings, -v and -q, and an action that logs. */
function application(settings: LoggingSettings, logs: (log: Log) => void) {
  return new Application('notes', { plugins: [logging(settings), verbose()] }).action(({ log }) => {
    logs(log);
  });
}

/** The stderr of one run with the argv, logging the events `logs` raises. */
async function stderrOf(
  settings: LoggingSettings,
  argv: readonly string[],
  logs: (log: Log) => void,
): Promise<string> {
  const mock = mockProcess({ argv });
  await application(settings, logs).run({ process: mock });
  return mock.stderr.text;
}

const twice = (log: Log) => {
  log.info('Indexed.');
  log.info('Synced.');
};

const below = (log: Log) => {
  log.debug('Below the level.');
};

test('the default verbosity writes no line of its own', async () => {
  await inDirectory(async (directory) => {
    const file = join(directory, 'notes.jsonl');
    await expect(stderrOf({ file }, [], twice)).resolves.toBe('');
    expect(readFileSync(file, 'utf8').split('\n')).toHaveLength(3);
  });
});

test('-v names the file once per run, after the first record it appends', async () => {
  await inDirectory(async (directory) => {
    const file = join(directory, 'notes.jsonl');
    const lines = `› Indexed.\n› Logging to ${file}.\n› Synced.\n`;
    await expect(stderrOf({ file }, ['-v'], twice)).resolves.toBe(lines);
    await expect(stderrOf({ file }, ['-v'], twice)).resolves.toBe(lines);
  });
});

test("the plugin's own lines never reach its own hook, so the file records none", async () => {
  await inDirectory(async (directory) => {
    const file = join(directory, 'notes.jsonl');
    writeFileSync(file, `${'x'.repeat(500)}\n`);
    await stderrOf({ file, keep: 1, maxBytes: 600 }, ['-vv'], twice);
    const records = readFileSync(file, 'utf8').trim().split('\n');
    expect(records.map((line): unknown => JSON.parse(line))).toEqual([
      expect.objectContaining({ message: 'Indexed.' }),
      expect.objectContaining({ message: 'Synced.' }),
    ]);
  });
});

test('a run that appends no record writes no line', async () => {
  await inDirectory(async (directory) => {
    const file = join(directory, 'notes.jsonl');
    await expect(stderrOf({ file }, ['-vv'], below)).resolves.toBe('› Below the level.\n');
    const unwritable = join(directory, 'taken', 'notes.jsonl');
    writeFileSync(join(directory, 'taken'), '');
    await expect(stderrOf({ file: unwritable }, ['-vv'], twice)).resolves.toBe(
      '› Indexed.\n› Synced.\n',
    );
  });
});

test('-vv names each rotation that renamed or deleted the file, keep: 0 included', async () => {
  await inDirectory(async (directory) => {
    const file = join(directory, 'notes.jsonl');
    writeFileSync(file, `${'x'.repeat(500)}\n`);
    const rotatedLines = `› Indexed.\n  ┆ Rotated ${file}.\n› Logging to ${file}.\n› Synced.\n`;
    await expect(stderrOf({ file, keep: 2, maxBytes: 600 }, ['-vv'], twice)).resolves.toBe(
      rotatedLines,
    );
    writeFileSync(file, `${'x'.repeat(500)}\n`);
    await expect(stderrOf({ file, keep: 0, maxBytes: 600 }, ['-v'], twice)).resolves.toBe(
      `› Indexed.\n› Logging to ${file}.\n› Synced.\n`,
    );
    writeFileSync(file, `${'x'.repeat(500)}\n`);
    await expect(stderrOf({ file, keep: 0, maxBytes: 600 }, ['-vv'], twice)).resolves.toBe(
      rotatedLines,
    );
  });
});

test("with to: 'console' the records reach stderr and the plugin writes neither line", async () => {
  const stderr = await stderrOf({ to: 'console' }, ['-vv'], (log) => {
    log.info('Indexed.');
  });
  const records = stderr.split('\n').filter((line) => line.startsWith('{'));
  expect(records).toHaveLength(1);
  expect(JSON.parse(records[0] ?? '')).toMatchObject({ message: 'Indexed.' });
  expect(stderr.split('\n').filter((line) => !line.startsWith('{'))).toEqual(['› Indexed.', '']);
});

test("under an action's invoke the line follows the outer run and stays out of the call's messages", async () => {
  await inDirectory(async (directory) => {
    const file = join(directory, 'notes.jsonl');
    const mock = mockProcess({ argv: ['-v', 'outer'] });
    await new Application('notes', { plugins: [logging({ file }), verbose()] })
      .command(
        new Command('inner').action(({ log }) => {
          log.info('Nested.');
        }),
      )
      .command(
        new Command('outer').action(async ({ invoke, log, out }) => {
          const outcome = await invoke(['inner'], {});
          log.info('After.');
          await out.print(JSON.stringify('messages' in outcome ? outcome.messages : null));
        }),
      )
      .run({ process: mock });
    expect(mock.stderr.text).toBe(`› Nested.\n› Logging to ${file}.\n› After.\n`);
    expect(mock.stdout.text).toBe('""\n');
  });
});

test('an invocation by name shows the line in its messages when its values ask for it', async () => {
  await inDirectory(async (directory) => {
    const file = join(directory, 'notes.jsonl');
    const app = application({ file }, twice);
    await expect(app.invoke([], {}, { process: mockProcess() })).resolves.toMatchObject({
      messages: '',
    });
    await expect(
      app.invoke([], { options: { verbose: 1 } }, { process: mockProcess() }),
    ).resolves.toMatchObject({ messages: `› Indexed.\n› Logging to ${file}.\n› Synced.\n` });
  });
});

test('-v -q writes no line', async () => {
  await inDirectory(async (directory) => {
    const file = join(directory, 'notes.jsonl');
    await expect(stderrOf({ file }, ['-v', '-q'], twice)).resolves.toBe('');
  });
});

test('a control character in the path is escaped', async () => {
  await inDirectory(async (directory) => {
    const file = join(directory, 'no\u0007tes.jsonl');
    await expect(stderrOf({ file }, ['-v'], twice)).resolves.toBe(
      `› Indexed.\n› Logging to ${join(directory, String.raw`no\u0007tes.jsonl`)}.\n› Synced.\n`,
    );
  });
});
