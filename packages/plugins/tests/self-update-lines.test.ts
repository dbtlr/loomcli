/*
 * The self-update Command's -v and -vv lines and its change events, under "At -v and in the log"
 * in the self-update reference and ADR-0165. Each case runs notes on mockProcess with the verbose
 * plugin and an `onLog` observer, against the fake GitHub of the self-update acceptance cases, in a
 * fresh sandbox under the temporary directory, and removes it after. stderr is not a terminal, so
 * no line wraps and no lane styles its line.
 *
 * - The default verbosity writes the Command's own lines alone.
 * - At -v a replacing run names the release it resolved, the asset it verified, and the binary it
 *   replaced, between the lines it already prints; a named version and `--check` resolve nothing.
 * - At -vv each request, each redirect it follows included, is named before it is sent, on the
 *   stable channel and on another, and under `--refresh-notice`.
 * - A replacing run records `File removed.` for each leftover staging file, `Binary replaced.`, and
 *   `File written.` for `install.json`; `--refresh-notice` records `File written.` for the cache.
 * - The `afterReplace` context carries the graph's name and the action's `out`.
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LogEvent, ReleaseFacts } from '@loomcli/core';
import { afterEach, expect, test } from 'vite-plus/test';

import { runSelfUpdate } from './fixtures/self-update-mock.ts';

const asset = 'notes-linux-x64';
const oldBytes = 'notes 1.4.2 binary\n';

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function githubRelease(version: string) {
  const bytes = `notes ${version} binary\n`;
  return [`v${version}`, { assets: { [asset]: bytes }, sums: `${digestOf(bytes)}  ${asset}\n` }];
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox: the home, the state and cache homes, the binary, and its installation record. */
interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly state: string;
  readonly binary: string;
  readonly record: string;
  readonly cache: string;
}

function sandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'loom-self-update-lines-')));
  roots.push(root);
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  for (const directory of [join(root, 'home'), bin, join(state, 'notes', 'installation')]) {
    mkdirSync(directory, { recursive: true });
  }
  const binary = join(bin, 'notes');
  writeFileSync(binary, oldBytes);
  chmodSync(binary, 0o755);
  const record = join(state, 'notes', 'installation', 'install.json');
  writeFileSync(
    record,
    `{"format":1,"method":"script","path":${JSON.stringify(binary)},"digest":"sha256:${digestOf(oldBytes)}"}\n`,
  );
  return { binary, cache: join(root, 'cache'), home: join(root, 'home'), record, root, state };
}

interface Case {
  readonly version?: string;
  readonly hook?: 'record';
}

/** Runs `notes ...argv` at the version, and answers its status, stderr, and log events. */
async function run(box: Sandbox, argv: readonly string[], scenario: Case = {}) {
  const version = scenario.version ?? '1.4.2';
  const channel = version.includes('-') ? 'next' : 'stable';
  const release: ReleaseFacts = {
    build: 'distributed',
    installation: { digest: `sha256:${digestOf(oldBytes)}`, method: 'script', path: box.binary },
    release: { asset, channel, repository: 'acme/notes', version },
  };
  const events: LogEvent[] = [];
  const result = await runSelfUpdate(
    {
      github: {
        feed: ['v1.6.0-next.2', 'v1.6.0-next.1', 'v1.5.0'],
        latest: 'v1.5.0',
        releases: Object.fromEntries([
          githubRelease('1.6.0-next.1'),
          githubRelease('1.5.0'),
          githubRelease('1.4.0'),
        ]),
        repository: 'acme/notes',
      },
      ...(scenario.hook === undefined ? {} : { hook: scenario.hook }),
      hookLog: join(box.root, 'hook.jsonl'),
      notices: false,
      release,
      requests: join(box.root, 'requests.txt'),
      verbose: true,
    },
    {
      argv,
      env: { HOME: box.home, XDG_CACHE_HOME: box.cache, XDG_STATE_HOME: box.state },
      home: box.home,
      release,
    },
    { observe: (event) => events.push(event) },
  );
  return { events, status: result.status, stderr: result.stderr };
}

const github = 'https://github.com/acme/notes';
const assets = 'https://release-assets.example';

test('the default verbosity writes the Command lines alone', async () => {
  const box = sandbox();
  await expect(run(box, ['self-update'])).resolves.toMatchObject({
    status: 0,
    stderr:
      'ℹ Downloading notes-linux-x64 from v1.5.0 of acme/notes.\n✔ Updated notes from 1.4.2 to 1.5.0.\n',
  });
});

test('-v names the release resolved, the asset verified, and the binary replaced', async () => {
  const box = sandbox();
  await expect(run(box, ['-v', 'self-update'])).resolves.toMatchObject({
    status: 0,
    stderr: [
      '› Resolved v1.5.0 on the stable channel.',
      'ℹ Downloading notes-linux-x64 from v1.5.0 of acme/notes.',
      '› Verified notes-linux-x64 against SHA256SUMS.',
      `› Replaced ${box.binary}.`,
      '✔ Updated notes from 1.4.2 to 1.5.0.',
      '',
    ].join('\n'),
  });
});

