/*
 * An ending signal stops the git, pnpm, and Bun children loom starts and the command with them. A
 * cancelled command prints nothing, resolves the signal's code, starts no child after the cancel,
 * writes nothing after it, and leaves no lock or scratch folder.
 *
 * Each run is on a mock process. git answers through the machine's git in a temporary repository,
 * and the child the cancel lands in raises the signal on the mock and waits until it is ended.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ProcessSignal } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import type { MockProcess, ProgramAnswer, ProgramCall } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { loom } from '../src/application.js';
import { pnpmManifestPath } from '../src/helpers/release-files.js';
import { commit, git, put, removeRoots, repository, temporaryRoot } from './fixture.js';

afterEach(() => {
  removeRoots();
});

/** The machine's git, run for a scripted call in a sealed environment with no home of its own. */
function realGit(home: string) {
  return (call: ProgramCall): ProgramAnswer => {
    const result = spawnSync('git', call.args, {
      cwd: call.cwd,
      env: { GIT_CONFIG_NOSYSTEM: '1', HOME: home, PATH: process.env.PATH },
    });
    return { code: result.status ?? 1, stderr: result.stderr, stdout: result.stdout };
  };
}

/** A child that raises the signal on the mock the moment it starts and waits until it is ended. */
function cancelling(mock: () => MockProcess, signal: ProcessSignal) {
  return async (call: ProgramCall): Promise<ProgramAnswer> => {
    mock().signals.raise(signal);
    await new Promise((resolve) => {
      call.signal.addEventListener('abort', resolve, { once: true });
    });
    return { code: 0 };
  };
}

/** A repository with two committed fragments on a topic branch above main. */
function topicRepository() {
  const { root } = repository({
    files: {
      '.changes/README.md': '# Guide\n',
      'package.json': '{"name":"fixture","private":true,"version":"9.0.0"}\n',
      'packages/core/package.json': '{"name":"@sample/core","version":"0.1.0"}\n',
    },
    prefix: 'loom-cancel-',
  });
  git(root, ['branch', '-M', 'main']);
  git(root, ['checkout', '-qb', 'topic']);
  put(root, '.changes/add.md', '- Add input.\n');
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  return root;
}

test('a SIGTERM while pr check reads a fragment prints nothing, resolves 143, and starts no git after it', async () => {
  const root = topicRepository();
  const home = temporaryRoot('loom-cancel-home-');
  const calls: string[][] = [];
  const answer = realGit(home);
  const cancel = cancelling(() => mock, 'SIGTERM');
  const mock: MockProcess = mockProcess({
    argv: ['pr', 'check', '--base', 'main', '--title', 'feat: add input'],
    cwd: root,
    programs: {
      git: (call) => {
        calls.push([...call.args]);
        return call.args.includes('.changes/add.md') ? cancel(call) : answer(call);
      },
    },
  });
  await expect(loom.run({ process: mock })).resolves.toBe(143);
  expect(mock.stderr.text).toBe('');
  expect(mock.stdout.text).toBe('');
  expect(calls.at(-1)).toContain('.changes/add.md');
});

const pnpmManifest = z.object({ bin: z.object({ pnpm: z.string() }) });

/** The command release preparation starts pnpm with: the installed pnpm's own bin. */
function pnpmCommand() {
  const manifestPath = pnpmManifestPath();
  const manifest = pnpmManifest.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  return join(dirname(manifestPath), manifest.bin.pnpm);
}

test('a SIGTERM while release cut prepares the lockfile prints nothing, resolves 143, and leaves no lock, stage, or change', async () => {
  const { root } = repository({
    files: {
      '.changes/README.md': '# Guide\n',
      '.changes/add.md': '- Add input.\n',
      'CHANGELOG.md': '# Changelog\n',
      'package.json': '{"name":"fixture","private":true,"version":"9.0.0"}\n',
      'packages/core/package.json': '{"name":"@sample/core","version":"0.0.0"}\n',
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    },
    prefix: 'loom-cancel-',
  });
  const home = temporaryRoot('loom-cancel-home-');
  const tmpdir = temporaryRoot('loom-cancel-tmp-');
  const mock: MockProcess = mockProcess({
    argv: ['release', 'cut', '--date', '2026-09-07'],
    cwd: root,
    programs: { git: realGit(home), [pnpmCommand()]: cancelling(() => mock, 'SIGTERM') },
    tmpdir,
  });
  await expect(loom.run({ process: mock })).resolves.toBe(143);
  expect(mock.stderr.text).toBe('');
  expect(existsSync(join(root, '.git/release-cut.lock'))).toBe(false);
  expect(readdirSync(tmpdir)).toEqual([]);
  expect(git(root, ['status', '--porcelain'])).toBe('');
});
