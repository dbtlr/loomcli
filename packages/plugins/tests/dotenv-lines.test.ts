/*
 * The dotenv plugin's -v and -vv lines, under "At -v and in the log" in its reference and
 * ADR-0165. Each case writes its files in a fresh directory under the temporary directory, runs an
 * application with dotenv and the verbose plugin there on a mock, and removes the directory.
 *
 * - The default verbosity writes no new line.
 * - At -v each file that imports a name says how many, in reading order, a name the environment
 *   or a more specific file already holds left out of the count.
 * - At -vv each name passed over says why, with the first reason that holds: the settings' list,
 *   then the environment, then a more specific file.
 * - No line or log event holds a value, and no change event is recorded.
 * - The lanes keep their rules: -v -q writes none, and an invocation by name shows the lines in
 *   its messages when its values ask for them.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, plugin } from '@loomcli/core';
import type { LogEvent } from '@loomcli/core';
import { dotenv } from '@loomcli/plugins/dotenv';
import type { DotenvSettings } from '@loomcli/plugins/dotenv';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** Runs a case in a directory holding the files, and removes it after. */
async function inFiles<Result>(
  files: Record<string, string>,
  body: (directory: string) => Promise<Result>,
): Promise<Result> {
  const directory = mkdtempSync(join(tmpdir(), 'loom-dotenv-lines-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(directory, name), text);
    }
    return await body(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** The application: dotenv with the settings, and -v and -q. */
function application(settings?: DotenvSettings, events: LogEvent[] = []) {
  const observer = plugin('fixture/observer', {
    onLog: (event) => {
      events.push(event);
      return undefined;
    },
  });
  return new Application('notes', { plugins: [dotenv(settings), verbose(), observer] }).action(
    () => {},
  );
}

/** The stderr of one run over the files, with the argv, environment, and settings given. */
async function stderrOf(
  files: Record<string, string>,
  argv: readonly string[],
  options: { env?: Record<string, string>; settings?: DotenvSettings } = {},
): Promise<string> {
  return inFiles(files, async (cwd) => {
    const mock = mockProcess({ argv, cwd, env: options.env ?? {} });
    await application(options.settings).run({ process: mock });
    return mock.stderr.text;
  });
}

/** The layered files of the reference's example under `NODE_ENV=development`. */
const layered = {
  '.env': 'DATABASE_URL=postgres://localhost/notes\nLOG_LEVEL=info\n',
  '.env.development':
    'API_TOKEN=from-file\nDATABASE_URL=postgres://dev/notes\nSYNC_URL=https://dev\n',
};

test('the default verbosity writes no new line', async () => {
  await expect(stderrOf(layered, [], { env: { NODE_ENV: 'development' } })).resolves.toBe('');
});

test("-v counts each file's imports in reading order, the most specific first", async () => {
  await expect(
    stderrOf(layered, ['-v'], { env: { API_TOKEN: 'set', NODE_ENV: 'development' } }),
  ).resolves.toBe(
    '› Imported 2 variables from .env.development.\n› Imported 1 variable from .env.\n',
  );
});

test('-vv names each name passed over after its file, with its reason', async () => {
  await expect(
    stderrOf(layered, ['-vv'], { env: { API_TOKEN: 'set', NODE_ENV: 'development' } }),
  ).resolves.toBe(
    [
      '› Imported 2 variables from .env.development.',
      '  ┆ Skipped API_TOKEN from .env.development: already set.',
      '› Imported 1 variable from .env.',
      '  ┆ Skipped DATABASE_URL from .env: already set from .env.development.',
      '',
    ].join('\n'),
  );
});

test("a name the settings' list leaves out names its list first, before the environment", async () => {
  const files = { '.env': 'API_TOKEN=a\nPATH=/opt/bin\nHOME=/tmp\n' };
  await expect(
    stderrOf(files, ['-vv'], { env: { PATH: '/usr/bin' }, settings: { except: ['PATH'] } }),
  ).resolves.toBe(
    [
      '› Imported 2 variables from .env.',
      '  ┆ Skipped PATH from .env: on the except list.',
      '',
    ].join('\n'),
  );
  await expect(
    stderrOf(files, ['-vv'], { env: { HOME: '/home/me' }, settings: { only: ['API_TOKEN'] } }),
  ).resolves.toBe(
    [
      '› Imported 1 variable from .env.',
      '  ┆ Skipped PATH from .env: not on the only list.',
      '  ┆ Skipped HOME from .env: not on the only list.',
      '',
    ].join('\n'),
  );
});

test('a name a more specific file also assigns names the list, then the environment, before that file', async () => {
  const files = {
    '.env': 'API_TOKEN=two\nPATH=/opt/two\n',
    '.env.local': 'API_TOKEN=one\nPATH=/opt/one\n',
  };
  const stderr = await stderrOf(files, ['-vv'], {
    env: { API_TOKEN: 'set' },
    settings: { except: ['PATH'] },
  });
  expect(stderr).toContain('  ┆ Skipped API_TOKEN from .env: already set.\n');
  expect(stderr).toContain('  ┆ Skipped PATH from .env: on the except list.\n');
});

test('an empty value in the environment is already set, and a file that imports none writes its -vv lines alone', async () => {
  await expect(
    stderrOf({ '.env': 'API_TOKEN=a\n' }, ['-vv'], { env: { API_TOKEN: '' } }),
  ).resolves.toBe('  ┆ Skipped API_TOKEN from .env: already set.\n');
});

test('a name assigned twice in a file is counted once, at its first place', async () => {
  await expect(
    stderrOf({ '.env': 'BETA=1\nALPHA=2\nBETA=3\n' }, ['-vv'], { env: { BETA: 'set' } }),
  ).resolves.toBe('› Imported 1 variable from .env.\n  ┆ Skipped BETA from .env: already set.\n');
});

test('a malformed line keeps its warning and gets no line, and a missing file writes nothing', async () => {
  await expect(stderrOf({ '.env': 'API_TOKEN="open\n' }, ['-vv'])).resolves.toBe(
    '⚠ Skipped API_TOKEN on line 1 of .env: the line is not a valid assignment. Correct the line, or remove it.\n',
  );
  await expect(stderrOf({}, ['-vv'])).resolves.toBe('');
});

test('no line or log event holds a value, and the plugin records no change event', async () => {
  const events: LogEvent[] = [];
  const secret = 'sk-live-0123456789';
  const stderr = await inFiles(
    { '.env': `API_TOKEN=${secret}\n`, '.env.local': `API_TOKEN=${secret}\n` },
    async (cwd) => {
      const mock = mockProcess({ argv: ['-vv'], cwd, env: {} });
      await application(undefined, events).run({ process: mock });
      return mock.stderr.text;
    },
  );
  expect(stderr).toBe(
    '› Imported 1 variable from .env.local.\n  ┆ Skipped API_TOKEN from .env: already set from .env.local.\n',
  );
  expect(stderr).not.toContain(secret);
  expect(JSON.stringify(events)).not.toContain(secret);
  expect(events.map(({ level, message }) => `${level} ${message}`)).toEqual([
    'debug Imported {count} variable from {file}.',
    'trace Skipped {name} from {file}: already set from {specific}.',
  ]);
});

test('a control character in a name cannot occur, and a file name is shown as the warnings show it', async () => {
  await expect(
    stderrOf({ '.env.te\u0007st': 'A=1\n' }, ['-v'], { env: { NODE_ENV: 'te\u0007st' } }),
  ).resolves.toBe(`${String.raw`› Imported 1 variable from .env.te\u0007st.`}\n`);
});

test('-v -q writes no line, and -vv -q writes the -v lines alone', async () => {
  const env = { API_TOKEN: 'set', NODE_ENV: 'development' };
  await expect(stderrOf(layered, ['-v', '-q'], { env })).resolves.toBe('');
  await expect(stderrOf(layered, ['-vv', '-q'], { env })).resolves.toBe(
    '› Imported 2 variables from .env.development.\n› Imported 1 variable from .env.\n',
  );
});

test('an invocation by name shows the -v lines in its messages when its values ask for them', async () => {
  await inFiles({ '.env': 'API_TOKEN=a\n' }, async (cwd) => {
    const app = application();
    await expect(
      app.invoke([], {}, { process: mockProcess({ cwd, env: {} }) }),
    ).resolves.toMatchObject({
      messages: '',
    });
    await expect(
      app.invoke([], { options: { verbose: 1 } }, { process: mockProcess({ cwd, env: {} }) }),
    ).resolves.toMatchObject({ messages: '› Imported 1 variable from .env.\n' });
  });
});
