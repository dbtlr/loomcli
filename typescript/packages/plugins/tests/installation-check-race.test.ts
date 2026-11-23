/*
 * The checks a folder install makes before it writes, when another run takes a folder they check at
 * a point no step of the other run can reach from outside: between the listing that finds a
 * leftover staging or retired folder, or a directory inside a folder, and the check of that path,
 * inside the listing of a directory, or between the plan and the check of a folder the install
 * writes in. This file stands in for the other run at that point by hooking `accessSync` or
 * `readdirSync` once, and the install under test then finishes, or fails before it changes
 * anything. A missing path is a link to a folder that is gone only when `hasDanglingLink` finds
 * one, which the last cases pin.
 */
import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import type { PathLike } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { FatalError } from '@loomcli/core';
import type { Log } from '@loomcli/core';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { hasDanglingLink } from '../src/installation/disk.js';
import { install } from '../src/installation/files.js';
import { installationPhrase } from '../src/installation/phrases.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<{
    accessSync: typeof accessSync;
    readdirSync: typeof readdirSync;
  }>();
  return {
    ...actual,
    accessSync: vi.fn(actual.accessSync),
    readdirSync: vi.fn(actual.readdirSync),
  };
});

const roots: string[] = [];

afterEach(() => {
  vi.mocked(accessSync).mockReset();
  vi.mocked(readdirSync).mockReset();
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox folder for one case. */
function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'loom-installation-check-race-'));
  roots.push(root);
  return root;
}

const log: Log = { debug() {}, error() {}, info() {}, trace() {}, warn() {}, with: () => log };

/** An install of the folder `skills/notes` under `root`, recorded under `root/record`. */
function installNotes(root: string, content: string) {
  return install({
    files: [],
    folders: [
      {
        files: [
          { content, path: 'SKILL.md' },
          { content, path: join('references', 'guide.md') },
        ],
        path: join(root, 'skills', 'notes'),
      },
    ],
    log,
    plugin: 'skills',
    record: join(root, 'record'),
    signal: new AbortController().signal,
  });
}

/** A leftover staging folder beside `skills/notes`, with a `references` directory inside it. */
function leftoverOf(root: string): string {
  const leftover = join(root, 'skills', '.notes.0123456789abcdef.loom-staging');
  mkdirSync(join(leftover, 'references'), { recursive: true });
  writeFileSync(join(leftover, 'references', 'left.md'), 'Left by a stopped run.\n');
  return leftover;
}

/**
 * Has the next `accessSync` of `path` find it taken by another run, which removes it just before
 * the check reaches it.
 */
function takenBeforeAccess(path: string): void {
  const actual = vi.mocked(accessSync).getMockImplementation();
  vi.mocked(accessSync).mockImplementation((at: PathLike, mode?: number) => {
    if (at === path) {
      rmSync(path, { force: true, recursive: true });
    }
    actual?.(at, mode);
  });
}

/** What the install wrote at `skills/notes/SKILL.md`. */
const skillOf = (root: string) => readFileSync(join(root, 'skills', 'notes', 'SKILL.md'), 'utf8');

describe('a leftover another run takes while the install checks it', () => {
  it('passes over a leftover that is gone when the check reaches it', () => {
    const root = sandbox();
    const leftover = leftoverOf(root);
    takenBeforeAccess(leftover);

    expect(installNotes(root, '# Notes\n')).toMatchObject({ status: 'installed' });
    expect(skillOf(root)).toBe('# Notes\n');
    expect(readdirSync(join(root, 'skills'))).toEqual(['notes']);
  });

  it('passes over a directory inside a leftover that is gone when the check reaches it', () => {
    const root = sandbox();
    const leftover = leftoverOf(root);
    takenBeforeAccess(join(leftover, 'references'));

    expect(installNotes(root, '# Notes\n')).toMatchObject({ status: 'installed' });
    expect(skillOf(root)).toBe('# Notes\n');
    expect(readdirSync(join(root, 'skills'))).toEqual(['notes']);
  });

  it('passes over a leftover that is gone between its check and its listing', () => {
    const root = sandbox();
    const leftover = leftoverOf(root);
    const actual = vi.mocked(readdirSync).getMockImplementation();
    vi.mocked(readdirSync).mockImplementation((...args: Parameters<typeof readdirSync>) => {
      if (args[0] === leftover) {
        rmSync(leftover, { force: true, recursive: true });
      }
      return actual === undefined ? [] : actual(...args);
    });

    expect(installNotes(root, '# Notes\n')).toMatchObject({ status: 'installed' });
    expect(skillOf(root)).toBe('# Notes\n');
  });
});

describe('a folder another run changes while the install checks it', () => {
  it('passes over a directory inside the folder it replaces that is gone when the check reaches it', () => {
    const root = sandbox();
    expect(installNotes(root, '# Notes\n')).toMatchObject({ status: 'installed' });
    takenBeforeAccess(join(root, 'skills', 'notes', 'references'));

    expect(installNotes(root, '# Notes, second version\n')).toMatchObject({
      status: 'installed',
    });
    expect(skillOf(root)).toBe('# Notes, second version\n');
  });
});

const isRoot = process.getuid?.() === 0;

/** Every path below `root` with a file's content, so a failed run is seen to change nothing. */
function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { encoding: 'utf8', recursive: true })
      .toSorted()
      .map((path) => {
        const at = join(root, path);
        return [path, lstatSync(at).isFile() ? readFileSync(at, 'utf8') : 'folder'];
      }),
  );
}

