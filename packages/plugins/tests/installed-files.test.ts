import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as after } from 'node:timers/promises';

import { afterEach, expect, test } from 'vite-plus/test';

import { invoke, start } from '../../../scripts/test-process.js';
import { replaceFile } from '../src/installation/disk.js';
import {
  inspectStartupFile,
  install,
  readRecorded,
  folderRefusals,
  targetRefusals,
  uninstall,
} from '../src/installation/files.js';
import type {
  InstalledFile,
  InstalledFolder,
  InstalledLine,
  InstallRequest,
  StartupLinesOutcome,
} from '../src/installation/files.js';
import { fillFolder, folderHoldsExactly, writeFolder } from '../src/installation/folders.js';

/** The SHA-256 digests of the bytes `test`, `abc`, and `new`, from independent sources. */
const digests = {
  abc: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  new: 'sha256:11507a0e2f5e69d5dfa40a62a1bd7b6ee57e6bcd85c67c9b8431b36fff21c437',
  test: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * A temporary root with a record directory and a target directory, `skills`, that exists, and the
 * two targets the tests install into `skills/notes`, which does not.
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-installed-'));
  roots.push(root);
  const skills = join(root, 'skills');
  mkdirSync(skills);
  const directory = join(skills, 'notes');
  return {
    directory,
    first: join(directory, 'SKILL.md'),
    owner: join(root, 'record', 'skill.json'),
    record: join(root, 'record'),
    root,
    second: join(directory, 'reference.md'),
    skills,
  };
}

type Box = ReturnType<typeof sandbox>;

/** One install of `files` by the skill plugin, with a signal no one aborts. */
function installed(
  box: Box,
  files: readonly InstalledFile[],
  signal = new AbortController().signal,
) {
  return install({ files, plugin: 'skill', record: box.record, signal });
}

/** One uninstall by the skill plugin. */
function uninstalled(box: Box) {
  return uninstall({ plugin: 'skill', record: box.record, signal: new AbortController().signal });
}

/** The skill plugin's file, as bytes. */
function ownerText(box: Box): string {
  return readFileSync(box.owner, 'utf8');
}

/** A committed plugin's file's bytes, as the contract spells them. */
function committed(directories: readonly string[], files: readonly [string, string][]): string {
  const entries = files.map(([path, digest]) => ({ path, digest }));
  return `${JSON.stringify({ format: 1, state: 'committed', directories, files: entries })}\n`;
}

/** Writes a pending plugin's file by hand, as a killed install leaves one. */
function pending(
  box: Box,
  directories: readonly string[],
  files: readonly [string, string | null, string | null][],
): void {
  const entries = files.map(([path, prior, intended]) => ({ path, prior, intended }));
  mkdirSync(box.record, { recursive: true });
  writeFileSync(
    box.owner,
    `${JSON.stringify({ format: 1, state: 'pending', directories, files: entries })}\n`,
  );
}

// Installing

test('installing two files writes both and a committed file with their digests and the created directory', () => {
  const box = sandbox();
  const outcome = installed(box, [
    { content: 'test', path: box.first },
    { content: 'abc', path: box.second },
  ]);
  expect(outcome).toEqual({
    kept: [],
    removed: [],
    status: 'installed',
    written: [box.first, box.second],
  });
  expect(readFileSync(box.first, 'utf8')).toBe('test');
  expect(readFileSync(box.second, 'utf8')).toBe('abc');
  expect(ownerText(box)).toBe(
    committed(
      [box.directory],
      [
        [box.first, digests.test],
        [box.second, digests.abc],
      ],
    ),
  );
  expect(readdirSync(box.directory).toSorted()).toEqual(['SKILL.md', 'reference.md']);
  expect(readdirSync(box.record)).toEqual(['skill.json']);
});

test('a target with a named mode holds that mode under umask 002, and one with none follows the umask', () => {
  const box = sandbox();
  const previous = process.umask(0o002);
  try {
    const outcome = installed(box, [
      { content: 'test', mode: 0o644, path: box.first },
      { content: 'abc', path: box.second },
    ]);
    expect(outcome.status).toBe('installed');
  } finally {
    process.umask(previous);
  }
  expect(statSync(box.first).mode & 0o777).toBe(0o644);
  expect(statSync(box.second).mode & 0o777).toBe(0o664);
  // The mode changes neither the content nor what the plugin's file records.
  expect(readFileSync(box.first, 'utf8')).toBe('test');
  expect(JSON.parse(ownerText(box)).files).toEqual([
    { path: box.first, digest: digests.test },
    { path: box.second, digest: digests.abc },
  ]);
});

test('a named directory mode holds on each created parent under umask 077, and an existing parent keeps its own', () => {
  const box = sandbox();
  const deep = join(box.root, 'a', 'b', 'c.md');
  chmodSync(box.root, 0o700);
  const previous = process.umask(0o077);
  try {
    const outcome = install({
      directoryMode: 0o755,
      files: [{ content: 'test', mode: 0o644, path: deep }],
      plugin: 'skill',
      record: box.record,
      signal: new AbortController().signal,
    });
    expect(outcome.status).toBe('installed');
  } finally {
    process.umask(previous);
  }
  expect(statSync(join(box.root, 'a')).mode & 0o777).toBe(0o755);
  expect(statSync(join(box.root, 'a', 'b')).mode & 0o777).toBe(0o755);
  expect(statSync(deep).mode & 0o777).toBe(0o644);
  expect(statSync(box.root).mode & 0o777).toBe(0o700);
});

test('each missing parent directory is created and recorded, outermost first', () => {
  const box = sandbox();
  const deep = join(box.root, 'a', 'b', 'c.md');
  installed(box, [{ content: 'test', path: deep }]);
  expect(ownerText(box)).toBe(
    committed([join(box.root, 'a'), join(box.root, 'a', 'b')], [[deep, digests.test]]),
  );
});

test('a second install with new content replaces both', () => {
  const box = sandbox();
  installed(box, [
    { content: 'test', path: box.first },
    { content: 'abc', path: box.second },
  ]);
  const outcome = installed(box, [
    { content: 'new', path: box.first },
    { content: 'new', path: box.second },
  ]);
  expect(outcome).toMatchObject({ status: 'installed', written: [box.first, box.second] });
  expect(readFileSync(box.first, 'utf8')).toBe('new');
  expect(readFileSync(box.second, 'utf8')).toBe('new');
  expect(ownerText(box)).toBe(
    committed(
      [box.directory],
      [
        [box.first, digests.new],
        [box.second, digests.new],
      ],
    ),
  );
});

test('an install that lists only the first file removes the second', () => {
  const box = sandbox();
  installed(box, [
    { content: 'test', path: box.first },
    { content: 'abc', path: box.second },
  ]);
  const outcome = installed(box, [{ content: 'test', path: box.first }]);
  expect(outcome).toEqual({
    kept: [],
    removed: [box.second],
    status: 'installed',
    written: [box.first],
  });
  expect(existsSync(box.second)).toBe(false);
  expect(ownerText(box)).toBe(committed([box.directory], [[box.first, digests.test]]));
});

test('a recorded file the install no longer lists is kept and reported when it changed', () => {
  const box = sandbox();
  installed(box, [
    { content: 'test', path: box.first },
    { content: 'abc', path: box.second },
  ]);
  writeFileSync(box.second, 'mine');
  const outcome = installed(box, [{ content: 'test', path: box.first }]);
  expect(outcome).toEqual({
    kept: [box.second],
    removed: [],
    status: 'installed',
    written: [box.first],
  });
  expect(readFileSync(box.second, 'utf8')).toBe('mine');
  expect(ownerText(box)).toBe(committed([box.directory], [[box.first, digests.test]]));
});

test.each([
  [
    'an unrecorded file',
    'unrecorded',
    (box: Box) => {
      mkdirSync(box.directory);
      writeFileSync(box.second, 'theirs');
    },
  ],
  [
    'a recorded file changed since',
    'changed',
    (box: Box) => {
      installed(box, [
        { content: 'test', path: box.first },
        { content: 'abc', path: box.second },
      ]);
      writeFileSync(box.second, 'changed');
    },
  ],
  [
    'a symbolic link',
    'link',
    (box: Box) => {
      mkdirSync(box.directory);
      writeFileSync(join(box.root, 'elsewhere'), 'abc');
      symlinkSync(join(box.root, 'elsewhere'), box.second);
    },
  ],
  [
    'a directory',
    'directory',
    (box: Box) => {
      mkdirSync(box.second, { recursive: true });
    },
  ],
] as const)(
  'an install over %s refuses, writes nothing, and reports the path',
  (_case, reason, arrange) => {
    const box = sandbox();
    arrange(box);
    const before = existsSync(box.owner) ? ownerText(box) : undefined;
    const firstBefore = existsSync(box.first) ? readFileSync(box.first, 'utf8') : undefined;
    const outcome = installed(box, [
      { content: 'new', path: box.first },
      { content: 'new', path: box.second },
    ]);
    expect(outcome).toEqual({ refused: [{ path: box.second, reason }], status: 'refused' });
    expect(existsSync(box.owner) ? ownerText(box) : undefined).toBe(before);
    expect(existsSync(box.first) ? readFileSync(box.first, 'utf8') : undefined).toBe(firstBefore);
  },
);

test('an install removes leftover staging files of the plugin file', () => {
  const box = sandbox();
  installed(box, [{ content: 'test', path: box.first }]);
  const leftover = join(box.record, '.skill.json.0123456789abcdef.loom-staging');
  writeFileSync(leftover, '{"format":1,');
  installed(box, [{ content: 'test', path: box.first }]);
  expect(readdirSync(box.record)).toEqual(['skill.json']);
});

