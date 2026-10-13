import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as after } from 'node:timers/promises';

import { afterEach, expect, test } from 'vite-plus/test';

import { invoke, start } from '../../../scripts/test-process.js';
import { replaceFile } from '../src/installation/disk.js';
import { install, readRecorded, targetRefusals, uninstall } from '../src/installation/files.js';
import type { InstalledFile } from '../src/installation/files.js';

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
