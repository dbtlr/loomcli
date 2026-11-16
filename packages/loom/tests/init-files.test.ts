/*
 * `loom init` names a file it cannot write, remove, or read, with the cause in Loom's words and a
 * step (docs/toolchain/init.md, A file init cannot read, write, or remove; ADR-0164, The bin's
 * reworded sentences). Each case runs in-process on a mock process in a sandbox whose walks stop
 * at its ceiling, under ADR-0103.
 *
 * - A path on the way to the file that is a file names that path. A directory, a denied
 *   permission, a read-only file system, and a full disk each name their cause, and any other
 *   system error names its code, so no sentence repeats the runtime's own text.
 * - A file the sweep cannot remove, and a managed file init cannot read, are named the same way.
 * - A scratch folder the read of the authored application module cannot make draws the warning
 *   with the general reason and the system error's code.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { mockProcess } from '@loomcli/testing';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { loom } from '../src/application.js';
import { renderManaged } from '../src/helpers/managed.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import { failAt, restoreFs } from './system-errors.js';

/*
 * Ceil the toolchain's walks up from a fixture at the sandbox (see ./ceiling.ts), and let a case
 * fail the members init writes, removes, and reads through (see ./system-errors.ts).
 */
vi.mock(import('node:fs'), async (importOriginal) => {
  const { ceiled } = await import('./ceiling.js');
  const { failing } = await import('./system-errors.js');
  const actual = ceiled(await importOriginal());
  return {
    ...actual,
    mkdtempSync: failing('mkdtempSync', actual.mkdtempSync),
    readFileSync: failing('readFileSync', actual.readFileSync),
    rmSync: failing('rmSync', actual.rmSync),
    writeFileSync: failing('writeFileSync', actual.writeFileSync),
  };
});

afterEach(() => {
  restoreFs();
  removeRoots();
});

/** The fragment guide, the file `--only changes` writes. */
const guidePath = '.changes/README.md';

/** A file of the authoring skill's folder that the running loom no longer ships, unedited. */
const retiredPath = '.agents/skills/loom/references/retired.md';

/** A package directory that names an application and holds the supplied files. */
function notesPackage(files: Record<string, string> = {}) {
  const directory = temporaryRoot('loom-init-files-');
  put(directory, 'package.json', '{ "name": "notes", "version": "0.0.0" }\n');
  for (const [path, body] of Object.entries(files)) {
    put(directory, path, body);
  }
  return directory;
}

