/*
 * The mapping from a system error's code to the failure the installed-files module raises for a
 * path it cannot reach, and the reads that use it. Each case pins the sentence and the values the
 * failure carries; installation-write-errors.test.ts pins the rendered text. A run cannot force `EPERM`, `EROFS`, or a write
 * that meets `EEXIST` or `ENOTDIR` after the reads before it passed, so these cases hand the
 * mapping fabricated errors that carry each code. installation-write-errors.test.ts runs the
 * plugins over real folders.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FatalError } from '@loomcli/core';
import type { Log } from '@loomcli/core';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { entriesOf, removeEmptyDirectory } from '../src/installation/disk.js';
import { install } from '../src/installation/files.js';
import { staleFiles } from '../src/installation/folders.js';
import { installationPhrase } from '../src/installation/phrases.js';
import { reading, writing } from '../src/installation/reach.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox folder that holds a regular file named `file`. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-installation-reach-'));
  roots.push(root);
  const file = join(root, 'file');
  writeFileSync(file, '');
  return { file, root };
}

const path = '/home/ada/.config/systemd/user/notes.service';

/** The failure that says a file sits where one of the folders of `at` is needed. */
const blocked = (at: string) => new FatalError(installationPhrase('pathBlocked', at));

/** A function that throws a system error carrying `code`, as the runtime's calls do. */
const failing = (code: string) => () => {
  throw Object.assign(new Error('fabricated'), { code });
};

describe('writing', () => {
  it.each(['ENOTDIR', 'EEXIST'])('says a file sits in the way for %s', (code) => {
    expect(() => writing(path, failing(code))).toThrow(blocked(path));
  });

  it.each(['EACCES', 'EPERM'])('says the location cannot be written for %s', (code) => {
    expect(() => writing(path, failing(code))).toThrow(
      new FatalError(installationPhrase('writeUnwritable', path, false)),
    );
  });

  it('says the file system is read-only for EROFS', () => {
    expect(() => writing(path, failing('EROFS'))).toThrow(
      new FatalError(installationPhrase('writeUnwritable', path, true)),
    );
  });

  it('passes any other error through as it was thrown', () => {
    const error = Object.assign(new Error('fabricated'), { code: 'EIO' });
    expect(() =>
      writing(path, () => {
        throw error;
      }),
    ).toThrow(error);
  });

  it('answers what the write answers', () => {
    expect(writing(path, () => 'written')).toBe('written');
  });
});

describe('reading', () => {
  it('says a file sits in the way for ENOTDIR', () => {
    expect(() => reading(path, failing('ENOTDIR'))).toThrow(blocked(path));
  });

  it.each(['EACCES', 'EPERM'])('says the path cannot be reached or read for %s', (code) => {
    expect(() => reading(path, failing(code))).toThrow(
      new FatalError(installationPhrase('readUnreadable', path)),
    );
  });

  it.each(['ENOENT', 'EEXIST', 'EROFS'])('passes %s through as it was thrown', (code) => {
    expect(() => reading(path, failing(code))).toThrow(expect.objectContaining({ code }));
  });
});

describe('the reads below a file', () => {
  it('entriesOf fails for a file at the folder and below it, and lists a missing one as empty', () => {
    const { file, root } = sandbox();

    expect(() => entriesOf(file)).toThrow(blocked(file));
    expect(() => entriesOf(join(file, 'inner'))).toThrow(blocked(join(file, 'inner')));
    expect(entriesOf(join(root, 'missing'))).toEqual([]);
  });

  it('removeEmptyDirectory fails below a file and leaves a missing folder alone', () => {
    const { file, root } = sandbox();

    expect(() => {
      removeEmptyDirectory(join(file, 'inner'));
    }).toThrow(blocked(join(file, 'inner')));
    expect(() => {
      removeEmptyDirectory(join(root, 'missing'));
    }).not.toThrow();
  });

  it('staleFiles fails for a folder below a file', () => {
    const { file, root } = sandbox();
    mkdirSync(join(root, 'folder'));
    const files = [{ content: '# Notes\n', path: 'SKILL.md' }];

    expect(() => staleFiles(join(file, 'notes'), files)).toThrow(blocked(join(file, 'notes')));
    expect(staleFiles(join(root, 'folder'), files)).toEqual(['SKILL.md']);
  });
});

const log: Log = { debug() {}, error() {}, info() {}, trace() {}, warn() {}, with: () => log };

/**
 * A record that names the given folders or directories, which the tests place below a file in a
 * separate sandbox, and an install of one file in a folder of its own, so only the read of the
 * record's own paths reaches the blocked path.
 */
function recordUnderFile(entries: { directories?: string[]; folders?: { path: string }[] }) {
  const { root } = sandbox();
  const record = join(root, 'record');
  mkdirSync(record);
  const recordPath = join(record, 'skill.json');
  const bytes = `${JSON.stringify({ directories: [], files: [], folders: [], format: 2, state: 'committed', ...entries })}\n`;
  writeFileSync(recordPath, bytes);
  const target = join(root, 'target', 'notes.md');
  const run = () =>
    install({
      files: [{ content: '# Notes\n', path: target }],
      log,
      plugin: 'skill',
      record,
      signal: new AbortController().signal,
    });
  return { bytes, recordPath, run, target };
}

describe('the paths a record names', () => {
  it('fails on a recorded folder below a file before it changes anything', () => {
    const { file } = sandbox();
    const folder = join(file, 'notes');
    const box = recordUnderFile({ folders: [{ path: folder }] });

    expect(box.run).toThrow(blocked(folder));
    expect(readFileSync(box.recordPath, 'utf8')).toBe(box.bytes);
    expect(existsSync(box.target)).toBe(false);
  });

  it('fails on a recorded directory below a file before it changes anything', () => {
    const { file } = sandbox();
    const directory = join(file, 'created');
    const box = recordUnderFile({ directories: [directory] });

    expect(box.run).toThrow(blocked(directory));
    expect(readFileSync(box.recordPath, 'utf8')).toBe(box.bytes);
    expect(existsSync(box.target)).toBe(false);
  });
});
