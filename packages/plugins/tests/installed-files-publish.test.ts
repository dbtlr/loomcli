import {
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import { publishFile } from '../src/installation/disk.js';

// A file system that refuses hard links cannot be mounted from a test.
// This file stands in for one: its link call fails the way such a mount answers.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<{ linkSync: typeof linkSync }>();
  return { ...actual, linkSync: vi.fn(actual.linkSync) };
});

const directories: string[] = [];

afterEach(() => {
  vi.mocked(linkSync).mockReset();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** A fresh folder the test removes afterwards. */
function folder(): string {
  const directory = mkdtempSync(join(tmpdir(), 'loom-publish-'));
  directories.push(directory);
  return directory;
}

/** A link call that fails with `code`, as a file system without hard links answers. */
function refuseLinks(code: string): void {
  vi.mocked(linkSync).mockImplementation(() => {
    throw Object.assign(new Error(`${code}: link refused`), { code });
  });
}

test.each(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'])(
  'a file system that refuses hard links with %s still gets the new file, whole and alone',
  (code) => {
    const directory = folder();
    const path = join(directory, '.zshrc');
    refuseLinks(code);
    expect(publishFile(path, new TextEncoder().encode('line\n'), { mode: 0o644 })).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('line\n');
    expect(statSync(path).mode & 0o777).toBe(0o644);
    expect(readdirSync(directory)).toEqual(['.zshrc']);
  },
);

test('a file system that refuses hard links leaves a file another run created first as it is', () => {
  const directory = folder();
  const path = join(directory, '.zshrc');
  writeFileSync(path, 'theirs\n');
  refuseLinks('EPERM');
  expect(publishFile(path, new TextEncoder().encode('ours\n'))).toBe(false);
  expect(readFileSync(path, 'utf8')).toBe('theirs\n');
  expect(readdirSync(directory)).toEqual(['.zshrc']);
});

test('a link that fails for another reason still throws', () => {
  const directory = folder();
  refuseLinks('EIO');
  expect(() => publishFile(join(directory, '.zshrc'), new TextEncoder().encode('line\n'))).toThrow(
    'EIO',
  );
  expect(readdirSync(directory)).toEqual([]);
});
