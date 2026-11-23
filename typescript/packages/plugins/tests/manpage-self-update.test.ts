// Acceptance plan: see packages/plugins/tests/manpage.test.ts.

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ReleaseFacts } from '@loomcli/core';
import type { Program } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

import { run as runManpage } from './fixtures/manpage-app.ts';
import { runSelfUpdate } from './fixtures/self-update-mock.ts';

const asset = 'notes-linux-x64';
const oldBytes = 'notes 1.4.2 binary\n';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The program for a notes binary: it runs the man page application, as the update's refresh spawns
 * it, at the version the bytes at its path name, so the run reaches the binary the update wrote.
 */
const notesBinary: Program = async (call) => {
  const version = /^notes (?<version>\S+) binary$/u.exec(readFileSync(call.command, 'utf8').trim())
    ?.groups?.version;
  if (version === undefined) {
    throw new Error(`${call.command} is not a notes binary.`);
  }
  const outcome = await runManpage([...call.args], { cwd: call.cwd, env: call.env, version });
  return { code: outcome.status, stderr: outcome.stderr, stdout: outcome.stdout };
};

test('an update rewrites a recorded page to the replaced binary’s version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loom-manpage-update-'));
  roots.push(root);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const bin = join(root, 'bin');
  for (const directory of [home, state, bin, join(state, 'notes', 'installation')]) {
    mkdirSync(directory, { recursive: true });
  }
  const binary = join(bin, 'notes');
  writeFileSync(binary, oldBytes);
  chmodSync(binary, 0o755);
  writeFileSync(
    join(state, 'notes', 'installation', 'install.json'),
    `{"format":1,"method":"script","path":${JSON.stringify(binary)},"digest":"sha256:${digestOf(oldBytes)}"}\n`,
  );
  const env = {
    HOME: home,
    PATH: `${join(home, '.local', 'bin')}:/usr/bin`,
    XDG_STATE_HOME: state,
  };
  // The old version installed its pages.
  const installed = await runManpage(['manpage', 'install'], { cwd: root, env, version: '1.4.2' });
  expect(installed.status).toBe(0);
  const page = join(home, '.local', 'share', 'man', 'man1', 'notes.1');
  expect(readFileSync(page, 'utf8').split('\n')[0]).toBe('.TH "NOTES" "1" "" "notes 1.4.2" ""');
  // The new binary runs the same application at the new version.
  const bytes = 'notes 1.5.0 binary\n';
  const release: ReleaseFacts = {
    build: 'distributed',
    installation: { digest: `sha256:${digestOf(oldBytes)}`, method: 'script', path: binary },
    release: { asset, channel: 'stable', repository: 'acme/notes', version: '1.4.2' },
  };
  const result = await runSelfUpdate(
    {
      github: {
        feed: ['v1.5.0'],
        latest: 'v1.5.0',
        releases: {
          'v1.5.0': { assets: { [asset]: bytes }, sums: `${digestOf(bytes)}  ${asset}\n` },
        },
        repository: 'acme/notes',
      },
      hook: 'refresh-manpages',
      release,
      requests: join(root, 'requests.txt'),
    },
    { argv: ['self-update'], env, home, programs: { [binary]: notesBinary }, release },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('Updated notes from 1.4.2 to 1.5.0.');
  expect(result.stderr).toContain(
    `Updated 8 man pages in ${join(home, '.local', 'share', 'man', 'man1')}.`,
  );
  expect(readFileSync(page, 'utf8').split('\n')[0]).toBe('.TH "NOTES" "1" "" "notes 1.5.0" ""');
});