test('an install reports every path it refuses', () => {
  const box = sandbox();
  mkdirSync(box.directory);
  writeFileSync(box.first, 'theirs');
  writeFileSync(box.second, 'theirs');
  expect(
    installed(box, [
      { content: 'new', path: box.first },
      { content: 'new', path: box.second },
    ]),
  ).toEqual({
    refused: [
      { path: box.first, reason: 'unrecorded' },
      { path: box.second, reason: 'unrecorded' },
    ],
    status: 'refused',
  });
});

test.each([
  ['not JSON', '{"format":1,', 'damaged'],
  ['an array', '[]\n', 'damaged'],
  ['a committed file with a relative path', committed([], [['notes.md', digests.test]]), 'damaged'],
  [
    'a file with an unknown state',
    '{"format":1,"state":"done","directories":[],"files":[]}\n',
    'damaged',
  ],
  [
    'an unknown format',
    '{"format":2,"state":"committed","directories":[],"files":[]}\n',
    'unknown-format',
  ],
])(
  'a plugin file that is %s refuses the install, writes nothing, and reports its path',
  (_case, text, reason) => {
    const box = sandbox();
    mkdirSync(box.record);
    writeFileSync(box.owner, text);
    const leftover = join(box.record, '.skill.json.0123456789abcdef.loom-staging');
    writeFileSync(leftover, '{"format":1,');
    expect(installed(box, [{ content: 'test', path: box.first }])).toEqual({
      refused: [{ path: box.owner, reason }],
      status: 'refused',
    });
    expect(ownerText(box)).toBe(text);
    expect(existsSync(leftover)).toBe(true);
    expect(existsSync(box.directory)).toBe(false);
  },
);

test('an install reads the run signal before it writes and throws its reason', () => {
  const box = sandbox();
  const controller = new AbortController();
  const reason = new Error('Cancelled.');
  controller.abort(reason);
  expect(() => installed(box, [{ content: 'test', path: box.first }], controller.signal)).toThrow(
    reason,
  );
  expect(existsSync(box.record)).toBe(false);
  expect(existsSync(box.directory)).toBe(false);
});

test.skipIf(process.platform === 'win32')(
  'an install over a FIFO refuses, writes nothing, and reports the path',
  () => {
    const box = sandbox();
    mkdirSync(box.directory);
    expect(spawnSync('mkfifo', [box.second]).status).toBe(0);
    expect(
      installed(box, [
        { content: 'new', path: box.first },
        { content: 'new', path: box.second },
      ]),
    ).toEqual({ refused: [{ path: box.second, reason: 'special' }], status: 'refused' });
    expect(existsSync(box.first)).toBe(false);
    expect(existsSync(box.owner)).toBe(false);
  },
);

// Uninstalling

test('an uninstall reads the run signal before the first removal and throws its reason', () => {
  const box = sandbox();
  installed(box, [
    { content: 'test', path: box.first },
    { content: 'abc', path: box.second },
  ]);
  const before = ownerText(box);
  const controller = new AbortController();
  const reason = new Error('Cancelled.');
  controller.abort(reason);
  expect(() =>
    uninstall({ plugin: 'skill', record: box.record, signal: controller.signal }),
  ).toThrow(reason);
  expect(readFileSync(box.first, 'utf8')).toBe('test');
  expect(readFileSync(box.second, 'utf8')).toBe('abc');
  expect(ownerText(box)).toBe(before);
});

test('uninstall removes unchanged files and the created directory, and deletes the plugin file', () => {
  const box = sandbox();
  installed(box, [
    { content: 'test', path: box.first },
    { content: 'abc', path: box.second },
  ]);
  expect(uninstalled(box)).toEqual({
    kept: [],
    removed: [box.first, box.second],
    status: 'uninstalled',
  });
  expect(existsSync(box.directory)).toBe(false);
  expect(existsSync(box.skills)).toBe(true);
  expect(existsSync(box.owner)).toBe(false);
});

test('uninstall keeps and reports a changed file, which keeps its directory', () => {
  const box = sandbox();
  installed(box, [
    { content: 'test', path: box.first },
    { content: 'abc', path: box.second },
  ]);
  writeFileSync(box.second, 'mine');
  expect(uninstalled(box)).toEqual({
    kept: [box.second],
    removed: [box.first],
    status: 'uninstalled',
  });
  expect(readFileSync(box.second, 'utf8')).toBe('mine');
  expect(existsSync(box.owner)).toBe(false);
});

test('uninstall passes over a file and a directory already gone', () => {
  const box = sandbox();
  installed(box, [{ content: 'test', path: box.first }]);
  rmSync(box.directory, { recursive: true });
  expect(uninstalled(box)).toEqual({ kept: [], removed: [], status: 'uninstalled' });
  expect(existsSync(box.owner)).toBe(false);
});

test('uninstall removes created directories deepest first', () => {
  const box = sandbox();
  const deep = join(box.root, 'a', 'b', 'c.md');
  installed(box, [{ content: 'test', path: deep }]);
  uninstalled(box);
  expect(existsSync(join(box.root, 'a'))).toBe(false);
});

test('uninstall with no plugin file records nothing and removes nothing', () => {
  const box = sandbox();
  expect(uninstalled(box)).toEqual({ kept: [], removed: [], status: 'uninstalled' });
  expect(existsSync(box.record)).toBe(false);
});

test('uninstall removes leftover staging files of the plugin file', () => {
  const box = sandbox();
  installed(box, [{ content: 'test', path: box.first }]);
  writeFileSync(join(box.record, '.skill.json.0123456789abcdef.loom-staging'), '{"format":1,');
  uninstalled(box);
  expect(readdirSync(box.record)).toEqual([]);
});

test('uninstall refuses a damaged plugin file and reports its path', () => {
  const box = sandbox();
  mkdirSync(box.record);
  writeFileSync(box.owner, 'damaged');
  expect(uninstalled(box)).toEqual({
    refused: [{ path: box.owner, reason: 'damaged' }],
    status: 'refused',
  });
  expect(ownerText(box)).toBe('damaged');
});

// Recovery

test('recovery resolves each pending path by its digest before the install it precedes', () => {
  const box = sandbox();
  mkdirSync(box.directory);
  const written = join(box.directory, 'w.md');
  const unwritten = join(box.directory, 'u.md');
  const removed = join(box.directory, 'r.md');
  const changed = join(box.directory, 'c.md');
  writeFileSync(written, 'new');
  writeFileSync(unwritten, 'test');
  writeFileSync(changed, 'theirs');
  pending(
    box,
    [box.directory, join(box.root, 'gone')],
    [
      [written, digests.test, digests.new],
      [unwritten, digests.test, digests.new],
      [removed, digests.abc, null],
      [changed, null, digests.new],
    ],
  );
  // A directory as a target refuses the install after recovery committed, so the file shows it.
  mkdirSync(box.first);
  expect(installed(box, [{ content: 'test', path: box.first }])).toMatchObject({
    status: 'refused',
  });
  expect(ownerText(box)).toBe(
    committed(
      [box.directory],
      [
        [written, digests.new],
        [unwritten, digests.test],
      ],
    ),
  );
  expect(readFileSync(changed, 'utf8')).toBe('theirs');
});

test('a pending path changed by hand before the next run is kept and no longer recorded', () => {
  const box = sandbox();
  mkdirSync(box.directory);
  writeFileSync(box.second, 'by hand');
  pending(
    box,
    [box.directory],
    [
      [box.first, null, digests.test],
      [box.second, null, digests.abc],
    ],
  );
  const outcome = installed(box, [{ content: 'test', path: box.first }]);
  expect(outcome).toEqual({ kept: [], removed: [], status: 'installed', written: [box.first] });
  expect(readFileSync(box.second, 'utf8')).toBe('by hand');
  expect(ownerText(box)).toBe(committed([box.directory], [[box.first, digests.test]]));
});

test('recovery removes leftover staging files of each pending path and nothing else', () => {
  const box = sandbox();
  mkdirSync(box.directory);
  const leftover = join(box.directory, '.SKILL.md.0123456789abcdef.loom-staging');
  const unrelated = join(box.directory, '.SKILL.md.notes');
  writeFileSync(leftover, 'te');
  writeFileSync(unrelated, 'mine');
  pending(box, [box.directory], [[box.first, null, digests.test]]);
  installed(box, [{ content: 'test', path: box.first }]);
  expect(existsSync(leftover)).toBe(false);
  expect(readFileSync(unrelated, 'utf8')).toBe('mine');
  expect(readdirSync(box.directory).toSorted()).toEqual(['.SKILL.md.notes', 'SKILL.md']);
});

test('recovery runs before an uninstall too', () => {
  const box = sandbox();
  mkdirSync(box.directory);
  writeFileSync(box.first, 'test');
  pending(box, [box.directory], [[box.first, null, digests.test]]);
  expect(uninstalled(box)).toEqual({ kept: [], removed: [box.first], status: 'uninstalled' });
  expect(existsSync(box.directory)).toBe(false);
});

// Recovery from a process that stopped

const fixture = new URL('fixtures/installation-run.mjs', import.meta.url);

/** One run of the module in its own process under Node, whose fs traps need Node's ESM builtins. */
function inProcess(request: Record<string, unknown>) {
  return invoke(fixture, [JSON.stringify(request)], { runtime: 'node' });
}

test('a process killed between two targets leaves a pending file, and the next install finishes both', () => {
  const box = sandbox();
  const files = [
    { content: 'test', path: box.first },
    { content: 'abc', path: box.second },
  ];
  const killed = inProcess({ files, killAfterRename: box.first, record: box.record });
  expect(killed).toMatchObject({ status: null, stdout: '' });
  expect(JSON.parse(ownerText(box))).toMatchObject({ state: 'pending' });
  expect(readFileSync(box.first, 'utf8')).toBe('test');
  expect(existsSync(box.second)).toBe(false);
  expect(installed(box, files)).toEqual({
    kept: [],
    removed: [],
    status: 'installed',
    written: [box.first, box.second],
  });
  expect(readFileSync(box.second, 'utf8')).toBe('abc');
  expect(ownerText(box)).toBe(
    committed(
      [box.directory],
      [
        [box.first, digests.test],
        [box.second, digests.abc],
      ],
    ),
  );
});

