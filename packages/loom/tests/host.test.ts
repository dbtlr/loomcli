/*
 * The toolchain starts git and Bun through the run's `host.spawn` and takes its scratch folders
 * from `host.tmpdir`, under ADR-0107, so a run on a mock process starts no real program.
 *
 * - A git that cannot start fails the command in the bin's words, with no text of the runtime's: a
 *   git that is not on the PATH draws the sentence that names it, and any other code the general
 *   sentence with its code (ADR-0164). A Bun that cannot start draws the same general sentence,
 *   which `loom init` gives as the reason it could not read the application module.
 * - `loom init` reads an authored application module's exports with the mock's Bun, whose result
 *   file lies in a scratch folder under `host.tmpdir`, and removes that folder once it has read it.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { mockProcess } from '@loomcli/testing';
import type { ProgramCall } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

import { loom } from '../src/application.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';

afterEach(() => {
  removeRoots();
});

/** The error the runtime gives for a program that could not start with the code. */
function unstarted(program: string, code: string): Error {
  return Object.assign(new Error(`spawn ${program} ${code}`), { code });
}

const commands = [
  ['pr check', ['pr', 'check', '--base', 'main', '--title', 'feat: add notes']],
  ['changelog write', ['changelog', 'write', '--dry-run']],
] as const;

/**
 * One run of the command in a package directory, which is also a workspace directory, whose git
 * fails to start with the code.
 */
async function withUnstartedGit(argv: readonly string[], code: string) {
  const root = temporaryRoot('loom-host-');
  put(root, 'package.json', '{ "name": "notes", "version": "1.0.0" }\n');
  put(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  const mock = mockProcess({
    argv: [...argv],
    cwd: root,
    programs: {
      git: () => {
        throw unstarted('git', code);
      },
    },
  });
  const status = await loom.run({ process: mock });
  return { status, stderr: mock.stderr.text };
}

test.each(commands)(
  'a git that is not on the PATH fails %s with the sentence that names it',
  async (_name, argv) => {
    await expect(withUnstartedGit(argv, 'ENOENT')).resolves.toEqual({
      status: 1,
      stderr:
        'git is not on the PATH, and loom reads the repository with it. Install git and run the command again.\n',
    });
  },
);

test.each(commands)(
  'a git that cannot start for another reason fails %s with its code',
  async (_name, argv) => {
    await expect(withUnstartedGit(argv, 'EACCES')).resolves.toEqual({
      status: 1,
      stderr:
        'Cannot run git (EACCES). Check that git is installed and that you can run it, then run the command again.\n',
    });
  },
);

test('a Bun that cannot start is the reason loom init gives for the module it could not read', async () => {
  const root = temporaryRoot('loom-host-');
  put(root, 'package.json', '{ "name": "notes", "version": "1.0.0" }\n');
  put(root, 'src/application.ts', 'export const notes = undefined;\n');
  const mock = mockProcess({
    argv: ['init', '--only', 'entry'],
    cwd: root,
    programs: {
      bun: () => {
        throw unstarted('bun', 'EACCES');
      },
    },
    tmpdir: temporaryRoot('loom-host-tmp-'),
  });
  await expect(loom.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toBe(
    'warning: src/main.ts was not written because src/application.ts could not be loaded: Cannot run Bun (EACCES). Check that Bun is installed and that you can run it, then run the command again. Install the package and run loom init again, or write the entry by hand.\n',
  );
});

test('loom init reads the authored exports with Bun through the host, with its result under host.tmpdir', async () => {
  const root = temporaryRoot('loom-host-');
  const tmpdir = temporaryRoot('loom-host-tmp-');
  put(root, 'package.json', '{ "name": "notes", "version": "1.0.0" }\n');
  put(root, 'src/application.ts', 'export const notes = undefined;\n');
  const calls: ProgramCall[] = [];
  const mock = mockProcess({
    argv: ['init', '--only', 'entry'],
    cwd: root,
    programs: {
      bun: (call) => {
        calls.push(call);
        const resultFile = call.args[2] ?? '';
        expect(dirname(dirname(resultFile))).toBe(tmpdir);
        writeFileSync(resultFile, JSON.stringify({ names: ['notes'] }));
        return { code: 0 };
      },
    },
    tmpdir,
  });
  await expect(loom.run({ process: mock })).resolves.toBe(0);
  expect(calls.map(({ cwd }) => cwd)).toEqual([root]);
  expect(readFileSync(join(root, 'src/main.ts'), 'utf8')).toContain(
    "import { notes } from './application.js';",
  );
  expect(existsSync(tmpdir) && readdirSync(tmpdir)).toEqual([]);
});
