// Acceptance plan: see packages/plugins/tests/skills.test.ts.

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ReleaseFacts } from '@loomcli/core';
import type { Program } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

import { runSelfUpdate } from './fixtures/self-update-mock.ts';
import { run as runSkills } from './fixtures/skills-run-app.ts';

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

/** The bytes of the replacing binary, a new release of an application that installs `skills()`. */
const newBytes = 'notes 1.5.0 binary\n';

test('an update refreshes a recorded skill to the replaced binary’s version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loom-skills-update-'));
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
  const record = join(state, 'notes', 'installation', 'install.json');
  writeFileSync(
    record,
    `{"format":1,"method":"script","path":${JSON.stringify(binary)},"digest":"sha256:${digestOf(oldBytes)}"}\n`,
  );
  // The old version installed its skill, so the record lists the folder and the folder holds v1.
  const folder = join(home, '.claude', 'skills', 'notes');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'SKILL.md'), 'v1\n');
  const skillsRecord = join(state, 'notes', 'installation', 'skills.claude.json');
  writeFileSync(
    skillsRecord,
    `{"format":1,"state":"committed","directories":[],"files":[],"folders":[{"path":${JSON.stringify(folder)}}]}\n`,
  );
  // The new binary's skill is what the skills application answers. The program for the binary's
  // Path runs that application, as the refresh spawns it, once the update wrote the new bytes there.
  const notesBinary: Program = async (call) => {
    if (readFileSync(call.command, 'utf8') !== newBytes) {
      throw new Error(`${call.command} is not the new notes binary.`);
    }
    const outcome = await runSkills([...call.args], {
      cwd: call.cwd,
      env: call.env,
      loaded: join(root, 'loaded.log'),
      skills: [{ files: [{ content: 'v2\n', path: 'SKILL.md' }], name: 'notes' }],
    });
    return { code: outcome.status, stderr: outcome.stderr, stdout: outcome.stdout };
  };
  const bytes = newBytes;
  const github = {
    feed: ['v1.5.0'],
    latest: 'v1.5.0',
    releases: {
      'v1.5.0': { assets: { [asset]: bytes }, sums: `${digestOf(bytes)}  ${asset}\n` },
    },
    repository: 'acme/notes',
  };
  const release: ReleaseFacts = {
    build: 'distributed',
    installation: { digest: `sha256:${digestOf(oldBytes)}`, method: 'script', path: binary },
    release: { asset, channel: 'stable', repository: 'acme/notes', version: '1.4.2' },
  };
  const env = { HOME: home, XDG_STATE_HOME: state };
  const result = await runSelfUpdate(
    { github, hook: 'refresh', release, requests: join(root, 'requests.txt') },
    {
      argv: ['self-update'],
      cwd: root,
      env,
      home,
      programs: { [binary]: notesBinary },
      release,
    },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('Updated notes from 1.4.2 to 1.5.0.');
  expect(result.stderr).toContain(`Updated notes for claude in ${folder}.`);
  expect(readFileSync(join(folder, 'SKILL.md'), 'utf8')).toBe('v2\n');
  expect(existsSync(join(home, '.agents'))).toBe(false);
  expect(readFileSync(binary, 'utf8')).toBe(bytes);
});