test('a process killed before it creates a listed directory leaves a pending file whose next install creates and records it', () => {
  const box = sandbox();
  const files = [{ content: 'test', path: box.first }];
  const killed = inProcess({ files, killBeforeMkdir: box.directory, record: box.record });
  expect(killed).toMatchObject({ status: null, stdout: '' });
  expect(JSON.parse(ownerText(box))).toMatchObject({
    directories: [box.directory],
    state: 'pending',
  });
  expect(existsSync(box.directory)).toBe(false);
  expect(installed(box, files)).toMatchObject({ status: 'installed' });
  expect(ownerText(box)).toBe(committed([box.directory], [[box.first, digests.test]]));
});

test('two installs writing one target at once never rename one partial staging file into place', async () => {
  const box = sandbox();
  const size = 4 * 1024 * 1024;
  const children = ['a', 'b'].map((fill) =>
    start(fixture, [
      JSON.stringify({ files: [{ fill, path: box.first, size }], record: box.record, rounds: 15 }),
    ]),
  );
  const running = () => children.some(({ child }) => child.exitCode === null);
  const whole = /^(?:a+|b+)$/u;
  // Each read of the target while both run: whether it held one install's content, whole.
  const reads: boolean[] = [];
  while (running()) {
    if (existsSync(box.first)) {
      const content = readFileSync(box.first, 'latin1');
      reads.push(content.length === size && whole.test(content));
    }
    await after(1);
  }
  const completions = await Promise.all(children.map(({ exit }) => exit));
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(Boolean)).toBe(true);
  expect(completions.map(({ status }) => status)).toEqual([0, 0]);
  const outcomes = completions.flatMap(({ stdout }) =>
    stdout
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line)),
  );
  // A run can recover the other's pending file and remove its staging file, so its rename fails.
  const ends = new Set(outcomes.map((outcome) => outcome.status ?? outcome.failed));
  expect([...ends].filter((end) => !['installed', 'refused', 'ENOENT'].includes(end))).toEqual([]);
  expect(ends.has('installed')).toBe(true);
  expect(whole.test(readFileSync(box.first, 'latin1'))).toBe(true);
}, 60_000);

test('a replacement whose rename fails throws the rename error and leaves no staging file', () => {
  const box = sandbox();
  mkdirSync(box.first, { recursive: true });
  expect(() => replaceFile(box.first, 'test')).toThrow(/EISDIR|ENOTEMPTY|EEXIST|EPERM/u);
  expect(readdirSync(dirname(box.first))).toEqual([basename(box.first)]);
});

/** What the skill plugin's file records, read without writing. */
function read(box: Box) {
  return readRecorded({ plugin: 'skill', record: box.record });
}

test('reading what a plugin file records returns each file and digest and writes nothing', () => {
  const box = sandbox();
  expect(read(box)).toEqual({ files: [], status: 'read' });
  expect(existsSync(box.record)).toBe(false);
  installed(box, [{ content: 'test', path: box.first }]);
  const before = ownerText(box);
  const staging = join(box.record, '.skill.json.0123456789abcdef.loom-staging');
  writeFileSync(staging, 'leftover');
  expect(read(box)).toEqual({ files: [{ digest: digests.test, path: box.first }], status: 'read' });
  expect(ownerText(box)).toBe(before);
  expect(existsSync(staging)).toBe(true);
});

test('reading a pending plugin file returns what recovery would keep and writes nothing', () => {
  const box = sandbox();
  mkdirSync(box.directory);
  writeFileSync(box.first, 'new');
  pending(
    box,
    [box.directory],
    [
      [box.first, digests.test, digests.new],
      [box.second, null, digests.abc],
    ],
  );
  const before = ownerText(box);
  expect(read(box)).toEqual({ files: [{ digest: digests.new, path: box.first }], status: 'read' });
  expect(ownerText(box)).toBe(before);
});

test.each([
  ['damaged', 'not json'],
  ['unknown-format', '{"format":2,"state":"committed","directories":[],"files":[]}\n'],
])('reading a %s plugin file refuses it and reports its path', (reason, text) => {
  const box = sandbox();
  mkdirSync(box.record);
  writeFileSync(box.owner, text);
  expect(read(box)).toEqual({ refused: { path: box.owner, reason }, status: 'refused' });
  expect(readFileSync(box.owner, 'utf8')).toBe(text);
});

test('the target refusals read without writing match the ones an install meets', () => {
  const box = sandbox();
  installed(box, [{ content: 'test', path: box.first }]);
  const recorded = read(box);
  if (recorded.status !== 'read') {
    throw new Error('The plugin file did not read.');
  }
  const link = join(box.skills, 'link.md');
  symlinkSync(box.first, link);
  const unrecorded = join(box.skills, 'other.md');
  writeFileSync(unrecorded, 'abc');
  const absent = join(box.skills, 'absent.md');
  const paths = [box.first, absent, unrecorded, link, box.skills];
  expect(targetRefusals(paths, recorded.files)).toEqual([
    { path: unrecorded, reason: 'unrecorded' },
    { path: link, reason: 'link' },
    { path: box.skills, reason: 'directory' },
  ]);
  writeFileSync(box.first, 'abc');
  expect(targetRefusals([box.first], recorded.files)).toEqual([
    { path: box.first, reason: 'changed' },
  ]);
});

// Installed folders

/** A folder of the skill plugin at `path` holding the named files, each with its content. */
function folderOf(path: string, files: Record<string, string>): InstalledFolder {
  return {
    files: Object.entries(files).map(([name, content]) => ({ content, path: name })),
    path,
  };
}

/** One install of `folders` by the skill plugin, with `files` and the force mode when named. */
function installedFolders(
  box: Box,
  folders: readonly InstalledFolder[],
  extra: { files?: readonly InstalledFile[]; force?: boolean } = {},
) {
  return install({
    files: extra.files ?? [],
    folders,
    plugin: 'skill',
    record: box.record,
    signal: new AbortController().signal,
    ...(extra.force === undefined ? {} : { force: extra.force }),
  });
}

/** A committed plugin's file's bytes with the folders it records and no files. */
function committedFolders(directories: readonly string[], folders: readonly string[]): string {
  const entries = folders.map((path) => ({ path }));
  return `${JSON.stringify({ format: 1, state: 'committed', directories, files: [], folders: entries })}\n`;
}

/** Every entry under `directory` as `name`, `name/`, or `name -> target`, sorted, without following links. */
function listing(directory: string, prefix = ''): string[] {
  const lines: string[] = [];
  for (const name of readdirSync(directory).toSorted()) {
    const path = join(directory, name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      lines.push(`${prefix}${name} -> ${readlinkSync(path)}`);
    } else if (stats.isDirectory()) {
      lines.push(`${prefix}${name}/`, ...listing(path, `${prefix}${name}/`));
    } else {
      lines.push(`${prefix}${name}`);
    }
  }
  return lines;
}

/** An outside directory with a file in it, which a link inside an installed folder points at. */
function outside(box: Box): string {
  const directory = join(box.root, 'outside');
  mkdirSync(directory);
  writeFileSync(join(directory, 'keep.txt'), 'keep');
  return directory;
}

test('installing a folder writes it whole, with its modes, and records its path and created parents', () => {
  const box = sandbox();
  const folder = join(box.skills, 'deep', 'notes');
  const outcome = installedFolders(box, [
    {
      files: [
        { content: 'test', path: 'SKILL.md' },
        { content: 'abc', mode: 0o755, path: 'agents/run.sh' },
      ],
      path: folder,
    },
  ]);
  expect(outcome).toEqual({ kept: [], removed: [], status: 'installed', written: [folder] });
  expect(listing(folder)).toEqual(['SKILL.md', 'agents/', 'agents/run.sh']);
  expect(readFileSync(join(folder, 'agents', 'run.sh'), 'utf8')).toBe('abc');
  expect(statSync(join(folder, 'agents', 'run.sh')).mode & 0o7777).toBe(0o755);
  expect(ownerText(box)).toBe(committedFolders([join(box.skills, 'deep')], [folder]));
  expect(listing(join(box.skills, 'deep'))).toEqual([
    'notes/',
    'notes/SKILL.md',
    'notes/agents/',
    'notes/agents/run.sh',
  ]);
});

test('a second install leaves exactly the new files, even after edits and additions inside the folder', () => {
  const box = sandbox();
  installedFolders(box, [folderOf(box.directory, { 'SKILL.md': 'test', 'old.md': 'abc' })]);
  writeFileSync(join(box.directory, 'SKILL.md'), 'edited');
  writeFileSync(join(box.directory, 'added.md'), 'mine');
  mkdirSync(join(box.directory, 'extra'));
  const outcome = installedFolders(box, [
    folderOf(box.directory, { 'SKILL.md': 'new', 'references/old.md': 'abc' }),
  ]);
  expect(outcome).toEqual({ kept: [], removed: [], status: 'installed', written: [box.directory] });
  expect(listing(box.directory)).toEqual(['SKILL.md', 'references/', 'references/old.md']);
  expect(readFileSync(join(box.directory, 'SKILL.md'), 'utf8')).toBe('new');
  expect(listing(box.skills)).toEqual([
    'notes/',
    'notes/SKILL.md',
    'notes/references/',
    'notes/references/old.md',
  ]);
  expect(ownerText(box)).toBe(committedFolders([], [box.directory]));
});

