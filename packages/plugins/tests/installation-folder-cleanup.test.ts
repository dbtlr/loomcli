/*
 * Folder writes and removals that another run overtakes at a point no step of the other run can
 * reach from outside: inside a removal, which removes a folder's entries one at a time, and between
 * a write's move aside and its rename into place. This file stands in for the other run at that
 * point by hooking `rmSync` or `renameSync` once, and the run under test then finishes.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FatalError, nowrap } from '@loomcli/core';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { exists, retiredPath, stagingPath } from '../src/installation/disk.js';
import type { FolderFile } from '../src/installation/folders.js';
import {
  fillFolder,
  removeFolderLeftovers,
  removeWhole,
  writeFolder,
} from '../src/installation/folders.js';
import { interleaved } from './fixtures/interleaved-files.ts';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<{ renameSync: typeof renameSync; rmSync: typeof rmSync }>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), rmSync: vi.fn(actual.rmSync) };
});

const roots: string[] = [];

afterEach(() => {
  vi.mocked(renameSync).mockReset();
  vi.mocked(rmSync).mockReset();
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const oldFiles = [
  { content: 'old', path: 'SKILL.md' },
  { content: 'old', path: 'b.md' },
];
const otherFiles = [
  { content: 'other', path: 'SKILL.md' },
  { content: 'other', path: 'b.md' },
  { content: 'other', path: 'c.md' },
];

/** The sentence of a folder write that another run overtook. */
const changedMeanwhile = (path: string) =>
  new FatalError(
    `Cannot write ${nowrap(path)} because another run changed the folder at the same time. Wait for that run to finish, then run the command again.`,
  );

/**
 * A sandbox with a `skills` directory, and the path of the folder `notes` in it, which holds the old
 * files unless `empty` is set.
 */
function sandbox(empty = false) {
  const root = mkdtempSync(join(tmpdir(), 'loom-folder-cleanup-'));
  roots.push(root);
  const skills = join(root, 'skills');
  const folder = join(skills, 'notes');
  mkdirSync(skills);
  if (!empty) {
    writeFolder(folder, oldFiles);
  }
  return { folder, skills };
}

/** Each file of the flat folder at `folder` with its content. */
function contents(folder: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(folder).map((entry) => [entry, readFileSync(join(folder, entry), 'utf8')]),
  );
}

/** The files of `files` as `contents` reads them. */
function expected(files: readonly FolderFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.path, String(file.content)]));
}

/**
 * Another run's swap, after its cleanup and its fill: it moves what is at `folder` aside, renames
 * its staging folder into place, and leaves what it moved aside, which no case here reads.
 */
function publishOther(folder: string): void {
  const staging = stagingPath(folder);
  mkdirSync(staging);
  fillFolder(staging, otherFiles);
  if (exists(folder)) {
    renameSync(folder, retiredPath(folder));
  }
  renameSync(staging, folder);
}

/** Runs `step` once, as the run under test renames a staging folder onto `folder`, before that rename. */
function beforeRenameInto(folder: string, step: () => void): void {
  const actual = vi.mocked(renameSync).getMockImplementation();
  let reached = false;
  vi.mocked(renameSync).mockImplementation((from, to) => {
    if (!reached && to === folder && String(from).endsWith('.loom-staging')) {
      reached = true;
      step();
    }
    actual?.(from, to);
  });
}

test('another run whose cleanup stops partway through removing a staging folder never makes the owning run publish it with files missing', () => {
  const box = sandbox();
  const actual = vi.mocked(rmSync).getMockImplementation();
  vi.mocked(rmSync).mockImplementationOnce((path) => {
    // The other run's removal takes the first entry of the leftover, and the owning run goes on.
    const [first] = readdirSync(String(path)).toSorted();
    actual?.(join(String(path), first ?? ''), { force: true, recursive: true });
  });
  const files = [
    { content: 'new', path: 'SKILL.md' },
    { content: 'new', path: 'b.md' },
    { content: 'new', path: 'c.md' },
  ];
  expect(() =>
    writeFolder(
      box.folder,
      interleaved(files, 2, () => {
        removeFolderLeftovers(box.folder);
      }),
    ),
  ).toThrow(changedMeanwhile(box.folder));
  expect(contents(box.folder)).toEqual(expected(oldFiles));
});

test('a first write whose rename into place meets the folder another run just published fails, and the path holds that folder whole', () => {
  const box = sandbox(true);
  beforeRenameInto(box.folder, () => {
    publishOther(box.folder);
  });
  expect(() => writeFolder(box.folder, [{ content: 'new', path: 'SKILL.md' }])).toThrow(
    changedMeanwhile(box.folder),
  );
  expect(contents(box.folder)).toEqual(expected(otherFiles));
  expect(readdirSync(box.skills)).toEqual(['notes']);
});