/** One `loom init` run in the directory, off a terminal. */
async function init(cwd: string, ...argv: string[]) {
  const mock = mockProcess({ argv: ['init', ...argv], cwd });
  const status = await loom.run({ process: mock });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

test('a path on the way to the file that is a file names that path', async () => {
  const directory = notesPackage({ '.changes': 'a file where a folder belongs\n' });
  await expect(init(directory, '--only', 'changes')).resolves.toEqual({
    status: 1,
    stderr:
      'Cannot write .changes/README.md, because .changes is a file. Remove or rename it, then run loom init again.\n',
    stdout: '',
  });
});

test('a file on the way two folders down names that file, not the folder below it', async () => {
  const directory = notesPackage({ '.agents/skills': 'a file where a folder belongs\n' });
  await expect(init(directory, '--only', 'skill')).resolves.toEqual({
    status: 1,
    stderr:
      'Cannot write .agents/skills/loom-changelog/SKILL.md, because .agents/skills is a file. Remove or rename it, then run loom init again.\n',
    stdout: '',
  });
});

test('a package.json init cannot read names the path, the cause, and a step', async () => {
  const directory = notesPackage();
  const manifest = join(directory, 'package.json');
  failAt('readFileSync', manifest, 'EACCES');
  await expect(init(directory, '--only', 'changes')).resolves.toEqual({
    status: 1,
    stderr: `Cannot open ${manifest}, because permission was denied. Check that your user can open it and has execute access to each folder above it, then run the command again.\n`,
    stdout: '',
  });
});

test.each([
  [
    'EISDIR',
    'Cannot write .changes/README.md, because it is a folder. Remove or rename the folder, then run loom init again.',
  ],
  [
    'EACCES',
    'Cannot write .changes/README.md, because permission was denied. Give your user write access to it and its folder, and execute access to each folder above it, then run loom init again.',
  ],
  [
    'EPERM',
    'Cannot write .changes/README.md, because permission was denied. Give your user write access to it and its folder, and execute access to each folder above it, then run loom init again.',
  ],
  [
    'EROFS',
    'Cannot write .changes/README.md, because the file system is read-only. Run loom init in a package on a writable file system.',
  ],
  [
    'ENOSPC',
    'Cannot write .changes/README.md, because no space is left. Free some space, then run loom init again.',
  ],
  [
    'ENOTDIR',
    'Cannot write .changes/README.md, because a path on the way is a file. Remove or rename the file on the way, then run loom init again.',
  ],
  [
    'EIO',
    'Cannot write .changes/README.md (EIO). Check that you can write to it and its directory, then run loom init again.',
  ],
  [
    undefined,
    'Cannot write .changes/README.md. Check that you can write to it and its directory, then run loom init again.',
  ],
])('a write that fails on %s names the cause and a step', async (code, sentence) => {
  const directory = notesPackage();
  failAt('writeFileSync', join(directory, guidePath), code);
  await expect(init(directory, '--only', 'changes')).resolves.toEqual({
    status: 1,
    stderr: `${sentence}\n`,
    stdout: '',
  });
});

test.each([
  [
    'EACCES',
    `Cannot remove ${retiredPath}, because permission was denied. Give your user write access to its folder, and execute access to each folder above it, then run loom init again.`,
  ],
  [
    'EPERM',
    `Cannot remove ${retiredPath}, because permission was denied. Give your user write access to its folder, and execute access to each folder above it, then run loom init again.`,
  ],
  [
    'EROFS',
    `Cannot remove ${retiredPath}, because the file system is read-only. Run loom init in a package on a writable file system.`,
  ],
  [
    'EBUSY',
    `Cannot remove ${retiredPath} (EBUSY). Check that you can write to its directory, then run loom init again.`,
  ],
  [
    undefined,
    `Cannot remove ${retiredPath}. Check that you can write to its directory, then run loom init again.`,
  ],
])('a removal that fails on %s names the cause and a step', async (code, sentence) => {
  const directory = notesPackage({ [retiredPath]: renderManaged('\n# Retired\n') });
  failAt('rmSync', join(directory, retiredPath), code);
  const result = await init(directory, '--only', 'skill');
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(`${sentence}\n`);
  expect(result.stdout).not.toContain('Removed');
});

test('a managed path that is a directory names it when init reads it', async () => {
  const directory = notesPackage();
  mkdirSync(join(directory, guidePath), { recursive: true });
  await expect(init(directory, '--only', 'changes')).resolves.toEqual({
    status: 1,
    stderr:
      'Cannot read .changes/README.md, because it is a folder. Remove or rename the folder, then run loom init again.\n',
    stdout: '',
  });
});

test.each([
  [
    'EACCES',
    'Cannot read .changes/README.md, because permission was denied. Give your user read access to it, and execute access to each folder above it, then run loom init again.',
  ],
  [
    'EPERM',
    'Cannot read .changes/README.md, because permission was denied. Give your user read access to it, and execute access to each folder above it, then run loom init again.',
  ],
  [
    'EIO',
    'Cannot read .changes/README.md (EIO). Check that you can read it, then run loom init again.',
  ],
])('a managed file init cannot read on %s names the cause and a step', async (code, sentence) => {
  const directory = notesPackage({ [guidePath]: renderManaged('\n# An older guide\n') });
  failAt('readFileSync', join(directory, guidePath), code);
  await expect(init(directory, '--only', 'changes')).resolves.toEqual({
    status: 1,
    stderr: `${sentence}\n`,
    stdout: '',
  });
});

test('a skill file the sweep cannot read names the cause and a step', async () => {
  const directory = notesPackage({ [retiredPath]: renderManaged('\n# Retired\n') });
  failAt('readFileSync', join(directory, retiredPath), 'EACCES');
  const result = await init(directory, '--only', 'skill');
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    `Cannot read ${retiredPath}, because permission was denied. Give your user read access to it, and execute access to each folder above it, then run loom init again.\n`,
  );
});

test('a scratch folder the application read cannot make draws the warning with the code', async () => {
  const directory = notesPackage({ 'src/application.ts': 'export const notes = undefined;\n' });
  failAt('mkdtempSync', (prefix) => prefix.includes('loom-read-application-'), 'ENOSPC');
  await expect(init(directory, '--only', 'entry')).resolves.toEqual({
    status: 0,
    stderr:
      'warning: src/main.ts was not written because src/application.ts could not be loaded: it could not be read (ENOSPC). Install the package and run loom init again, or write the entry by hand.\n',
    stdout: '',
  });
});
