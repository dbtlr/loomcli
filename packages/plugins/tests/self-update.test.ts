import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/self-update-run.mjs', import.meta.url);

const asset = 'notes-linux-x64';
const oldBytes = 'notes 1.4.2 binary\n';

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** One release the fake GitHub serves: its binary's bytes and a `SHA256SUMS` that lists them. */
interface FakeRelease {
  readonly sums: string | null;
  readonly assets: Record<string, string>;
}

function release(version: string, bytes = `notes ${version} binary\n`): [string, FakeRelease] {
  return [`v${version}`, { assets: { [asset]: bytes }, sums: `${digestOf(bytes)}  ${asset}\n` }];
}

interface GitHub {
  readonly repository: string;
  readonly renamedFrom?: string;
  readonly latest: string | null;
  readonly feed: readonly string[];
  readonly releases: Record<string, FakeRelease>;
}

const defaultGitHub: GitHub = {
  feed: ['v1.5.0', 'v1.4.2'],
  latest: 'v1.5.0',
  releases: Object.fromEntries([release('1.5.0'), release('1.4.2', oldBytes), release('1.4.0')]),
  repository: 'acme/notes',
};

/** A sandbox: the home, the state directory, and the install directory holding the binary. */
interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly state: string;
  readonly bin: string;
  readonly binary: string;
  readonly record: string;
  readonly requests: string;
  readonly hookLog: string;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    chmodTree(root);
    rmSync(root, { force: true, recursive: true });
  }
});

/** Makes every directory under `root` writable, so a test that made one read-only can clean up. */
function chmodTree(root: string): void {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) {
    return;
  }
  if (statSync(root).isDirectory()) {
    chmodSync(root, 0o755);
    for (const entry of readdirSync(root)) {
      chmodTree(join(root, entry));
    }
  }
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'loom-self-update-'));
  roots.push(root);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const bin = join(root, 'bin');
  for (const directory of [home, state, bin, join(state, 'notes', 'installation')]) {
    mkdirSync(directory, { recursive: true });
  }
  const binary = join(bin, 'notes');
  writeFileSync(binary, oldBytes, { mode: 0o755 });
  chmodSync(binary, 0o755);
  const record = join(state, 'notes', 'installation', 'install.json');
  writeFileSync(record, recordLine(binary, oldBytes));
  return {
    bin,
    binary,
    home,
    hookLog: join(root, 'hook.jsonl'),
    record,
    requests: join(root, 'requests.txt'),
    root,
    state,
  };
}

/** The line the installation record holds for a binary at `path` with these bytes. */
function recordLine(path: string, bytes: string): string {
  // The members keep the record's order, which an object literal would not survive formatting in.
  return `{"format":1,"method":"script","path":${JSON.stringify(path)},"digest":"sha256:${digestOf(bytes)}"}\n`;
}

interface Scenario {
  readonly version?: string;
  readonly release?: unknown;
  readonly installation?: unknown;
  readonly github?: Partial<GitHub>;
  readonly rules?: Record<string, string | number>;
  readonly hook?: 'record' | 'throw';
  readonly abortAfterRename?: boolean;
  readonly env?: Record<string, string>;
  readonly umask?: number;
}

/** The release facts a binary at `version` reads, recorded at the sandbox's binary. */
function facts(box: Sandbox, version: string, overrides: Scenario = {}) {
  const [, prerelease = ''] = version.split('-');
  const channel = version.includes('-') ? (prerelease.split('.')[0] ?? 'stable') : 'stable';
  return {
    build: 'distributed',
    installation:
      'installation' in overrides
        ? overrides.installation
        : { digest: `sha256:${digestOf(oldBytes)}`, method: 'script', path: box.binary },
    release:
      'release' in overrides
        ? overrides.release
        : { asset, channel, repository: 'acme/notes', version },
  };
}

/** Runs `notes self-update ...argv` in the sandbox, its fake GitHub built from the scenario. */
function run(box: Sandbox, argv: string[], scenario: Scenario = {}) {
  const file = join(box.root, 'scenario.json');
  writeFileSync(
    file,
    JSON.stringify({
      abortAfterRename: scenario.abortAfterRename,
      env: { HOME: box.home, XDG_STATE_HOME: box.state, ...scenario.env },
      github: { ...defaultGitHub, ...scenario.github },
      hook: scenario.hook ?? 'record',
      hookLog: box.hookLog,
      release: facts(box, scenario.version ?? '1.4.2', scenario),
      requests: box.requests,
      rules: scenario.rules,
    }),
  );
  const umask = scenario.umask ?? 0o022;
  return invoke(fixture, [file, 'self-update', ...argv], {
    env: { FIXTURE_UMASK: umask.toString(8) },
  });
}