test('an install that no longer lists a recorded folder removes it whole, edits included', () => {
  const box = sandbox();
  const other = join(box.skills, 'other');
  installedFolders(box, [
    folderOf(box.directory, { 'SKILL.md': 'test' }),
    folderOf(other, { 'a.md': 'abc' }),
  ]);
  writeFileSync(join(box.directory, 'added.md'), 'mine');
  const outcome = installedFolders(box, [folderOf(other, { 'a.md': 'abc' })]);
  expect(outcome).toEqual({
    kept: [],
    removed: [box.directory],
    status: 'installed',
    written: [other],
  });
  expect(listing(box.skills)).toEqual(['other/', 'other/a.md']);
  expect(ownerText(box)).toBe(committedFolders([], [other]));
});

test('files and folders install together and an uninstall removes both', () => {
  const box = sandbox();
  const folder = join(box.skills, 'pack');
  installedFolders(box, [folderOf(folder, { 'a.md': 'abc' })], {
    files: [{ content: 'test', path: box.first }],
  });
  expect(readFileSync(box.first, 'utf8')).toBe('test');
  expect(JSON.parse(ownerText(box))).toMatchObject({
    files: [{ digest: digests.test, path: box.first }],
    folders: [{ path: folder }],
  });
  expect(uninstalled(box)).toEqual({
    kept: [],
    removed: [box.first, folder],
    status: 'uninstalled',
  });
  expect(listing(box.skills)).toEqual([]);
});

// What is at a listed folder's path

/** What can sit at a listed folder's path, each made at `path`, with the outside directory a link points at. */
const occupants: [string, (path: string, target: string) => void][] = [
  [
    'an unrecorded folder',
    (path) => {
      mkdirSync(path);
      writeFileSync(join(path, 'mine.md'), 'mine');
    },
  ],
  ['a regular file', (path) => writeFileSync(path, 'mine')],
  ['a symbolic link to a directory', (path, target) => symlinkSync(target, path)],
];

test.each(occupants)(
  'an install over %s refuses and writes nothing, files and folders alike',
  (_name, occupy) => {
    const box = sandbox();
    const target = outside(box);
    occupy(box.directory, target);
    const before = listing(box.root);
    const outcome = installedFolders(box, [folderOf(box.directory, { 'SKILL.md': 'test' })], {
      files: [{ content: 'abc', path: join(box.skills, 'file.md') }],
    });
    expect(outcome).toEqual({
      refused: [{ path: box.directory, reason: 'unrecorded' }],
      status: 'refused',
    });
    expect(listing(box.root)).toEqual(before);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep');
  },
);

test.each(occupants)(
  'the force mode replaces %s, records the folder, and reports the takeover',
  (_name, occupy) => {
    const box = sandbox();
    const target = outside(box);
    occupy(box.directory, target);
    const outcome = installedFolders(box, [folderOf(box.directory, { 'SKILL.md': 'test' })], {
      force: true,
    });
    expect(outcome).toEqual({
      kept: [],
      removed: [],
      replaced: [box.directory],
      status: 'installed',
      written: [box.directory],
    });
    expect(listing(box.directory)).toEqual(['SKILL.md']);
    expect(lstatSync(box.directory).isDirectory()).toBe(true);
    expect(listing(target)).toEqual(['keep.txt']);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep');
    expect(ownerText(box)).toBe(committedFolders([], [box.directory]));
    expect(readdirSync(box.skills)).toEqual(['notes']);
  },
);

test('the force mode reports nothing replaced for an absent or a recorded folder', () => {
  const box = sandbox();
  expect(
    installedFolders(box, [folderOf(box.directory, { 'a.md': 'abc' })], { force: true }),
  ).toEqual({
    kept: [],
    removed: [],
    status: 'installed',
    written: [box.directory],
  });
  expect(
    installedFolders(box, [folderOf(box.directory, { 'a.md': 'abc' })], { force: true }),
  ).not.toHaveProperty('replaced');
});

test('a symbolic link inside a recorded folder is never followed when the folder is replaced or removed', () => {
  const box = sandbox();
  const target = outside(box);
  installedFolders(box, [folderOf(box.directory, { 'SKILL.md': 'test' })]);
  symlinkSync(target, join(box.directory, 'link'));
  installedFolders(box, [folderOf(box.directory, { 'SKILL.md': 'new' })]);
  expect(listing(box.directory)).toEqual(['SKILL.md']);
  expect(listing(target)).toEqual(['keep.txt']);
  symlinkSync(target, join(box.directory, 'link'));
  symlinkSync(join(target, 'keep.txt'), join(box.directory, 'file-link'));
  expect(uninstalled(box)).toMatchObject({ removed: [box.directory], status: 'uninstalled' });
  expect(listing(box.skills)).toEqual([]);
  expect(listing(target)).toEqual(['keep.txt']);
  expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep');
});

test('a recorded folder replaced by a link or a file is replaced without following the link', () => {
  const box = sandbox();
  const target = outside(box);
  installedFolders(box, [folderOf(box.directory, { 'SKILL.md': 'test' })]);
  rmSync(box.directory, { recursive: true });
  symlinkSync(target, box.directory);
  expect(installedFolders(box, [folderOf(box.directory, { 'SKILL.md': 'new' })]).status).toBe(
    'installed',
  );
  expect(listing(box.directory)).toEqual(['SKILL.md']);
  expect(listing(target)).toEqual(['keep.txt']);
  rmSync(box.directory, { recursive: true });
  symlinkSync(target, box.directory);
  expect(uninstalled(box)).toMatchObject({ removed: [box.directory], status: 'uninstalled' });
  expect(existsSync(box.directory)).toBe(false);
  expect(listing(target)).toEqual(['keep.txt']);
});

// Uninstalling folders

test('an uninstall removes recorded folders whole, passes over a gone folder, and removes empty created parents', () => {
  const box = sandbox();
  const parent = join(box.skills, 'deep');
  const first = join(parent, 'one');
  const second = join(parent, 'two');
  installedFolders(box, [folderOf(first, { 'a.md': 'abc' }), folderOf(second, { 'b.md': 'abc' })]);
  writeFileSync(join(first, 'edited.md'), 'mine');
  rmSync(second, { recursive: true });
  expect(uninstalled(box)).toEqual({ kept: [], removed: [first], status: 'uninstalled' });
  expect(listing(box.skills)).toEqual([]);
  expect(existsSync(box.owner)).toBe(false);
});

test('an uninstall keeps a created parent that holds something else', () => {
  const box = sandbox();
  const parent = join(box.skills, 'deep');
  const folder = join(parent, 'one');
  installedFolders(box, [folderOf(folder, { 'a.md': 'abc' })]);
  writeFileSync(join(parent, 'mine.md'), 'mine');
  uninstalled(box);
  expect(listing(box.skills)).toEqual(['deep/', 'deep/mine.md']);
});

// Recovery of folders

test('a process killed between moving the old folder aside and renaming the new one leaves a pending file the next install recovers', () => {
  const box = sandbox();
  const other = join(box.skills, 'other');
  installedFolders(box, [
    folderOf(box.directory, { 'SKILL.md': 'test' }),
    folderOf(other, { 'a.md': 'abc' }),
  ]);
  const folders = [
    {
      files: [
        { content: 'new', path: 'SKILL.md' },
        { content: 'abc', path: 'extra.md' },
      ],
      path: box.directory,
    },
    { files: [{ content: 'abc', path: 'a.md' }], path: other },
  ];
  const killed = inProcess({
    files: [],
    folders,
    killAfterMoveAside: box.directory,
    record: box.record,
  });
  expect(killed).toMatchObject({ status: null, stdout: '' });
  expect(JSON.parse(ownerText(box))).toMatchObject({
    folders: [{ path: box.directory }, { path: other }],
    state: 'pending',
  });
  expect(existsSync(box.directory)).toBe(false);
  const leftovers = readdirSync(box.skills).filter(
    (name) => name.endsWith('.loom-retired') || name.endsWith('.loom-staging'),
  );
  expect(leftovers.length).toBeGreaterThan(0);
  const alien = join(box.skills, '.other-name.0123456789abcdef.loom-retired');
  const lookalike = join(box.skills, '.notes.not-sixteen-hex.loom-staging');
  const longer = join(box.skills, '.notes2.0123456789abcdef.loom-staging');
  for (const path of [alien, lookalike, longer]) {
    mkdirSync(path);
  }
  const outcome = installedFolders(box, [
    folderOf(box.directory, { 'SKILL.md': 'new', 'extra.md': 'abc' }),
    folderOf(other, { 'a.md': 'abc' }),
  ]);
  expect(outcome).toEqual({
    kept: [],
    removed: [],
    status: 'installed',
    written: [box.directory, other],
  });
  expect(listing(box.directory)).toEqual(['SKILL.md', 'extra.md']);
  expect(readdirSync(box.skills).toSorted()).toEqual(
    [
      '.notes.not-sixteen-hex.loom-staging',
      '.notes2.0123456789abcdef.loom-staging',
      '.other-name.0123456789abcdef.loom-retired',
      'notes',
      'other',
    ].toSorted(),
  );
  expect(ownerText(box)).toBe(committedFolders([], [box.directory, other]));
});

test('a pending file keeps a folder recorded whether or not it is there, and an uninstall passes over a gone one', () => {
  const box = sandbox();
  mkdirSync(box.record, { recursive: true });
  const retired = join(box.skills, '.notes.0123456789abcdef.loom-retired');
  mkdirSync(retired);
  writeFileSync(join(retired, 'old.md'), 'old');
  writeFileSync(
    box.owner,
    `${JSON.stringify({ format: 1, state: 'pending', directories: [], files: [], folders: [{ path: box.directory }] })}\n`,
  );
  expect(read(box)).toEqual({ files: [], folders: [{ path: box.directory }], status: 'read' });
  expect(existsSync(retired)).toBe(true);
  expect(uninstalled(box)).toEqual({ kept: [], removed: [], status: 'uninstalled' });
  expect(existsSync(retired)).toBe(false);
  expect(existsSync(box.owner)).toBe(false);
});