/**
 * Has the walk's listing of `directory` find `vanishing` taken by another run as it reads it: the
 * names come back with it, and the runtime then finds it gone when it reads each entry's type
 * itself, as it does on a file system that reports no entry types, so a listing that asks for types
 * fails with the missing path.
 */
function vanishesAsListed(directory: string, vanishing: string): void {
  const access = vi.mocked(accessSync).getMockImplementation();
  const list = vi.mocked(readdirSync).getMockImplementation();
  let armed = false;
  vi.mocked(accessSync).mockImplementation((at: PathLike, mode?: number) => {
    armed ||= at === directory && mode === (constants.W_OK | constants.X_OK);
    access?.(at, mode);
  });
  vi.mocked(readdirSync).mockImplementation((...args: Parameters<typeof readdirSync>) => {
    if (!armed || args[0] !== directory) {
      return list === undefined ? [] : list(...args);
    }
    armed = false;
    const listed = list === undefined ? [] : list(...args);
    rmSync(vanishing, { force: true, recursive: true });
    const [, options] = args;
    if (typeof options === 'object' && options?.withFileTypes) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${vanishing}'`), {
        code: 'ENOENT',
      });
    }
    return listed;
  });
}

/** Makes every folder named `locked` below `root` writable again, wherever a run moved it. */
function unlockAll(root: string): void {
  for (const path of readdirSync(root, { encoding: 'utf8', recursive: true })) {
    if (basename(path) === 'locked') {
      chmodSync(join(root, path), 0o755);
    }
  }
}

describe('a folder another run changes while the install checks it, read further', () => {
  it.skipIf(isRoot)(
    'passes over a directory that vanishes as the walk lists it and still names a sibling it may not search',
    () => {
      const root = sandbox();
      expect(installNotes(root, '# Notes\n')).toMatchObject({ status: 'installed' });
      const folder = join(root, 'skills', 'notes');
      const vanishing = join(folder, 'vanishing');
      const locked = join(folder, 'locked');
      mkdirSync(vanishing);
      mkdirSync(locked);
      writeFileSync(join(locked, 'mine.md'), 'Written by the operator.\n');
      const before = snapshot(root);
      vanishesAsListed(folder, vanishing);

      chmodSync(locked, 0o500);
      try {
        expect(() => installNotes(root, '# Notes, second version\n')).toThrow(
          new FatalError(installationPhrase('writeUnwritable', locked, false)),
        );
      } finally {
        unlockAll(root);
      }
      expect(snapshot(root)).toEqual(
        Object.fromEntries(
          Object.entries(before).filter(([path]) => path !== join('skills', 'notes', 'vanishing')),
        ),
      );
      expect(skillOf(root)).toBe('# Notes\n');
    },
  );

  it('fails naming a folder it writes in that another run took away between planning and its check, and changes nothing', () => {
    const root = sandbox();
    expect(installNotes(root, '# Notes\n')).toMatchObject({ status: 'installed' });
    const skills = join(root, 'skills');
    const before = snapshot(root);
    const actual = vi.mocked(accessSync).getMockImplementation();
    vi.mocked(accessSync).mockImplementation((at: PathLike, mode?: number) => {
      if (at === skills) {
        renameSync(skills, join(root, 'moved'));
      }
      actual?.(at, mode);
    });

    expect(() => installNotes(root, '# Notes, second version\n')).toThrow(
      new FatalError(installationPhrase('folderChangedMeanwhile', join(skills, 'notes'))),
    );
    expect(snapshot(root)).toEqual(
      Object.fromEntries(
        Object.entries(before).map(([path, held]) => [path.replace(/^skills/u, 'moved'), held]),
      ),
    );
    expect(readFileSync(join(root, 'moved', 'notes', 'SKILL.md'), 'utf8')).toBe('# Notes\n');
  });
});

describe('hasDanglingLink', () => {
  it('finds no link on a missing path below folders that exist', () => {
    const root = sandbox();

    expect(hasDanglingLink(join(root, 'gone'))).toBe(false);
    expect(hasDanglingLink(join(root, 'gone', 'deeper', 'still'))).toBe(false);
  });

  it('finds no link on a missing path below a link to a folder that exists', () => {
    const root = sandbox();
    mkdirSync(join(root, 'real'));
    symlinkSync(join(root, 'real'), join(root, 'link'));

    expect(hasDanglingLink(join(root, 'link', 'gone'))).toBe(false);
  });

  it('finds a link to a folder that does not exist at the path or any folder of it', () => {
    const root = sandbox();
    symlinkSync(join(root, 'nowhere'), join(root, 'link'));

    expect(hasDanglingLink(join(root, 'link'))).toBe(true);
    expect(hasDanglingLink(join(root, 'link', 'notes'))).toBe(true);
    expect(hasDanglingLink(join(root, 'link', 'notes', 'SKILL.md'))).toBe(true);
  });

  it('finds a relative link, and a chain of links that ends in a folder that does not exist', () => {
    const root = sandbox();
    symlinkSync('nowhere', join(root, 'relative'));
    symlinkSync(join(root, 'relative'), join(root, 'chain'));
    mkdirSync(join(root, 'real'));
    symlinkSync(join(root, 'real'), join(root, 'through'));
    symlinkSync('../nowhere', join(root, 'real', 'inner'));

    expect(hasDanglingLink(join(root, 'relative', 'notes'))).toBe(true);
    expect(hasDanglingLink(join(root, 'chain', 'notes'))).toBe(true);
    expect(hasDanglingLink(join(root, 'through', 'inner', 'notes'))).toBe(true);
  });
});
