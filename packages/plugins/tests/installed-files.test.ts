import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
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
  install,
  readRecorded,
  folderRefusals,
  targetRefusals,
  uninstall,
} from '../src/installation/files.js';
import type { InstalledFile, InstalledFolder } from '../src/installation/files.js';
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

test.each([
  ['not absolute', (_box: Box) => ['notes/SKILL.md'], 'is not absolute'],
  ['not normalized', (box: Box) => [`${box.skills}/x/../notes/SKILL.md`], 'is not normalized'],
  ['ending in a separator', (box: Box) => [`${box.directory}/`], 'is not normalized'],
  ['listed twice', (box: Box) => [box.first, box.first], 'is listed twice'],
])(
  'a target path %s throws a TypeError before the module reads or writes',
  (_case, paths, rule) => {
    const box = sandbox();
    installed(box, [{ content: 'test', path: box.second }]);
    const before = ownerText(box);
    const [path = ''] = paths(box).slice(-1);
    const files = paths(box).map((target) => ({ content: 'new', path: target }));
    expect(() => installed(box, files)).toThrow(
      new TypeError(`Installed file path "${path}" ${rule}.`),
    );
    expect(ownerText(box)).toBe(before);
    expect(readdirSync(box.directory)).toEqual(['reference.md']);
    expect(readdirSync(box.record)).toEqual(['skill.json']);
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

// Folder paths a first-party plugin got wrong

test.each([
  ['not absolute', () => 'notes', 'is not absolute'],
  ['not normalized', (box: Box) => `${box.skills}/x/../notes`, 'is not normalized'],
  ['listed as a file too', (box: Box) => box.first, 'is listed twice'],
])(
  'a folder path that is %s throws a TypeError before anything is written',
  (_name, path, fault) => {
    const box = sandbox();
    expect(() =>
      installedFolders(box, [folderOf(path(box), { 'a.md': 'abc' })], {
        files: [{ content: 'test', path: box.first }],
      }),
    ).toThrow(new TypeError(`Installed folder path "${path(box)}" ${fault}.`));
    expect(existsSync(box.record)).toBe(false);
  },
);

test.each(['/etc/passwd', '../escape.md', 'a/../../escape.md', 'a//b.md', './a.md', '', 'a/'])(
  'a folder file path "%s" that is not relative and normalized throws a TypeError',
  (name) => {
    const box = sandbox();
    expect(() => installedFolders(box, [folderOf(box.directory, { [name]: 'abc' })])).toThrow(
      TypeError,
    );
    expect(existsSync(box.record)).toBe(false);
  },
);

test('a folder file listed twice throws a TypeError', () => {
  const box = sandbox();
  const folder = {
    files: [
      { content: 'a', path: 'a.md' },
      { content: 'b', path: 'a.md' },
    ],
    path: box.directory,
  };
  expect(() => installedFolders(box, [folder])).toThrow(TypeError);
});