test('a named version and --check resolve no line', async () => {
  const named = sandbox();
  await expect(run(named, ['-v', 'self-update', '1.4.0'])).resolves.toMatchObject({
    stderr: [
      'ℹ Downloading notes-linux-x64 from v1.4.0 of acme/notes.',
      '› Verified notes-linux-x64 against SHA256SUMS.',
      `› Replaced ${named.binary}.`,
      '✔ Updated notes from 1.4.2 to 1.4.0.',
      '',
    ].join('\n'),
  });
  const checked = sandbox();
  await expect(run(checked, ['-v', 'self-update', '--check'])).resolves.toMatchObject({
    stderr: '✔ notes can update from 1.4.2 to 1.5.0 on the stable channel.\n',
  });
});

test('-vv names each request before it is sent, each redirect included', async () => {
  const box = sandbox();
  await expect(run(box, ['-vv', 'self-update'])).resolves.toMatchObject({
    stderr: [
      `  ┆ Requested ${github}/releases/latest.`,
      '› Resolved v1.5.0 on the stable channel.',
      `  ┆ Requested ${github}/releases/download/v1.5.0/SHA256SUMS.`,
      `  ┆ Requested ${assets}/v1.5.0/SHA256SUMS.`,
      'ℹ Downloading notes-linux-x64 from v1.5.0 of acme/notes.',
      `  ┆ Requested ${github}/releases/download/v1.5.0/notes-linux-x64.`,
      `  ┆ Requested ${assets}/v1.5.0/notes-linux-x64.`,
      '› Verified notes-linux-x64 against SHA256SUMS.',
      `› Replaced ${box.binary}.`,
      '✔ Updated notes from 1.4.2 to 1.5.0.',
      '',
    ].join('\n'),
  });
});

test('on another channel the lookup requests each candidate SHA256SUMS before Resolved', async () => {
  const box = sandbox();
  await expect(
    run(box, ['-vv', 'self-update'], { version: '1.6.0-next.0' }),
  ).resolves.toMatchObject({
    stderr: [
      `  ┆ Requested ${github}/releases.atom.`,
      `  ┆ Requested ${github}/releases/download/v1.6.0-next.2/SHA256SUMS.`,
      `  ┆ Requested ${github}/releases/download/v1.6.0-next.1/SHA256SUMS.`,
      `  ┆ Requested ${assets}/v1.6.0-next.1/SHA256SUMS.`,
      '› Resolved v1.6.0-next.1 on the next channel.',
      'ℹ Downloading notes-linux-x64 from v1.6.0-next.1 of acme/notes.',
      `  ┆ Requested ${github}/releases/download/v1.6.0-next.1/notes-linux-x64.`,
      `  ┆ Requested ${assets}/v1.6.0-next.1/notes-linux-x64.`,
      '› Verified notes-linux-x64 against SHA256SUMS.',
      `› Replaced ${box.binary}.`,
      '✔ Updated notes from 1.6.0-next.0 to 1.6.0-next.1.',
      '',
    ].join('\n'),
  });
});

test('a replacing run records each staging file removed, the binary replaced, and the record written', async () => {
  const box = sandbox();
  const binaryStaging = join(box.root, 'bin', '.notes.0123456789abcdef.loom-staging');
  const recordStaging = join(
    box.state,
    'notes',
    'installation',
    '.install.json.fedcba9876543210.loom-staging',
  );
  writeFileSync(binaryStaging, 'partial');
  writeFileSync(recordStaging, 'partial');
  const { events } = await run(box, ['self-update']);
  expect(events.map(({ fields, level, message }) => ({ fields, level, message }))).toEqual([
    { fields: { path: binaryStaging }, level: 'info', message: 'File removed.' },
    {
      fields: { from: '1.4.2', path: box.binary, to: '1.5.0' },
      level: 'info',
      message: 'Binary replaced.',
    },
    { fields: { path: recordStaging }, level: 'info', message: 'File removed.' },
    { fields: { path: box.record }, level: 'info', message: 'File written.' },
  ]);
});

test('--refresh-notice names its requests at -vv and records the cache it writes', async () => {
  const box = sandbox();
  const { events, status, stderr } = await run(box, ['-vv', 'self-update', '--refresh-notice']);
  expect(status).toBe(0);
  expect(stderr).toBe(`  ┆ Requested ${github}/releases/latest.\n`);
  expect(events.map(({ fields, message }) => ({ fields, message }))).toEqual([
    { fields: { path: join(box.cache, 'notes', 'update.json') }, message: 'File written.' },
  ]);
});

test('afterReplace receives the graph name and the action out', async () => {
  const box = sandbox();
  const { stderr } = await run(box, ['-v', 'self-update'], { hook: 'record' });
  expect(stderr.endsWith('✔ Updated notes from 1.4.2 to 1.5.0.\n› The hook ran for notes.\n')).toBe(
    true,
  );
});