test('a recorded folder that is gone is written again by the next install', () => {
  const box = sandbox();
  installedFolders(box, [folderOf(box.directory, { 'a.md': 'abc' })]);
  rmSync(box.directory, { recursive: true });
  expect(installedFolders(box, [folderOf(box.directory, { 'a.md': 'abc' })]).status).toBe(
    'installed',
  );
  expect(listing(box.directory)).toEqual(['a.md']);
});

// Reading folders

test('reading a plugin file returns its recorded folders, and none when it records none', () => {
  const box = sandbox();
  installedFolders(box, [folderOf(box.directory, { 'a.md': 'abc' })]);
  expect(read(box)).toEqual({ files: [], folders: [{ path: box.directory }], status: 'read' });
  installedFolders(box, []);
  expect(read(box)).toEqual({ files: [], status: 'read' });
});

test('a plugin file with a folders member that is not a list of absolute paths is damaged', () => {
  const box = sandbox();
  mkdirSync(box.record);
  for (const folders of ['x', [{ path: 'relative' }], [{ path: '/a', digest: 'x' }, 1]]) {
    writeFileSync(
      box.owner,
      `${JSON.stringify({ format: 1, state: 'committed', directories: [], files: [], folders })}\n`,
    );
    expect(read(box)).toEqual({
      refused: { path: box.owner, reason: 'damaged' },
      status: 'refused',
    });
  }
});

test('the folder refusals read without writing match the ones an install meets', () => {
  const box = sandbox();
  installedFolders(box, [folderOf(box.directory, { 'a.md': 'abc' })]);
  const link = join(box.skills, 'link');
  symlinkSync(box.directory, link);
  const file = join(box.skills, 'file');
  writeFileSync(file, 'x');
  const directory = join(box.skills, 'dir');
  mkdirSync(directory);
  const absent = join(box.skills, 'absent');
  expect(
    folderRefusals([box.directory, absent, link, file, directory], [{ path: box.directory }]),
  ).toEqual([
    { path: link, reason: 'unrecorded' },
    { path: file, reason: 'unrecorded' },
    { path: directory, reason: 'unrecorded' },
  ]);
});

// The exact-contents check

const exactFiles = [
  { content: 'test', path: 'SKILL.md' },
  { content: 'abc', mode: 0o755, path: 'agents/run.sh' },
];

/** A folder at `path` written with `exactFiles`, which a test then spoils one way. */
function exactFolder(box: Box): string {
  writeFolder(box.directory, exactFiles);
  return box.directory;
}

test('a folder holds exactly its files when contents and modes match, with no mode named for a file that names none', () => {
  const box = sandbox();
  expect(folderHoldsExactly(exactFolder(box), exactFiles)).toBe(true);
  chmodSync(join(box.directory, 'SKILL.md'), 0o600);
  expect(folderHoldsExactly(box.directory, exactFiles)).toBe(true);
});

test.each([
  ['an extra file', (path: string) => writeFileSync(join(path, 'extra.md'), 'x')],
  [
    'an extra file in a subfolder',
    (path: string) => writeFileSync(join(path, 'agents', 'extra.md'), 'x'),
  ],
  ['an extra empty subfolder', (path: string) => mkdirSync(join(path, 'empty'))],
  ['a wrong mode', (path: string) => chmodSync(join(path, 'agents', 'run.sh'), 0o644)],
  ['a wrong content', (path: string) => writeFileSync(join(path, 'SKILL.md'), 'other')],
  ['a missing file', (path: string) => rmSync(join(path, 'SKILL.md'))],
  [
    'a link in place of a file',
    (path: string) => {
      rmSync(join(path, 'SKILL.md'));
      writeFileSync(join(path, '..', 'target.md'), 'test');
      symlinkSync(join(path, '..', 'target.md'), join(path, 'SKILL.md'));
    },
  ],
  [
    'a link to a directory inside',
    (path: string) => symlinkSync(join(path, 'agents'), join(path, 'again')),
  ],
])('a folder with %s does not hold exactly its files', (_name, spoil) => {
  const box = sandbox();
  spoil(exactFolder(box));
  expect(folderHoldsExactly(box.directory, exactFiles)).toBe(false);
});

test('a link at the path, a file, or nothing does not hold exactly its files', () => {
  const box = sandbox();
  const real = join(box.root, 'real');
  writeFolder(real, exactFiles);
  expect(folderHoldsExactly(box.directory, exactFiles)).toBe(false);
  symlinkSync(real, box.directory);
  expect(folderHoldsExactly(box.directory, exactFiles)).toBe(false);
  expect(folderHoldsExactly(join(real, 'SKILL.md'), exactFiles)).toBe(false);
  expect(folderHoldsExactly(real, exactFiles)).toBe(true);
});

// The folder write without a record

test('writing a folder without a record replaces what is there and removes the leftovers of its own name only', () => {
  const box = sandbox();
  const target = outside(box);
  symlinkSync(target, box.directory);
  const own = [
    join(box.skills, '.notes.0123456789abcdef.loom-staging'),
    join(box.skills, '.notes.fedcba9876543210.loom-retired'),
  ];
  const others = [
    join(box.skills, '.other.0123456789abcdef.loom-staging'),
    join(box.skills, '.notes.0123456789ABCDEF.loom-retired'),
  ];
  for (const path of [...own, ...others]) {
    mkdirSync(path);
    symlinkSync(target, join(path, 'link'));
  }
  writeFolder(box.directory, exactFiles);
  expect(folderHoldsExactly(box.directory, exactFiles)).toBe(true);
  expect(existsSync(own[0]!)).toBe(false);
  expect(existsSync(own[1]!)).toBe(false);
  expect(others.every((path) => existsSync(path))).toBe(true);
  expect(listing(target)).toEqual(['keep.txt']);
  expect(existsSync(box.record)).toBe(false);
});

test('writing a folder that fails leaves the old folder and no staging folder', () => {
  const box = sandbox();
  writeFolder(box.directory, [{ content: 'test', path: 'a.md' }]);
  expect(() =>
    writeFolder(box.directory, [
      { content: 'x', path: 'a.md/b.md' },
      { content: 'y', path: 'a.md' },
    ]),
  ).toThrow(/EISDIR|ENOTEMPTY|EEXIST|EPERM|ENOTDIR/u);
  expect(listing(box.skills)).toEqual(['notes/', 'notes/a.md']);
});

test.each([
  ['a file in the staging folder', 'a.md'],
  ['a file in a subfolder', 'sub/deep/a.md'],
])('filling a staging folder that is gone throws and does not make it again: %s', (_name, path) => {
  const box = sandbox();
  const staging = join(box.skills, '.notes.0123456789abcdef.loom-staging');
  expect(() => fillFolder(staging, [{ content: 'abc', path }])).toThrow(/ENOENT/u);
  expect(existsSync(staging)).toBe(false);
});

test('filling a staging folder that goes away between two files throws on the second and does not make it again', () => {
  const box = sandbox();
  const staging = join(box.skills, '.notes.0123456789abcdef.loom-staging');
  mkdirSync(staging);
  let removed = false;
  const files = [
    { content: 'abc', path: 'sub/a.md' },
    {
      content: 'abc',
      get path(): string {
        // The first read comes as the second file starts, after another run's recovery removed the folder.
        if (!removed) {
          removed = true;
          rmSync(staging, { force: true, recursive: true });
        }
        return 'sub/b.md';
      },
    },
    { content: 'abc', path: 'sub/c.md' },
  ];
  expect(() => fillFolder(staging, files)).toThrow(/ENOENT/u);
  expect(existsSync(staging)).toBe(false);
});

// Startup lines

/** The line the tests add to a startup file, and the text that replaces it. */
const loader =
  "if [ -f '/data/notes/_loom_notes' ]; then . '/data/notes/_loom_notes'; fi # added by notes completion install";
const newer =
  "fpath=('/data/notes' $fpath); . '/data/notes/_loom_notes' # added by notes completion install";

/** A sandbox with a home directory that exists and the startup file `.zshrc` in it, which does not. */
function homeBox() {
  const box = sandbox();
  const home = join(box.root, 'home');
  mkdirSync(home);
  return { ...box, home, rc: join(home, '.zshrc') };
}

type HomeBox = ReturnType<typeof homeBox>;

/** One install by the skill plugin of the startup lines and, when named, the rest of a request. */
function installedLines(
  box: Box,
  lines: readonly InstalledLine[],
  extra: Partial<Omit<InstallRequest, 'plugin' | 'record' | 'signal'>> = {},
) {
  return install({
    files: [],
    lines,
    plugin: 'skill',
    record: box.record,
    signal: new AbortController().signal,
    ...extra,
  });
}

/** One uninstall by the skill plugin, releasing the named startup files' lines. */
function uninstalledLines(box: Box, release: readonly string[] = []) {
  return uninstall({
    plugin: 'skill',
    record: box.record,
    release,
    signal: new AbortController().signal,
  });
}

/** What happened to the startup lines, with each list the case does not name empty. */
function linesOutcome(named: Partial<StartupLinesOutcome>): StartupLinesOutcome {
  return {
    added: [],
    held: [],
    noLongerHeld: [],
    released: [],
    removed: [],
    replaced: [],
    ...named,
  };
}

/** A committed plugin's file's bytes with the directories and startup lines it records and no files. */
function committedLines(
  directories: readonly string[],
  lines: readonly [string, string][],
): string {
  const entries = lines.map(([path, line]) => ({ path, line }));
  return `${JSON.stringify({ format: 1, state: 'committed', directories, files: [], lines: entries })}\n`;
}