function requests(box: Sandbox): string[] {
  return existsSync(box.requests) ? readFileSync(box.requests, 'utf8').trim().split('\n') : [];
}

function hookCalls(box: Sandbox): unknown[] {
  return existsSync(box.hookLog)
    ? readFileSync(box.hookLog, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
}

function stagingFiles(directory: string): string[] {
  return readdirSync(directory).filter((name) => name.endsWith('.loom-staging'));
}

/** The binary and the record, read back to show a run left them alone. */
function untouched(box: Sandbox): void {
  expect(readFileSync(box.binary, 'utf8')).toBe(oldBytes);
  expect(readFileSync(box.record, 'utf8')).toBe(recordLine(box.binary, oldBytes));
  expect(stagingFiles(box.bin)).toEqual([]);
}

/** The lines a run wrote to stderr, each with any lane glyph and the space after it removed. */
function lines(stderr: string): string[] {
  return stderr
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\P{ASCII} /u, ''));
}

test('a stable binary updates to the latest release, keeps its mode, rewrites the record, and calls the hook', () => {
  const box = sandbox();
  writeFileSync(join(box.bin, '.notes.0123456789abcdef.loom-staging'), 'leftover');
  const result = run(box, [], { umask: 0o077 });
  expect(result.status).toBe(0);
  expect(lines(result.stderr)).toEqual([
    'Downloading notes-linux-x64 from v1.5.0 of acme/notes.',
    'Updated notes from 1.4.2 to 1.5.0.',
  ]);
  expect(result.stdout).toBe('');
  expect(readFileSync(box.binary, 'utf8')).toBe('notes 1.5.0 binary\n');
  expect(statSync(box.binary).mode & 0o777).toBe(0o755);
  expect(readFileSync(box.record, 'utf8')).toBe(recordLine(box.binary, 'notes 1.5.0 binary\n'));
  expect(stagingFiles(box.bin)).toEqual([]);
  expect(hookCalls(box)).toEqual([
    { aborted: false, current: '1.5.0', host: '1.4.2', path: box.binary, previous: '1.4.2' },
  ]);
  expect(requests(box)).toEqual([
    'https://github.com/acme/notes/releases/latest',
    'https://github.com/acme/notes/releases/download/v1.5.0/SHA256SUMS',
    'https://release-assets.example/v1.5.0/SHA256SUMS',
    'https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64',
    'https://release-assets.example/v1.5.0/notes-linux-x64',
  ]);
});

const channelGitHub: Partial<GitHub> = {
  feed: ['v1.7.0-next.1', 'v1.6.0-beta.1', 'nightly', 'v1.6.0', 'v1.6.0-next.2', 'v1.5.0'],
  latest: 'v1.5.0',
  releases: Object.fromEntries([
    release('1.6.0'),
    release('1.6.0-next.2'),
    release('1.6.0-beta.1'),
    release('1.5.0'),
  ]),
};

test('a prerelease binary follows its channel past a tag with no release onto a stable release that outranks it', () => {
  const box = sandbox();
  const result = run(box, [], { github: channelGitHub, version: '1.6.0-next.1' });
  expect(result.status).toBe(0);
  expect(lines(result.stderr).at(-1)).toBe('Updated notes from 1.6.0-next.1 to 1.6.0.');
  expect(readFileSync(box.binary, 'utf8')).toBe('notes 1.6.0 binary\n');
  expect(requests(box).slice(0, 3)).toEqual([
    'https://github.com/acme/notes/releases.atom',
    'https://github.com/acme/notes/releases/download/v1.7.0-next.1/SHA256SUMS',
    'https://github.com/acme/notes/releases/download/v1.6.0/SHA256SUMS',
  ]);
});

test('--channel next moves a stable binary onto the newest next release', () => {
  const box = sandbox();
  const result = run(box, ['--channel', 'next'], {
    github: { ...channelGitHub, feed: ['v1.6.0-next.2', 'v1.5.0'] },
  });
  expect(result.status).toBe(0);
  expect(lines(result.stderr).at(-1)).toBe('Updated notes from 1.4.2 to 1.6.0-next.2.');
});

test('--channel stable from a newer prerelease replaces nothing and names the older version', () => {
  const box = sandbox();
  const result = run(box, ['--channel', 'stable'], { version: '1.6.0-next.1' });
  expect(result.status).toBe(0);
  expect(lines(result.stderr)).toEqual([
    'notes 1.6.0-next.1 is newer than the newest release on the stable channel, 1.5.0. Name that version to install it: notes self-update 1.5.0.',
  ]);
  untouched(box);
  expect(hookCalls(box)).toEqual([]);
});

