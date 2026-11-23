/*
 * The update notices' -v and -vv lines and their change event, under "At -v and in the log" in the
 * self-update reference and ADR-0165. Each case runs notes 1.5.0, installed by install.sh on the
 * stable channel, at a wide terminal on mockProcess with the verbose plugin and an `onLog` observer,
 * in a fresh sandbox under the temporary directory, and removes it after. The refresh program
 * answers and does nothing, so a case reads only what the run itself wrote.
 *
 * - The default verbosity writes nothing new: the notice alone.
 * - At -v the middleware names the cache it read, then the notice, then the refresh it started.
 * - At -vv it names the first reason it did nothing, in the contract's order, and a cache it
 *   ignored; a missing cache writes nothing, and a format 1 cache for another channel is read.
 * - A refresh that does not start writes no Started line.
 * - Writing `checked` records `File written.` for `update.json` under the plugin's identity.
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import type { LogEvent, ReleaseFacts } from '@loomcli/core';
import { afterEach, expect, test } from 'vite-plus/test';

import { runSelfUpdate } from './fixtures/self-update-mock.ts';

const asset = 'notes-linux-x64';
const binaryBytes = 'notes 1.5.0 binary\n';
const notice =
  'ℹ notes 1.5.1 is available on the stable channel. Run notes self-update to update from 1.5.0.\n';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    chmodSync(join(root, 'cache'), 0o755);
    rmSync(root, { force: true, recursive: true });
  }
});

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A sandbox: the home, the cache home, the state home, the binary, and the cache file. */
interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly cacheHome: string;
  readonly state: string;
  readonly binary: string;
  readonly cache: string;
  readonly file: string;
}

function sandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'loom-notice-lines-')));
  roots.push(root);
  const bin = join(root, 'bin');
  const cacheHome = join(root, 'cache');
  // The record directory lets `self-update --check` pass its refusals.
  for (const directory of [
    join(root, 'home'),
    cacheHome,
    bin,
    join(root, 'state', 'notes', 'installation'),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  const binary = join(bin, 'notes');
  writeFileSync(binary, binaryBytes, { mode: 0o755 });
  const cache = join(cacheHome, 'notes');
  return {
    binary,
    cache,
    cacheHome,
    file: join(cache, 'update.json'),
    home: join(root, 'home'),
    root,
    state: join(root, 'state'),
  };
}

/** A cache line on the stable channel of acme/notes, checked `hours` ago. */
function cacheLine(hours: number, channel = 'stable'): string {
  const checked = new Date(Date.now() - hours * 3_600_000).toISOString();
  return `{"format":1,"checked":"${checked}","repository":"acme/notes","channel":"${channel}","latest":"1.5.1"}\n`;
}

function writeCache(box: Sandbox, content: string): void {
  mkdirSync(box.cache, { recursive: true });
  writeFileSync(box.file, content);
}

interface Case {
  readonly env?: Record<string, string>;
  readonly release?: ReleaseFacts;
  readonly streams?: readonly ('stdout' | 'stderr')[];
  /** Names a refresh program the mock has no script for, so `host.spawn` throws at the call. */
  readonly unstartable?: boolean;
}

/** Runs `notes ...argv` and answers its stderr and the change events it raised. */
async function run(box: Sandbox, argv: readonly string[], scenario: Case = {}) {
  const release: ReleaseFacts = scenario.release ?? {
    build: 'distributed',
    installation: { digest: `sha256:${digestOf(binaryBytes)}`, method: 'script', path: box.binary },
    release: { asset, channel: 'stable', repository: 'acme/notes', version: '1.5.0' },
  };
  const events: LogEvent[] = [];
  const env = {
    CI: '',
    HOME: box.home,
    NO_COLOR: '1',
    XDG_CACHE_HOME: box.cacheHome,
    XDG_STATE_HOME: box.state,
    ...scenario.env,
  };
  const result = await runSelfUpdate(
    {
      github: {
        feed: [],
        latest: 'v1.5.1',
        releases: { 'v1.5.1': { assets: {}, sums: `${digestOf('1.5.1')}  ${asset}\n` } },
        repository: 'acme/notes',
      },
      notices: { env: 'NOTES_NO_UPDATE_NOTICE' },
      release,
      requests: join(box.root, 'requests.txt'),
      verbose: true,
    },
    {
      argv,
      env,
      home: env.HOME,
      program: [scenario.unstartable === true ? 'missing-refresh' : 'notice-refresh'],
      programs: { 'notice-refresh': () => ({}) },
      release,
      terminal: { columns: 400, rows: 24, streams: scenario.streams ?? ['stdout', 'stderr'] },
    },
    { observe: (event) => events.push(event) },
  );
  // The trace lane dims its line at a terminal; the words are what a case pins.
  return { events, stderr: stripVTControlCharacters(result.stderr) };
}

const added = '✔ Added note 12.\n';

/** The change event writing `checked` records, which shows at -v, then the refresh it started. */
function refreshed(file: string): string {
  return `› File written. path=${file}\n› Started a refresh of the update check.\n`;
}

/** The run's stderr when the middleware did nothing, for the reason it names. */
function skipped(reason: string): string {
  return `${added}  ┆ Skipped the update check: ${reason}\n`;
}

test('the default verbosity writes the notice and nothing new', async () => {
  const box = sandbox();
  writeCache(box, cacheLine(1));
  await expect(run(box, ['add'])).resolves.toMatchObject({ stderr: `${added}${notice}` });
});

test('-v names the cache read, then the notice, then the refresh it started', async () => {
  const box = sandbox();
  writeCache(box, cacheLine(1));
  await expect(run(box, ['-v', 'add'])).resolves.toMatchObject({
    stderr: `${added}› Read the update check from ${box.file}.\n${notice}`,
  });
  writeCache(box, cacheLine(25));
  await expect(run(box, ['-v', 'add'])).resolves.toMatchObject({
    stderr: `${added}› Read the update check from ${box.file}.\n${notice}${refreshed(box.file)}`,
  });
});

test('a format 1 cache for another channel is read and refreshed, not ignored', async () => {
  const box = sandbox();
  writeCache(box, cacheLine(1, 'next'));
  await expect(run(box, ['-vv', 'add'])).resolves.toMatchObject({
    stderr: `${added}› Read the update check from ${box.file}.\n${refreshed(box.file)}`,
  });
});

test('-vv names a cache it cannot read as an update cache, and a missing cache writes nothing', async () => {
  const ignored = (box: Sandbox) =>
    `${added}  ┆ Ignored ${box.file}: it is not an update cache this version reads.\n${refreshed(box.file)}`;
  for (const content of ['{', '{"format":2}\n', '[]\n']) {
    const box = sandbox();
    writeCache(box, content);
    await expect(run(box, ['-vv', 'add'])).resolves.toMatchObject({ stderr: ignored(box) });
  }
  const directory = sandbox();
  mkdirSync(directory.file, { recursive: true });
  // A directory at the path is ignored, and its `checked` cannot be written, so no refresh starts.
  await expect(run(directory, ['-vv', 'add'])).resolves.toMatchObject({
    stderr: `${added}  ┆ Ignored ${directory.file}: it is not an update cache this version reads.\n`,
  });
  const missing = sandbox();
  await expect(run(missing, ['-vv', 'add'])).resolves.toMatchObject({
    stderr: `${added}${refreshed(missing.file)}`,
  });
});

test('-vv names the first reason the middleware did nothing, in the contract order', async () => {
  const box = sandbox();
  writeCache(box, cacheLine(1));
  const cases: [Case, string][] = [
    [
      { env: { NOTES_NO_UPDATE_NOTICE: '1', NO_UPDATE_NOTIFIER: '1' }, streams: [] },
      'NO_UPDATE_NOTIFIER is set.',
    ],
    [{ env: { NOTES_NO_UPDATE_NOTICE: '1' }, streams: [] }, 'NOTES_NO_UPDATE_NOTICE is set.'],
    [{ env: { CI: '1' }, streams: ['stderr'] }, 'stdout is not a terminal.'],
    [{ env: { CI: '1' }, streams: ['stdout'] }, 'stderr is not a terminal.'],
    [{ env: { CI: '1' } }, 'CI is set.'],
    [{ release: { build: 'source' } }, 'notes is not a release build.'],
    [
      {
        release: {
          build: 'distributed',
          release: { asset, channel: 'stable', repository: 'acme/notes', version: '1.5.0' },
        },
      },
      "notes has no installation record and does not run from a Homebrew Cellar or a package manager's global root.",
    ],
    [
      {
        release: {
          build: 'distributed',
          installation: { method: 'npm', path: '/x' },
          release: { asset, channel: 'stable', repository: 'acme/notes', version: '1.5.0' },
        },
      },
      'notes was installed by npm, and its facts give no upgrade command.',
    ],
    [{ env: { HOME: 'relative', XDG_CACHE_HOME: '' } }, 'HOME is not an absolute path.'],
  ];
  for (const [scenario, reason] of cases) {
    const { stderr } = await run(box, ['-vv', 'add'], scenario);
    expect(stderr).toBe(skipped(reason));
  }
  const { stderr } = await run(box, ['-vv', 'self-update', '--check']);
  expect(stderr).toContain('  ┆ Skipped the update check: self-update is running.\n');
});

test('when two reasons hold at once, -vv names the one first in the contract order', async () => {
  const box = sandbox();
  writeCache(box, cacheLine(1));
  const checked = await run(box, ['-vv', 'self-update', '--check'], { env: { CI: '1' } });
  expect(checked.stderr.split('\n').filter((line) => line.includes('Skipped'))).toEqual([
    '  ┆ Skipped the update check: CI is set.',
  ]);
  const source = await run(box, ['-vv', 'add'], {
    env: { NO_UPDATE_NOTIFIER: '1' },
    release: { build: 'source' },
  });
  expect(source.stderr).toBe(skipped('NO_UPDATE_NOTIFIER is set.'));
});

test('a run whose action failed writes no Skipped line', async () => {
  const box = sandbox();
  const { stderr } = await run(box, ['-vv', 'fail'], { env: { CI: '1' } });
  expect(stderr).not.toContain('Skipped the update check');
});

test('a refresh child that cannot start writes no Started line', async () => {
  const box = sandbox();
  const { stderr } = await run(box, ['-v', 'add'], { unstartable: true });
  expect(stderr).toBe(`${added}› File written. path=${box.file}\n`);
});

test('writing checked records File written. for update.json under the plugin', async () => {
  const box = sandbox();
  const { events } = await run(box, ['add']);
  expect(
    events
      .filter(({ level }) => level === 'info')
      .map(({ fields, level, message, plugin }) => ({ fields, level, message, plugin })),
  ).toEqual([
    {
      fields: { path: box.file },
      level: 'info',
      message: 'File written.',
      plugin: '@loomcli/plugins/self-update',
    },
  ]);
});

test('-v -q writes no line', async () => {
  const box = sandbox();
  await expect(run(box, ['-v', '-q', 'add'])).resolves.toMatchObject({ stderr: added });
});

test('a control character in the cache path is escaped', async () => {
  const box = sandbox();
  const cacheHome = join(box.root, 'ca\u0007che');
  mkdirSync(join(cacheHome, 'notes'), { recursive: true });
  writeFileSync(join(cacheHome, 'notes', 'update.json'), cacheLine(1));
  const { stderr } = await run(box, ['-v', 'add'], { env: { XDG_CACHE_HOME: cacheHome } });
  expect(stderr).toContain(
    `› Read the update check from ${join(box.root, String.raw`ca\u0007che`, 'notes', 'update.json')}.\n`,
  );
});