/** UTF-8 bytes of some text, after the byte order mark `EF BB BF`. */
function utf8WithMark(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

/** What `run` answers when the process runs it under the umask `mask`, which is restored after. */
function underUmask<Result>(mask: number, run: () => Result): Result {
  const previous = process.umask(mask);
  try {
    return run();
  } finally {
    process.umask(previous);
  }
}

test.each([
  ['002', 0o002],
  ['077', 0o077],
])(
  'installing a line into a missing startup file under umask %s creates it with mode 644 and its parent with the named mode, and records both',
  (_mask, mask) => {
    const box = homeBox();
    const rc = join(box.home, 'zdot', '.zshrc');
    const outcome = underUmask(mask, () =>
      installedLines(box, [{ line: loader, path: rc }], { directoryMode: 0o755 }),
    );
    expect(outcome).toEqual({
      kept: [],
      lines: linesOutcome({ added: [{ line: loader, path: rc }] }),
      removed: [],
      status: 'installed',
      written: [],
    });
    expect(readFileSync(rc, 'utf8')).toBe(`${loader}\n`);
    expect(statSync(rc).mode & 0o777).toBe(0o644);
    expect(statSync(dirname(rc)).mode & 0o777).toBe(0o755);
    expect(ownerText(box)).toBe(committedLines([dirname(rc)], [[rc, loader]]));
  },
);

test('a created directory takes the named mode whatever the umask, and follows the umask when none is named', () => {
  const box = sandbox();
  const named = join(box.root, 'named');
  const previous = process.umask(0o077);
  try {
    installed(box, [{ content: 'test', path: box.first }]);
    install({
      directoryMode: 0o755,
      files: [{ content: 'abc', path: join(named, 'a.md') }],
      plugin: 'other',
      record: box.record,
      signal: new AbortController().signal,
    });
  } finally {
    process.umask(previous);
  }
  expect(statSync(box.directory).mode & 0o777).toBe(0o700);
  expect(statSync(named).mode & 0o777).toBe(0o755);
});

test('installing a line into a file that holds it adds nothing and records it', () => {
  const box = homeBox();
  const text = `export A=1\n${loader}\nexport B=2\n`;
  writeFileSync(box.rc, text);
  expect(installedLines(box, [{ line: loader, path: box.rc }])).toMatchObject({
    lines: linesOutcome({ held: [{ line: loader, path: box.rc }] }),
    status: 'installed',
  });
  expect(readFileSync(box.rc, 'utf8')).toBe(text);
  expect(ownerText(box)).toBe(committedLines([], [[box.rc, loader]]));
});

test.each([
  ['a file that ends with a line feed', 'export A=1\n', `export A=1\n${loader}\n`],
  ['a file that does not end with a line break', 'export A=1', `export A=1\n${loader}\n`],
  ['an empty file', '', `${loader}\n`],
  ['a file with CRLF endings', 'a\r\nb\r\n', `a\r\nb\r\n${loader}\r\n`],
  ['a CRLF file that does not end with a line break', 'a\r\nb', `a\r\nb\r\n${loader}\r\n`],
  ['a file whose first line break is a line feed', 'a\nb\r\n', `a\nb\r\n${loader}\n`],
])(
  'installing a line into %s appends it with the file’s own line ending',
  (_case, text, appended) => {
    const box = homeBox();
    writeFileSync(box.rc, text);
    expect(installedLines(box, [{ line: loader, path: box.rc }])).toMatchObject({
      lines: linesOutcome({ added: [{ line: loader, path: box.rc }] }),
    });
    expect(readFileSync(box.rc, 'utf8')).toBe(appended);
  },
);

test('installing a line into a UTF-8 file with a byte order mark appends it with no second mark', () => {
  const box = homeBox();
  writeFileSync(box.rc, utf8WithMark('export A=1\n'));
  installedLines(box, [{ line: loader, path: box.rc }]);
  expect(readFileSync(box.rc)).toEqual(utf8WithMark(`export A=1\n${loader}\n`));
});

test('a UTF-8 file with a byte order mark right before the line holds it', () => {
  const box = homeBox();
  writeFileSync(box.rc, utf8WithMark(`${loader}\n`));
  expect(installedLines(box, [{ line: loader, path: box.rc }])).toMatchObject({
    lines: linesOutcome({ held: [{ line: loader, path: box.rc }] }),
  });
  expect(readFileSync(box.rc)).toEqual(utf8WithMark(`${loader}\n`));
});

test('a last line that differs by a carriage return with no line feed after it does not hold the line', () => {
  const box = homeBox();
  writeFileSync(box.rc, `${loader}\r`);
  expect(installedLines(box, [{ line: loader, path: box.rc }])).toMatchObject({
    lines: linesOutcome({ added: [{ line: loader, path: box.rc }] }),
  });
});

test.each([
  [
    'a symbolic link',
    (box: HomeBox, real: string) => {
      symlinkSync(real, box.rc);
    },
    (box: HomeBox) => lstatSync(box.rc).isSymbolicLink(),
  ],
  [
    'a second hard link',
    (box: HomeBox, real: string) => {
      linkSync(real, box.rc);
    },
    (box: HomeBox) => lstatSync(box.rc).nlink === 2,
  ],
])(
  'installing a line into %s appends to the one file both name, keeping its inode, owner, and mode',
  (_case, arrange, stillLinked) => {
    const box = homeBox();
    const real = join(box.root, 'dotfiles-zshrc');
    writeFileSync(real, 'export A=1\n');
    chmodSync(real, 0o640);
    const before = statSync(real);
    arrange(box, real);
    installedLines(box, [{ line: loader, path: box.rc }]);
    const grown = statSync(real);
    expect(readFileSync(real, 'utf8')).toBe(`export A=1\n${loader}\n`);
    expect(readFileSync(box.rc, 'utf8')).toBe(`export A=1\n${loader}\n`);
    expect([grown.ino, grown.uid, grown.mode & 0o7777]).toEqual([before.ino, before.uid, 0o640]);
    expect(stillLinked(box)).toBe(true);
  },
);

test.each([
  [
    'a link to a missing file',
    'link',
    (box: HomeBox) => {
      symlinkSync(join(box.root, 'missing'), box.rc);
    },
  ],
  [
    'a directory',
    'directory',
    (box: HomeBox) => {
      mkdirSync(box.rc);
    },
  ],
  [
    'a link to a directory',
    'directory',
    (box: HomeBox) => {
      symlinkSync(box.skills, box.rc);
    },
  ],
  [
    'a link to a device',
    'special',
    (box: HomeBox) => {
      symlinkSync('/dev/null', box.rc);
    },
  ],
] as const)(
  'a startup file that is %s refuses the install and writes nothing',
  (_case, reason, arrange) => {
    const box = homeBox();
    arrange(box);
    expect(
      installedLines(box, [{ line: loader, path: box.rc }], {
        files: [{ content: 'test', path: box.first }],
      }),
    ).toEqual({ refused: [{ path: box.rc, reason }], status: 'refused' });
    expect(existsSync(box.record)).toBe(false);
    expect(existsSync(box.directory)).toBe(false);
    expect(existsSync(join(box.root, 'missing'))).toBe(false);
  },
);

test.each([
  ['a UTF-16LE byte order mark', [0xff, 0xfe, 0x61, 0x00]],
  ['a UTF-16BE byte order mark', [0xfe, 0xff, 0x00, 0x61]],
  ['a UTF-32LE byte order mark', [0xff, 0xfe, 0x00, 0x00, 0x61, 0x00, 0x00, 0x00]],
  ['bytes that are not UTF-8', [0x61, 0xc3, 0x28, 0x0a]],
])('a listed startup file with %s throws a TypeError and writes nothing', (_case, bytes) => {
  const box = homeBox();
  writeFileSync(box.rc, Buffer.from(bytes));
  expect(() => installedLines(box, [{ line: loader, path: box.rc }])).toThrow(
    new TypeError(`Startup file "${box.rc}" is not in an encoding the module reads.`),
  );
  expect(existsSync(box.record)).toBe(false);
  expect(readFileSync(box.rc)).toEqual(Buffer.from(bytes));
});

// Replacing and removing startup lines

test('an install listing new text replaces the recorded line where it stands, through a link, keeping its mode and encoding', () => {
  const box = homeBox();
  const real = join(box.root, 'dotfiles-zshrc');
  writeFileSync(real, 'a\r\n');
  chmodSync(real, 0o640);
  symlinkSync(real, box.rc);
  installedLines(box, [{ line: loader, path: box.rc }]);
  writeFileSync(real, `a\r\n${loader}\r\nb\r\n${loader}\r\n${loader} # mine\r\nc`);
  expect(installedLines(box, [{ line: newer, path: box.rc }])).toMatchObject({
    lines: linesOutcome({ replaced: [{ line: newer, path: box.rc }] }),
  });
  expect(readFileSync(real, 'utf8')).toBe(
    `a\r\n${newer}\r\nb\r\n${newer}\r\n${loader} # mine\r\nc`,
  );
  expect(lstatSync(box.rc).isSymbolicLink()).toBe(true);
  expect(statSync(real).mode & 0o7777).toBe(0o640);
  expect(readdirSync(box.root).filter((name) => name.endsWith('.loom-staging'))).toEqual([]);
  expect(ownerText(box)).toBe(committedLines([], [[box.rc, newer]]));
});

test('an install listing new text replaces the recorded line even where the file already holds the new one', () => {
  const box = homeBox();
  writeFileSync(box.rc, `${loader}\n`);
  installedLines(box, [{ line: loader, path: box.rc }]);
  writeFileSync(box.rc, `${loader}\n${newer}\n`);
  expect(installedLines(box, [{ line: newer, path: box.rc }])).toMatchObject({
    lines: linesOutcome({ replaced: [{ line: newer, path: box.rc }] }),
  });
  expect(readFileSync(box.rc, 'utf8')).toBe(`${newer}\n${newer}\n`);
});

test('replacing a line in a UTF-8 file with a byte order mark keeps the mark', () => {
  const box = homeBox();
  writeFileSync(box.rc, utf8WithMark(`export A=1\r\n${loader}\r\n`));
  installedLines(box, [{ line: loader, path: box.rc }]);
  installedLines(box, [{ line: newer, path: box.rc }]);
  expect(readFileSync(box.rc)).toEqual(utf8WithMark(`export A=1\r\n${newer}\r\n`));
});

test('an install with new text where the file holds neither line adds the new one, and an update adds none', () => {
  const box = homeBox();
  writeFileSync(box.rc, 'a\n');
  installedLines(box, [{ line: loader, path: box.rc }]);
  writeFileSync(box.rc, 'a\n');
  expect(installedLines(box, [{ line: newer, path: box.rc }], { update: true })).toMatchObject({
    lines: linesOutcome({ noLongerHeld: [{ line: loader, path: box.rc }] }),
  });
  expect(readFileSync(box.rc, 'utf8')).toBe('a\n');
  installedLines(box, [{ line: loader, path: box.rc }]);
  writeFileSync(box.rc, 'a\n');
  expect(installedLines(box, [{ line: newer, path: box.rc }])).toMatchObject({
    lines: linesOutcome({ added: [{ line: newer, path: box.rc }] }),
  });
  expect(readFileSync(box.rc, 'utf8')).toBe(`a\n${newer}\n`);
});

test('a recorded line the file no longer holds is added again by an install, and an update adds none and drops it', () => {
  const box = homeBox();
  writeFileSync(box.rc, 'a\n');
  installedLines(box, [{ line: loader, path: box.rc }]);
  writeFileSync(box.rc, 'a\n');
  expect(installedLines(box, [{ line: loader, path: box.rc }], { update: true })).toEqual({
    kept: [],
    lines: linesOutcome({ noLongerHeld: [{ line: loader, path: box.rc }] }),
    removed: [],
    status: 'installed',
    written: [],
  });
  expect(readFileSync(box.rc, 'utf8')).toBe('a\n');
  expect(ownerText(box)).toBe(
    `${JSON.stringify({ format: 1, state: 'committed', directories: [], files: [] })}\n`,
  );
  installedLines(box, [{ line: loader, path: box.rc }]);
  writeFileSync(box.rc, 'a\n');
  expect(installedLines(box, [{ line: loader, path: box.rc }])).toMatchObject({
    lines: linesOutcome({ added: [{ line: loader, path: box.rc }] }),
  });
  expect(readFileSync(box.rc, 'utf8')).toBe(`a\n${loader}\n`);
});

test('an update replaces a recorded line whose text changed where the file still holds it', () => {
  const box = homeBox();
  writeFileSync(box.rc, `a\n${loader}\nb\n`);
  installedLines(box, [{ line: loader, path: box.rc }]);
  expect(installedLines(box, [{ line: newer, path: box.rc }], { update: true })).toMatchObject({
    lines: linesOutcome({ replaced: [{ line: newer, path: box.rc }] }),
  });
  expect(readFileSync(box.rc, 'utf8')).toBe(`a\n${newer}\nb\n`);
});

test('an install that no longer lists a recorded line removes it, and moves it to the startup file it lists', () => {
  const box = homeBox();
  const profile = join(box.home, '.bash_profile');
  writeFileSync(box.rc, `a\n${loader}\nb\n`);
  installedLines(box, [{ line: loader, path: box.rc }]);
  expect(installedLines(box, [{ line: loader, path: profile }])).toMatchObject({
    lines: linesOutcome({
      added: [{ line: loader, path: profile }],
      removed: [{ line: loader, path: box.rc }],
    }),
  });
  expect(readFileSync(box.rc, 'utf8')).toBe('a\nb\n');
  expect(readFileSync(profile, 'utf8')).toBe(`${loader}\n`);
  expect(ownerText(box)).toBe(committedLines([], [[profile, loader]]));
});

test('uninstall removes every line equal to the recorded text and keeps every other byte and the file', () => {
  const box = homeBox();
  writeFileSync(box.rc, '# top\r\n');
  installedLines(box, [{ line: loader, path: box.rc }]);
  writeFileSync(
    box.rc,
    `# top\r\n${loader}\r\nmiddle\r\n\r\n${loader}\r\n ${loader}\r\n${loader} # mine\r\n${loader}`,
  );
  expect(uninstalledLines(box)).toEqual({
    kept: [],
    lines: { noLongerHeld: [], released: [], removed: [{ line: loader, path: box.rc }] },
    removed: [],
    status: 'uninstalled',
  });
  expect(readFileSync(box.rc, 'utf8')).toBe(
    `# top\r\nmiddle\r\n\r\n ${loader}\r\n${loader} # mine\r\n`,
  );
  expect(existsSync(box.owner)).toBe(false);
});

test('uninstall reports a startup file that no longer holds the line, never removes a file it created, and keeps its parent', () => {
  const box = homeBox();
  const rc = join(box.home, 'zdot', '.zshrc');
  installedLines(box, [{ line: loader, path: rc }]);
  writeFileSync(rc, 'mine\n');
  expect(uninstalledLines(box)).toEqual({
    kept: [],
    lines: { noLongerHeld: [{ line: loader, path: rc }], released: [], removed: [] },
    removed: [],
    status: 'uninstalled',
  });
  expect(readFileSync(rc, 'utf8')).toBe('mine\n');
  installedLines(box, [{ line: loader, path: rc }]);
  uninstalledLines(box);
  expect(readFileSync(rc, 'utf8')).toBe('mine\n');
});

test('an uninstall of a startup file that is gone reports the line no longer held', () => {
  const box = homeBox();
  installedLines(box, [{ line: loader, path: box.rc }]);
  rmSync(box.rc);
  expect(uninstalledLines(box)).toMatchObject({
    lines: { noLongerHeld: [{ line: loader, path: box.rc }], released: [], removed: [] },
  });
  expect(existsSync(box.rc)).toBe(false);
});

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'a released line is dropped from the plugin file and its startup file is neither read nor written, by an install or an uninstall',
  () => {
    const box = homeBox();
    const text = `a\n${loader}\n`;
    writeFileSync(box.rc, text);
    installedLines(box, [{ line: loader, path: box.rc }]);
    // A file no one may read throws on any read, so an outcome proves the module read none.
    chmodSync(box.rc, 0o000);
    const before = statSync(box.rc).mtimeMs;
    try {
      expect(installedLines(box, [], { release: [box.rc] })).toEqual({
        kept: [],
        lines: linesOutcome({ released: [{ line: loader, path: box.rc }] }),
        removed: [],
        status: 'installed',
        written: [],
      });
      expect(ownerText(box)).toBe(
        `${JSON.stringify({ format: 1, state: 'committed', directories: [], files: [] })}\n`,
      );
      chmodSync(box.rc, 0o644);
      installedLines(box, [{ line: loader, path: box.rc }]);
      chmodSync(box.rc, 0o000);
      expect(uninstalledLines(box, [box.rc])).toEqual({
        kept: [],
        lines: { noLongerHeld: [], released: [{ line: loader, path: box.rc }], removed: [] },
        removed: [],
        status: 'uninstalled',
      });
      expect(statSync(box.rc).mtimeMs).toBe(before);
    } finally {
      chmodSync(box.rc, 0o644);
    }
    expect(readFileSync(box.rc, 'utf8')).toBe(text);
    expect(existsSync(box.owner)).toBe(false);
  },
);

