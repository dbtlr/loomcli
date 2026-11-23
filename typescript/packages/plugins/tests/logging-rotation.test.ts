// Acceptance plan: see packages/plugins/tests/logging.test.ts.

import {
  existsSync,
  statSync,
  unlinkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import { writeRecord } from '../src/logging/file.js';

// The rename that loses a race cannot be forced from outside a process.
// This file stands in for the other process: it runs the real rename.
// The plugin's own rename then finds nothing to move.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<{
    renameSync: typeof renameSync;
    statSync: typeof statSync;
    unlinkSync: typeof unlinkSync;
  }>();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    statSync: vi.fn(actual.statSync),
    unlinkSync: vi.fn(actual.unlinkSync),
  };
});

const directories: string[] = [];

afterEach(() => {
  vi.mocked(renameSync).mockReset();
  vi.mocked(statSync).mockReset();
  vi.mocked(unlinkSync).mockReset();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('a rename that fails because another process rotated first appends to the file now at the path', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-logging-race-'));
  directories.push(directory);
  const path = join(directory, 'collector.jsonl');
  writeFileSync(path, `${'x'.repeat(150)}\n`);
  const reports: unknown[] = [];
  vi.mocked(renameSync).mockImplementationOnce((from, to) => {
    // The other process rotates the file between this process's size check and its rename.
    renameSync(from, join(directory, 'collector.1.jsonl'));
    expect(to).toBe(join(directory, 'collector.1.jsonl'));
    return renameSync(from, to);
  });
  writeRecord(
    { keep: 1, maxBytes: 200, path, report: (error) => reports.push(error) },
    `${'y'.repeat(150)}\n`,
  );
  expect(reports).toEqual([]);
  expect(readdirSync(directory).toSorted()).toEqual(['collector.1.jsonl', 'collector.jsonl']);
  expect(readFileSync(path, 'utf8')).toBe(`${'y'.repeat(150)}\n`);
  expect(readFileSync(join(directory, 'collector.1.jsonl'), 'utf8')).toBe(`${'x'.repeat(150)}\n`);
});

// A device can report a size. It must never be renamed or deleted for rotation.
test.skipIf(!existsSync('/dev/null'))(
  'a non-regular file never rotates even when it reports a size',
  () => {
    const device = statSync('/dev/null');
    vi.mocked(statSync).mockReturnValueOnce(Object.assign(device, { size: 150 }));
    const reports: unknown[] = [];
    // Block destructive operations if this test catches a regression.
    vi.mocked(renameSync).mockImplementation(() => {
      throw new Error('Device rename attempted.');
    });
    vi.mocked(unlinkSync).mockImplementation(() => {
      throw new Error('Device deletion attempted.');
    });
    const written = writeRecord(
      { keep: 1, maxBytes: 1, path: '/dev/null', report: (error) => reports.push(error) },
      'A record.\n',
    );
    expect(renameSync).not.toHaveBeenCalled();
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(reports).toEqual([]);
    expect(written).toEqual({ appended: true, rotated: false });
  },
);
