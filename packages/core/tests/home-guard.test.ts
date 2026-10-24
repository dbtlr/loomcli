/*
 * The guard Loom's own suite runs around every test file, which fails the run when a test wrote
 * under the developer's home. Every case points it at a temporary folder that stands in for the
 * home, never the real one.
 *
 * - A new entry named after a fixture application, in a folder an installing plugin or the logging
 *   plugin writes, is reported, and so is a changed rc file.
 * - An entry another application on the machine owns, and a change inside an entry that existed
 *   before the run to a file not named after a fixture application, are not.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import { homeChanges, homeSnapshot } from '../../../scripts/home-guard.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A temporary folder standing in for the home, with the folders the plugins write into. */
function standIn(): string {
  const home = mkdtempSync(join(tmpdir(), 'loom-guard-home-'));
  roots.push(home);
  for (const folder of ['.local/state', '.cache', '.claude/skills', '.local/share/man/man1']) {
    mkdirSync(join(home, folder), { recursive: true });
  }
  return home;
}

test('a new state folder named after a fixture application is reported', () => {
  const home = standIn();
  const before = homeSnapshot(home);
  mkdirSync(join(home, '.local/state/notes'));
  writeFileSync(join(home, '.local/state/notes/x'), '');
  expect(homeChanges(before, homeSnapshot(home))).toEqual([join(home, '.local/state/notes')]);
});

test('a new man page and skill named after a fixture application are reported', () => {
  const home = standIn();
  const before = homeSnapshot(home);
  writeFileSync(join(home, '.local/share/man/man1/notes-sync.1'), '');
  mkdirSync(join(home, '.claude/skills/packed'));
  expect(homeChanges(before, homeSnapshot(home)).toSorted()).toEqual([
    join(home, '.claude/skills/packed'),
    join(home, '.local/share/man/man1/notes-sync.1'),
  ]);
});

test('a changed rc file is reported', () => {
  const home = standIn();
  writeFileSync(join(home, '.bashrc'), 'export A=1\n');
  utimesSync(join(home, '.bashrc'), new Date(1000), new Date(1000));
  const before = homeSnapshot(home);
  writeFileSync(join(home, '.bashrc'), 'export A=1\n. ~/jsonkit.bash\n');
  expect(homeChanges(before, homeSnapshot(home))).toEqual([join(home, '.bashrc')]);
});

test("another application's entries, and its own files inside a fixture-named folder it owns, are not reported", () => {
  const home = standIn();
  mkdirSync(join(home, '.local/state/heimdall'));
  const before = homeSnapshot(home);
  mkdirSync(join(home, '.local/state/other-tool'));
  mkdirSync(join(home, '.cache/someone'));
  writeFileSync(join(home, '.local/state/heimdall/queue.sqlite-wal'), '');
  expect(homeChanges(before, homeSnapshot(home))).toEqual([]);
  writeFileSync(join(home, '.local/state/heimdall/heimdall.jsonl'), '');
  expect(homeChanges(before, homeSnapshot(home))).toEqual([
    join(home, '.local/state/heimdall/heimdall.jsonl'),
  ]);
});