test('an uninstall of a recorded startup file in an encoding the module does not read throws a TypeError and changes nothing', () => {
  const box = homeBox();
  installedLines(box, [{ line: loader, path: box.rc }]);
  const before = ownerText(box);
  writeFileSync(box.rc, Buffer.from([0xfe, 0xff, 0x00, 0x61]));
  expect(() => uninstalledLines(box)).toThrow(
    new TypeError(`Startup file "${box.rc}" is not in an encoding the module reads.`),
  );
  expect(ownerText(box)).toBe(before);
});

// Reading startup lines

test('reading a plugin file returns its recorded startup lines, and a pending one what its files hold', () => {
  const box = homeBox();
  const profile = join(box.home, '.profile');
  expect(read(box)).toEqual({ files: [], status: 'read' });
  installedLines(box, [{ line: loader, path: box.rc }]);
  expect(read(box)).toEqual({ files: [], lines: [{ line: loader, path: box.rc }], status: 'read' });
  writeFileSync(box.rc, `${newer}\n`);
  writeFileSync(profile, `${loader}\n`);
  mkdirSync(box.record, { recursive: true });
  writeFileSync(
    box.owner,
    `${JSON.stringify({
      format: 1,
      state: 'pending',
      directories: [],
      files: [],
      lines: [
        { path: box.rc, prior: loader, intended: newer },
        { path: profile, prior: loader, intended: null },
        { path: join(box.home, '.bashrc'), prior: null, intended: loader },
      ],
    })}\n`,
  );
  const before = ownerText(box);
  expect(read(box)).toEqual({
    files: [],
    lines: [
      { line: newer, path: box.rc },
      { line: loader, path: profile },
    ],
    status: 'read',
  });
  expect(ownerText(box)).toBe(before);
});

