// Acceptance plan: see packages/plugins/tests/completion.test.ts.

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ReleaseFacts } from '@loomcli/core';
import type { Program } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

import { bashScript } from '../src/completion/bash.js';
import { run as runInstallation } from './fixtures/completion-install-app.ts';
import { runOnMock } from './fixtures/in-process.ts';
import { refreshApplication } from './fixtures/refresh-app.ts';
import type { Observed } from './fixtures/refresh-app.ts';
import { runSelfUpdate } from './fixtures/self-update-mock.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** Where the mock runs the application and where the refreshed binary lies. */
const work = '/loom-test/work';
const refreshed = '/loom-test/bin/jsonkit';

/**
 * Runs the application's `refresh` Command on mockProcess against the binary at `path`, whose
 * child is the script `programs` holds for it.
 */
async function refresh(path: string, programs: Record<string, Program>) {
  const events: Observed[] = [];
  let resolved = false;
  const app = refreshApplication('completion', path, {
    observe: (event) => events.push(event),
    resolved: () => {
      resolved = true;
    },
  });
  const result = await runOnMock(app, {
    argv: ['refresh'],
    cwd: work,
    env: { FROM_HOST: 'yes' },
    programs,
  });
  return { ...result, events, resolved };
}

const warning = 'Completion was not refreshed after the update.';

test('runs the binary with completion update, host.env, and host.cwd, pipes its output, and resolves', async () => {
  const result = await refresh(refreshed, {
    [refreshed]: (call) => ({
      stderr: 'child says hello\n',
      stdout: `${JSON.stringify({ argv: call.args, cwd: call.cwd, from: call.env.FROM_HOST })}\n`,
    }),
  });
  expect(result.status).toBe(0);
  const printed = result.stdout.split('\n').find((line) => line.startsWith('{'));
  expect(JSON.parse(printed ?? '{}')).toMatchObject({
    argv: ['completion', 'update'],
    from: 'yes',
  });
  expect(JSON.parse(printed ?? '{}').cwd).toMatch(/work$/u);
  expect(result.stderr).toContain('child says hello\n');
  expect(result.resolved).toBe(true);
  expect(result.events).toEqual([]);
});

test('adds the warn event with the exit code for a child that exits 1, and resolves', async () => {
  const path = refreshed;
  const result = await refresh(path, { [path]: () => ({ code: 1 }) });
  expect(result.status).toBe(0);
  expect(result.resolved).toBe(true);
  expect(result.events).toEqual([{ fields: { code: 1, path }, level: 'warn', message: warning }]);
});

test('adds the warn event and writes the pinned line for a path that cannot start', async () => {
  const path = '/loom-test/missing/jsonkit';
  const result = await refresh(path, {
    // A script that throws stands for a binary that could not start, as a missing file cannot.
    [path]: (call) => {
      throw new Error(`spawn ${call.command} ENOENT`);
    },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    `Completion was not refreshed because ${path} could not start. Run jsonkit completion update.\n`,
  );
  expect(result.resolved).toBe(true);
  const [event, ...rest] = result.events;
  expect(rest).toEqual([]);
  expect(event).toMatchObject({ level: 'warn', message: warning });
  expect(event?.fields.path).toBe(path);
  expect(event?.fields.error).toBeTypeOf('string');
});

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

test('a self-update rewrites a recorded script to the replaced binary’s version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loom-completion-update-'));
  roots.push(root);
  const home = join(root, 'home');
  const data = join(root, 'data');
  const state = join(root, 'state');
  const bin = join(root, 'bin');
  // The self-update fixture's application is notes, and the binary it installs is jsonkit.
  const updating = join(state, 'notes', 'installation');
  const installation = join(state, 'jsonkit', 'installation');
  for (const directory of [home, data, state, bin, updating, installation]) {
    mkdirSync(directory, { recursive: true });
  }
  const oldBytes = 'jsonkit 1.4.2 binary\n';
  const binary = join(bin, 'jsonkit');
  writeFileSync(binary, oldBytes);
  chmodSync(binary, 0o755);
  writeFileSync(
    join(updating, 'install.json'),
    `{"format":1,"method":"script","path":${JSON.stringify(binary)},"digest":"sha256:${digestOf(oldBytes)}"}\n`,
  );
  // The old version installed its Bash script, so the record lists it and the file holds it.
  const script = join(data, 'jsonkit', 'completion', 'jsonkit.bash');
  mkdirSync(join(data, 'jsonkit', 'completion'), { recursive: true });
  writeFileSync(script, 'old script\n');
  writeFileSync(
    join(installation, 'completion.bash.json'),
    `{"format":1,"state":"committed","directories":[],"files":[{"path":${JSON.stringify(script)},"digest":"sha256:${digestOf('old script\n')}"}]}\n`,
  );
  // The replacing binary runs the completion fixture application with the arguments it was given,
  // Once the update wrote its bytes at the recorded path.
  const bytes = 'jsonkit 1.5.0 binary\n';
  const replacing: Program = async (call) => {
    if (readFileSync(call.command, 'utf8') !== bytes) {
      throw new Error(`${call.command} is not the new jsonkit binary.`);
    }
    const outcome = await runInstallation([...call.args], {
      cwd: call.cwd,
      env: { HOME: home, XDG_DATA_HOME: data, XDG_STATE_HOME: state },
    });
    return { code: outcome.status, stderr: outcome.stderr, stdout: outcome.stdout };
  };
  const asset = 'jsonkit-linux-x64';
  const release: ReleaseFacts = {
    build: 'distributed',
    installation: { digest: `sha256:${digestOf(oldBytes)}`, method: 'script', path: binary },
    release: { asset, channel: 'stable', repository: 'acme/jsonkit', version: '1.4.2' },
  };
  const env = { HOME: home, XDG_STATE_HOME: state };
  const result = await runSelfUpdate(
    {
      github: {
        feed: ['v1.5.0'],
        latest: 'v1.5.0',
        releases: {
          'v1.5.0': { assets: { [asset]: bytes }, sums: `${digestOf(bytes)}  ${asset}\n` },
        },
        repository: 'acme/jsonkit',
      },
      hook: 'completion',
      release,
      requests: join(root, 'requests.txt'),
    },
    { argv: ['self-update'], cwd: root, env, home, programs: { [binary]: replacing }, release },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toContain(`Updated the bash completion script in ${script}.`);
  expect(readFileSync(script, 'utf8')).toBe(bashScript('jsonkit'));
});