test('a write whose rename into place meets the folder another run published after the move aside fails with the sentence though its move back fails too, and leaves the old folder whole under a retired name', () => {
  const box = sandbox();
  beforeRenameInto(box.folder, () => {
    publishOther(box.folder);
  });
  expect(() => writeFolder(box.folder, [{ content: 'new', path: 'SKILL.md' }])).toThrow(
    changedMeanwhile(box.folder),
  );
  expect(contents(box.folder)).toEqual(expected(otherFiles));
  const beside = readdirSync(box.skills).filter((entry) => entry !== 'notes');
  expect(beside).toEqual([expect.stringMatching(/^\.notes\.[\da-f]{16}\.loom-retired$/u)]);
  expect(contents(join(box.skills, beside[0] ?? ''))).toEqual(expected(oldFiles));
});

test('removing a folder whole while another run publishes a new folder at its path leaves the new folder whole and the old one gone', () => {
  const box = sandbox();
  const actual = vi.mocked(rmSync).getMockImplementation();
  vi.mocked(rmSync).mockImplementationOnce((path, options) => {
    // As the removal begins, another run moves the folder at the path aside and publishes its own.
    publishOther(box.folder);
    actual?.(path, options);
  });
  expect(removeWhole(box.folder)).toBe(true);
  expect(contents(box.folder)).toEqual(expected(otherFiles));
  expect(readdirSync(box.skills)).toEqual(['notes']);
});

test('removing a folder whole that is gone by the time it is claimed passes over it', () => {
  const box = sandbox();
  const actual = vi.mocked(renameSync).getMockImplementation();
  vi.mocked(renameSync).mockImplementationOnce((from, to) => {
    // Another run removes the folder between the check and the claim.
    rmSync(box.folder, { force: true, recursive: true });
    actual?.(from, to);
  });
  expect(removeWhole(box.folder)).toBe(false);
  expect(readdirSync(box.skills)).toEqual([]);
});

/** A leftover staging folder of `notes` beside the folder, as a stopped or racing run leaves one. */
function leftoverBeside(box: { skills: string }): string {
  const leftover = join(box.skills, '.notes.0123456789abcdef.loom-staging');
  mkdirSync(leftover);
  writeFileSync(join(leftover, 'SKILL.md'), 'half');
  return leftover;
}

/** An error as `rmSync` throws it when a folder is not empty as its removal ends. */
function notEmpty(path: string): Error {
  return Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`), {
    code: 'ENOTEMPTY',
  });
}

/**
 * Makes the next removal end with the entry not empty: a late write of another run lands in it as
 * the removal runs, which the removal then throws on.
 */
function lateWriteDuringRemoval(): void {
  vi.mocked(rmSync).mockImplementationOnce((path) => {
    writeFileSync(join(String(path), 'late.md'), 'late');
    throw notEmpty(String(path));
  });
}

test('a leftover that is gone by the time cleanup claims it is passed over, and the write goes on', () => {
  const box = sandbox();
  const leftover = leftoverBeside(box);
  const actual = vi.mocked(renameSync).getMockImplementation();
  vi.mocked(renameSync).mockImplementationOnce((from, to) => {
    // Another run claims the leftover between this run's listing and its rename.
    rmSync(leftover, { force: true, recursive: true });
    actual?.(from, to);
  });
  expect(writeFolder(box.folder, otherFiles)).toEqual([]);
  expect(contents(box.folder)).toEqual(expected(otherFiles));
  expect(readdirSync(box.skills)).toEqual(['notes']);
});

test('a claimed leftover that another run writes into as it is removed keeps its retired name, goes unreported, and the write goes on', () => {
  const box = sandbox();
  leftoverBeside(box);
  lateWriteDuringRemoval();
  expect(writeFolder(box.folder, otherFiles)).toEqual([]);
  expect(contents(box.folder)).toEqual(expected(otherFiles));
  const beside = readdirSync(box.skills).filter((entry) => entry !== 'notes');
  expect(beside).toEqual([expect.stringMatching(/^\.notes\.[\da-f]{16}\.loom-retired$/u)]);
});

test('the next write removes and reports a claimed leftover an earlier cleanup could not finish removing', () => {
  const box = sandbox();
  leftoverBeside(box);
  lateWriteDuringRemoval();
  writeFolder(box.folder, otherFiles);
  const kept = readdirSync(box.skills).find((entry) => entry !== 'notes');
  expect(writeFolder(box.folder, oldFiles)).toEqual([join(box.skills, kept ?? '')]);
  expect(readdirSync(box.skills)).toEqual(['notes']);
});

test('removing a folder whole that is written into as its claimed entry is removed reports it removed and leaves the rest under its retired name', () => {
  const box = sandbox();
  lateWriteDuringRemoval();
  expect(removeWhole(box.folder)).toBe(true);
  expect(readdirSync(box.skills)).toEqual([
    expect.stringMatching(/^\.notes\.[\da-f]{16}\.loom-retired$/u),
  ]);
});