test('a repository named in another case matches the feed, and a renamed one resolves and downloads from its new name', () => {
  const cased = sandbox();
  const result = run(cased, [], {
    github: { ...channelGitHub, feed: ['v1.6.0-next.2'] },
    release: { asset, channel: 'next', repository: 'Acme/Notes', version: '1.6.0-next.1' },
  });
  expect(result.status).toBe(0);
  expect(readFileSync(cased.binary, 'utf8')).toBe('notes 1.6.0-next.2 binary\n');

  for (const version of ['1.4.2', '1.6.0-next.1']) {
    const box = sandbox();
    const moved = run(box, [], {
      github: {
        ...channelGitHub,
        feed: ['v1.6.0-next.2', 'v1.5.0'],
        renamedFrom: 'acme/notes',
        repository: 'acme/notes2',
      },
      version,
    });
    expect(moved.status).toBe(0);
    expect(lines(moved.stderr)[0]).toMatch(/ of acme\/notes2\.$/u);
    // Only the first request names the old repository; every later one uses the name GitHub gave.
    const [first, ...later] = requests(box);
    expect(first).toMatch(/^https:\/\/github\.com\/acme\/notes\//u);
    expect(later.filter((url) => url.startsWith('https://github.com/acme/notes/'))).toEqual([]);
  }
});

test('a repository with no stable release and a channel with none in the feed fail with the no-release sentence', () => {
  const box = sandbox();
  const stable = run(box, [], { github: { latest: null } });
  expect(stable.status).toBe(1);
  expect(stable.stderr).toBe(
    'notes found no release on the stable channel of acme/notes. Name a version to install, such as notes self-update 1.4.0.\n',
  );
  // A prerelease channel also takes stable releases, so the feed holds neither.
  const next = run(box, ['--channel', 'rc'], { github: { feed: ['v1.6.0-beta.1'] } });
  expect(next.status).toBe(1);
  expect(next.stderr).toBe(
    'notes found no release on the rc channel of acme/notes. Name a version to install, such as notes self-update 1.4.0.\n',
  );
  untouched(box);
});

test('a named version installs in either direction, with or without its v', () => {
  for (const named of ['1.4.0', 'v1.4.0']) {
    const box = sandbox();
    const result = run(box, [named]);
    expect(result.status).toBe(0);
    expect(lines(result.stderr).at(-1)).toBe('Updated notes from 1.4.2 to 1.4.0.');
    expect(readFileSync(box.binary, 'utf8')).toBe('notes 1.4.0 binary\n');
    expect(requests(box)[0]).toBe(
      'https://github.com/acme/notes/releases/download/v1.4.0/SHA256SUMS',
    );
  }
});

test('the running version, newest or named, replaces nothing and calls no hook', () => {
  const box = sandbox();
  const newest = run(box, [], { github: { latest: 'v1.4.2' } });
  expect(newest.status).toBe(0);
  expect(lines(newest.stderr)).toEqual([
    'notes 1.4.2 is the newest release on the stable channel.',
  ]);
  const named = run(box, ['1.4.2']);
  expect(named.status).toBe(0);
  expect(lines(named.stderr)).toEqual(['notes 1.4.2 is already installed.']);
  untouched(box);
  expect(hookCalls(box)).toEqual([]);
});

test('--check reports what an update would do, requests SHA256SUMS and no binary, and writes nothing', () => {
  const box = sandbox();
  const channel = run(box, ['--check']);
  expect(channel.status).toBe(0);
  expect(lines(channel.stderr)).toEqual([
    'notes can update from 1.4.2 to 1.5.0 on the stable channel.',
  ]);
  const named = run(box, ['--check', '1.4.0']);
  expect(lines(named.stderr)).toEqual(['notes can install 1.4.0 in place of 1.4.2.']);
  const running = run(box, ['--check', '1.4.2']);
  expect(lines(running.stderr)).toEqual(['notes 1.4.2 is already installed.']);
  expect(requests(box)).toContain(
    'https://github.com/acme/notes/releases/download/v1.4.2/SHA256SUMS',
  );
  expect(requests(box).filter((url) => url.endsWith(asset))).toEqual([]);
  expect(requests(box)).toContain(
    'https://github.com/acme/notes/releases/download/v1.5.0/SHA256SUMS',
  );
  untouched(box);
  expect(hookCalls(box)).toEqual([]);
});

test.each([
  [['--channel', 'next', '1.4.0'], 'Option "--channel" cannot be given with a version.'],
  [['1.x'], 'version'],
  [['--channel', '01'], 'channel'],
])('self-update %j is a usage error', (argv, fragment) => {
  const box = sandbox();
  const result = run(box, argv);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain(fragment);
  expect(requests(box)).toEqual([]);
});

test('--channel 1 follows the channel a version such as 2.0.0-1 derives', () => {
  const box = sandbox();
  const result = run(box, ['--channel', '1'], {
    github: { feed: ['v2.0.0-1'], releases: Object.fromEntries([release('2.0.0-1')]) },
  });
  expect(result.status).toBe(0);
  expect(readFileSync(box.binary, 'utf8')).toBe('notes 2.0.0-1 binary\n');
});

/** A refusal: the sentence it pins and the scenario that reaches it. */
const refusals: [string, (box: Sandbox) => Scenario, string][] = [
  [
    'no release group',
    () => ({ release: undefined }),
    'notes was not built as a release binary, so it cannot update itself. Update it the way you installed it.',
  ],
  [
    'no asset',
    () => ({ release: { channel: 'stable', repository: 'acme/notes', version: '1.4.2' } }),
    'notes was not built as a release binary, so it cannot update itself. Update it the way you installed it.',
  ],
  [
    'a relative HOME',
    () => ({ env: { HOME: 'home', XDG_STATE_HOME: '' } }),
    'notes cannot find its installation record because HOME is not an absolute path. Set HOME to an absolute path, then run self-update again.',
  ],
  [
    'no installation',
    () => ({ installation: undefined }),
    'notes was installed some other way, so self-update cannot replace it. Update it the way you installed it.',
  ],
  [
    'the method npm',
    (box) => ({
      installation: { digest: `sha256:${digestOf(oldBytes)}`, method: 'npm', path: box.binary },
    }),
    'notes was installed some other way, so self-update cannot replace it. Update it the way you installed it.',
  ],
];

test.each(refusals)('a run with %s refuses before any request', (_label, scenario, sentence) => {
  const box = sandbox();
  const result = run(box, [], scenario(box));
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(`${sentence}\n`);
  expect(requests(box)).toEqual([]);
  untouched(box);
});

test('a missing binary, a symbolic link, and a changed binary refuse before any request', () => {
  const missing = sandbox();
  rmSync(missing.binary);
  const gone = run(missing, []);
  expect(gone.status).toBe(1);
  expect(gone.stderr).toBe(
    `notes cannot find its binary at ${missing.binary}. Install it again with install.sh.\n`,
  );

  const linked = sandbox();
  const target = join(linked.root, 'store-notes');
  writeFileSync(target, oldBytes, { mode: 0o755 });
  rmSync(linked.binary);
  symlinkSync(target, linked.binary);
  const link = run(linked, []);
  expect(link.status).toBe(1);
  expect(link.stderr).toBe(
    `notes at ${linked.binary} is a symbolic link, so self-update will not replace what it points to. Install it again with install.sh.\n`,
  );
  expect(readFileSync(target, 'utf8')).toBe(oldBytes);

  const changed = sandbox();
  writeFileSync(changed.binary, 'patched by hand\n');
  const edited = run(changed, []);
  expect(edited.status).toBe(1);
  expect(edited.stderr).toBe(
    `notes at ${changed.binary} changed since it was installed, so self-update will not replace it. Install it again with install.sh.\n`,
  );
  for (const box of [missing, linked, changed]) {
    expect(requests(box)).toEqual([]);
    expect(readFileSync(box.record, 'utf8')).toBe(recordLine(box.binary, oldBytes));
  }
});

test.skipIf(process.getuid?.() === 0)(
  'a read-only install directory refuses before any request',
  () => {
    const box = sandbox();
    chmodSync(box.bin, 0o555);
    const result = run(box, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      `notes cannot write to ${box.bin}. Run self-update as the user who installed notes.\n`,
    );
    expect(requests(box)).toEqual([]);
    chmodSync(box.bin, 0o755);
    untouched(box);
  },
);

const corrupt = 'not the release bytes\n';

/** A download failure: the scenario that reaches it and the sentence it pins. */
const downloadFailures: [string, string[], Scenario, string][] = [
  [
    'a digest mismatch',
    [],
    {
      github: {
        releases: {
          'v1.5.0': { assets: { [asset]: corrupt }, sums: `${digestOf('x')}  ${asset}\n` },
        },
      },
    },
    'notes-linux-x64 from v1.5.0 of acme/notes does not match its SHA256SUMS digest. Run self-update again later.',
  ],
  [
    'no SHA256SUMS line',
    [],
    {
      github: {
        releases: { 'v1.5.0': { assets: { [asset]: corrupt }, sums: `${digestOf('x')}  other\n` } },
      },
    },
    'Release v1.5.0 of acme/notes has no notes-linux-x64 in its SHA256SUMS. Install a release that lists it, or ask its maintainers to publish one.',
  ],
  [
    'two different lines',
    [],
    {
      github: {
        releases: {
          'v1.5.0': {
            assets: { [asset]: corrupt },
            sums: `${digestOf(corrupt)}  ${asset}\n${digestOf('x')} *${asset}\n`,
          },
        },
      },
    },
    'Release v1.5.0 of acme/notes lists notes-linux-x64 twice in its SHA256SUMS with different digests. Run self-update again once the release is fixed.',
  ],
  [
    'a 404 for a named version',
    ['9.9.9'],
    {},
    'notes could not download https://github.com/acme/notes/releases/download/v9.9.9/SHA256SUMS (404). Check that release v9.9.9 exists, then run self-update again.',
  ],
  [
    'a 503',
    [],
    { rules: { [`/v1.5.0/${asset}`]: 503 } },
    'notes could not download https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64 (503). Run self-update again later.',
  ],
  [
    'a redirect to http',
    [],
    { rules: { [`release-assets.example/v1.5.0/${asset}`]: 'insecure' } },
    'notes was redirected away from HTTPS while downloading https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64. Run self-update again later.',
  ],
  [
    'a 21st redirect',
    [],
    { rules: { [`release-assets.example/v1.5.0/${asset}`]: 'loop' } },
    'notes was redirected too many times while downloading https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64. Run self-update again later.',
  ],
  [
    'a download cut off',
    [],
    { rules: { [`release-assets.example/v1.5.0/${asset}`]: 'cut' } },
    'notes could not download https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64 (no response). Run self-update again later.',
  ],
  [
    'no response',
    [],
    { rules: { 'releases/latest': 'no-response' } },
    'notes could not download https://github.com/acme/notes/releases/latest (no response). Run self-update again later.',
  ],
];

test.each(downloadFailures)(
  '%s fails, leaving the binary, the record, and no staging file',
  (_label, argv, scenario, sentence) => {
    const box = sandbox();
    const result = run(box, argv, scenario);
    expect(result.status).toBe(1);
    expect(lines(result.stderr).at(-1)).toBe(sentence);
    untouched(box);
    expect(hookCalls(box)).toEqual([]);
  },
);

test.skipIf(process.getuid?.() === 0)(
  'a staging write that fails reports the write sentence and leaves the binary',
  () => {
    const box = sandbox();
    const result = run(box, [], { rules: { [`release-assets.example/v1.5.0/${asset}`]: 'lock' } });
    expect(result.status).toBe(1);
    expect(lines(result.stderr).at(-1)).toBe(
      `notes could not write the new binary to ${box.bin}. Free space there or check its permissions, then run self-update again.`,
    );
    chmodSync(box.bin, 0o755);
    untouched(box);
  },
);

test('a run aborted during the download exits 130 with no failure sentence and leaves everything', () => {
  const box = sandbox();
  const result = run(box, [], { rules: { [`release-assets.example/v1.5.0/${asset}`]: 'abort' } });
  expect(result.status).toBe(130);
  expect(lines(result.stderr)).toEqual(['Downloading notes-linux-x64 from v1.5.0 of acme/notes.']);
  untouched(box);
  expect(hookCalls(box)).toEqual([]);
});

test('a run aborted after the rename writes the record, calls the hook with an aborted signal, and exits 130', () => {
  const box = sandbox();
  const result = run(box, [], { abortAfterRename: true });
  expect(result.status).toBe(130);
  expect(readFileSync(box.record, 'utf8')).toBe(recordLine(box.binary, 'notes 1.5.0 binary\n'));
  expect(hookCalls(box)).toEqual([
    { aborted: true, current: '1.5.0', host: '1.4.2', path: box.binary, previous: '1.4.2' },
  ]);
});

test('a throwing hook fails the run after the update line, and the new binary and record stay', () => {
  const box = sandbox();
  const result = run(box, [], { hook: 'throw' });
  expect(result.status).toBe(1);
  expect(lines(result.stderr)[1]).toBe('Updated notes from 1.4.2 to 1.5.0.');
  expect(readFileSync(box.binary, 'utf8')).toBe('notes 1.5.0 binary\n');
  expect(readFileSync(box.record, 'utf8')).toBe(recordLine(box.binary, 'notes 1.5.0 binary\n'));
});
