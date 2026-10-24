/*
 * The toolchain starts git and Bun through the run's `host.spawn` and takes its scratch folders
 * from `host.tmpdir`, under ADR-0107, so a run on a mock process starts no real program.
 *
 * - A git that cannot start fails the command with the error the runtime gave, as it did before
 *   the toolchain moved onto the host.
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

/** The error the runtime gives for a git no program answers to. */
function missingGit(): Error {
  return Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
}

test.each([
  ['pr check', ['pr', 'check', '--base', 'main', '--title', 'feat: add notes']],
  ['changelog write', ['changelog', 'write', '--dry-run']],
])('a git that cannot start fails %s with the runtime error', async (_name, argv) => {
  const root = temporaryRoot('loom-host-');
  put(root, 'package.json', '{ "name": "notes", "version": "1.0.0" }\n');
  const mock = mockProcess({
    argv,
    cwd: root,
    programs: {
      git: () => {
        throw missingGit();
      },
    },
  });
  await expect(loom.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toContain('spawn git ENOENT');
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