test.each([
  ['a line with a line break', { path: '/home/me/.zshrc', line: 'a\nb' }],
  ['an empty line', { path: '/home/me/.zshrc', line: '' }],
  ['a relative path', { path: '.zshrc', line: 'a' }],
  ['no text', { path: '/home/me/.zshrc' }],
])('a plugin file whose startup line is %s is damaged', (_case, entry) => {
  const box = homeBox();
  mkdirSync(box.record);
  const text = `${JSON.stringify({ format: 1, state: 'committed', directories: [], files: [], lines: [entry] })}\n`;
  writeFileSync(box.owner, text);
  expect(read(box)).toEqual({ refused: { path: box.owner, reason: 'damaged' }, status: 'refused' });
  expect(installedLines(box, [])).toEqual({
    refused: [{ path: box.owner, reason: 'damaged' }],
    status: 'refused',
  });
});

test('reading a startup file tells whether it is there, a file, in an encoding the module reads, and holding the line', () => {
  const box = homeBox();
  expect(inspectStartupFile(box.rc, loader)).toEqual({ kind: 'absent' });
  symlinkSync(join(box.root, 'missing'), box.rc);
  expect(inspectStartupFile(box.rc, loader)).toEqual({ kind: 'not-file' });
  rmSync(box.rc);
  mkdirSync(box.rc);
  expect(inspectStartupFile(box.rc, loader)).toEqual({ kind: 'not-file' });
  rmSync(box.rc, { recursive: true });
  writeFileSync(box.rc, Buffer.from([0xfe, 0xff, 0x00, 0x61]));
  expect(inspectStartupFile(box.rc, loader)).toEqual({ kind: 'unknown-encoding' });
  writeFileSync(box.rc, `a\n${loader}\r\n`);
  expect(inspectStartupFile(box.rc, loader)).toEqual({
    encoding: 'utf8',
    holds: true,
    kind: 'text',
  });
  writeFileSync(box.rc, utf8WithMark('a\n'));
  expect(inspectStartupFile(box.rc, loader)).toEqual({
    encoding: 'utf8-bom',
    holds: false,
    kind: 'text',
  });
  writeFileSync(box.rc, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(loader, 'utf16le')]));
  expect(inspectStartupFile(box.rc, loader)).toEqual({ kind: 'unknown-encoding' });
});

// Startup lines from a process that stopped

/** The text a pending plugin's file records for the startup file `.zshrc`, read as recovery would. */
function recordedLines(box: Box) {
  const recorded = read(box);
  return recorded.status === 'read' ? (recorded.lines ?? []) : recorded;
}

test('a process killed after a first line is appended and before the commit leaves a pending file whose next run records the line', () => {
  const box = homeBox();
  writeFileSync(box.rc, 'a\n');
  const killed = inProcess({
    files: [],
    killAfterAppend: box.rc,
    lines: [{ line: loader, path: box.rc }],
    record: box.record,
  });
  expect(killed).toMatchObject({ status: null, stdout: '' });
  expect(JSON.parse(ownerText(box))).toMatchObject({
    lines: [{ intended: loader, path: box.rc, prior: null }],
    state: 'pending',
  });
  expect(readFileSync(box.rc, 'utf8')).toBe(`a\n${loader}\n`);
  expect(uninstalledLines(box)).toMatchObject({
    lines: { removed: [{ line: loader, path: box.rc }] },
  });
  expect(readFileSync(box.rc, 'utf8')).toBe('a\n');
});

test('a process killed before the append leaves a pending file whose next run records no line', () => {
  const box = homeBox();
  writeFileSync(box.rc, 'a\n');
  const killed = inProcess({
    files: [],
    killBeforeAppend: box.rc,
    lines: [{ line: loader, path: box.rc }],
    record: box.record,
  });
  expect(killed).toMatchObject({ status: null, stdout: '' });
  expect(JSON.parse(ownerText(box))).toMatchObject({ state: 'pending' });
  expect(uninstalledLines(box)).toEqual({ kept: [], removed: [], status: 'uninstalled' });
  expect(readFileSync(box.rc, 'utf8')).toBe('a\n');
});

test.each([
  ['before', 'killBeforeRename', loader],
  ['after', 'killAfterRename', newer],
])(
  'a process killed %s the rename that replaces a line leaves a pending file whose next run records the line the file holds',
  (_when, trap, kept) => {
    const box = homeBox();
    writeFileSync(box.rc, `a\n${loader}\nb\n`);
    installedLines(box, [{ line: loader, path: box.rc }]);
    const killed = inProcess({
      files: [],
      [trap]: realpathSync(box.rc),
      lines: [{ line: newer, path: box.rc }],
      record: box.record,
    });
    expect(killed).toMatchObject({ status: null, stdout: '' });
    expect(JSON.parse(ownerText(box))).toMatchObject({
      lines: [{ intended: newer, path: box.rc, prior: loader }],
      state: 'pending',
    });
    expect(recordedLines(box)).toEqual([{ line: kept, path: box.rc }]);
    expect(uninstalledLines(box)).toMatchObject({
      lines: { removed: [{ line: kept, path: box.rc }] },
    });
    expect(readFileSync(box.rc, 'utf8')).toBe('a\nb\n');
    expect(readdirSync(box.home)).toEqual(['.zshrc']);
  },
);

test('two installs appending different lines to one startup file at once leave both', async () => {
  const box = homeBox();
  writeFileSync(box.rc, '# mine\n');
  const count = 12;
  const lines = Array.from({ length: count }, (_entry, index) => `${loader} ${index}`);
  const children = lines.map((line, index) =>
    start(fixture, [
      JSON.stringify({
        files: [],
        lines: [{ line, path: box.rc }],
        plugin: `completion${index}`,
        record: box.record,
      }),
    ]),
  );
  const completions = await Promise.all(children.map(({ exit }) => exit));
  expect(completions.map(({ status }) => status)).toEqual(lines.map(() => 0));
  const held = readFileSync(box.rc, 'utf8').split('\n');
  expect(held[0]).toBe('# mine');
  expect(held.slice(1, -1).toSorted()).toEqual(lines.toSorted());
}, 60_000);

test('a run whose missing startup file another run creates first appends its line after the other’s', () => {
  const box = homeBox();
  const other = `${loader} other`;
  const result = inProcess({
    createBeforeCreate: { content: `${other}\n`, path: box.rc },
    files: [],
    lines: [{ line: loader, path: box.rc }],
    record: box.record,
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    lines: { added: [{ line: loader, path: box.rc }] },
    status: 'installed',
  });
  expect(readFileSync(box.rc, 'utf8')).toBe(`${other}\n${loader}\n`);
  expect(recordedLines(box)).toEqual([{ line: loader, path: box.rc }]);
});

test('a run whose missing startup file another run creates first with the same line leaves the line there once', () => {
  const box = homeBox();
  const result = inProcess({
    createBeforeCreate: { content: `${loader}\n`, path: box.rc },
    files: [],
    lines: [{ line: loader, path: box.rc }],
    record: box.record,
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    lines: { added: [{ line: loader, path: box.rc }] },
    status: 'installed',
  });
  expect(readFileSync(box.rc, 'utf8')).toBe(`${loader}\n`);
  expect(recordedLines(box)).toEqual([{ line: loader, path: box.rc }]);
});

test('a process killed before the rename that removes a line leaves a pending file whose next run records the line the file still holds', () => {
  const box = homeBox();
  writeFileSync(box.rc, `a\n${loader}\n`);
  installedLines(box, [{ line: loader, path: box.rc }]);
  const killed = inProcess({
    files: [],
    killBeforeRename: realpathSync(box.rc),
    record: box.record,
  });
  expect(killed).toMatchObject({ status: null, stdout: '' });
  expect(readFileSync(box.rc, 'utf8')).toBe(`a\n${loader}\n`);
  expect(recordedLines(box)).toEqual([{ line: loader, path: box.rc }]);
});

test('a process killed while it records a line the file already held leaves a pending file whose next run records the line', () => {
  const box = homeBox();
  writeFileSync(box.rc, `a\n${loader}\n`);
  const killed = inProcess({
    files: [{ content: 'test', path: box.first }],
    killAfterRename: box.first,
    lines: [{ line: loader, path: box.rc }],
    record: box.record,
  });
  expect(killed).toMatchObject({ status: null, stdout: '' });
  expect(JSON.parse(ownerText(box))).toMatchObject({ state: 'pending' });
  expect(recordedLines(box)).toEqual([{ line: loader, path: box.rc }]);
});

test('a process killed before it creates a startup file leaves a pending file whose next run records no line', () => {
  const box = homeBox();
  const rc = join(box.home, 'zdot', '.zshrc');
  const killed = inProcess({
    files: [],
    killBeforeMkdir: dirname(rc),
    lines: [{ line: loader, path: rc }],
    record: box.record,
  });
  expect(killed).toMatchObject({ status: null, stdout: '' });
  expect(JSON.parse(ownerText(box))).toMatchObject({ state: 'pending' });
  expect(uninstalledLines(box)).toEqual({ kept: [], removed: [], status: 'uninstalled' });
  expect(existsSync(rc)).toBe(false);
  expect(existsSync(box.owner)).toBe(false);
});

test('recovery removes the leftover staging files beside a linked startup file’s real file', () => {
  const box = homeBox();
  const dotfiles = join(box.root, 'dotfiles');
  mkdirSync(dotfiles);
  const real = join(dotfiles, 'zshrc');
  writeFileSync(real, `a\n${loader}\n`);
  symlinkSync(real, box.rc);
  mkdirSync(box.record, { recursive: true });
  writeFileSync(
    box.owner,
    `${JSON.stringify({
      directories: [],
      files: [],
      format: 1,
      lines: [{ intended: newer, path: box.rc, prior: loader }],
      state: 'pending',
    })}\n`,
  );
  // A rewrite stages beside the real file, which the link names, so its leftover sits there.
  writeFileSync(join(dotfiles, '.zshrc.0123456789abcdef.loom-staging'), 'partial');
  expect(uninstalledLines(box)).toMatchObject({ status: 'uninstalled' });
  expect(readdirSync(dotfiles)).toEqual(['zshrc']);
});
