/*
 * The plugins read the operator's home from `host.home` and start every child program through
 * `host.spawn`, under ADR-0107, so a run on a mock process reads the mock's folders and starts no
 * real program.
 *
 * - The service plugin calls `systemctl --user` through the mock's scripts, with
 *   `host.env` and the run's working directory, and finds the unit under `host.home`, never under
 *   `HOME` in the environment.
 * - The installing plugins' refresh pipes the new binary's output into the host's streams as
 *   `Writable`s, never `inherit`, so the child reads neither as a terminal.
 * - The completion plugin's PowerShell profile query runs the program it found on `PATH` through
 *   the mock's script, from `host.home`, with no input.
 * - The skills plugin writes under `host.home`, and the logging plugin's `~/` file starts from the
 *   destination's `home`.
 */
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

import { Application, Command } from '@loomcli/core';
import type { ProcessHandle } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { logging } from '@loomcli/plugins/logging';
import { service } from '@loomcli/plugins/service';
import { skills } from '@loomcli/plugins/skills';
import { mockProcess } from '@loomcli/testing';
import type { ProgramCall } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

import { refreshByRunning } from '../src/refresh.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** An empty temporary folder the test removes. */
function folder(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

test('the service plugin runs its managers through the mock and finds the unit under host.home', async () => {
  const calls: ProgramCall[] = [];
  const record = (answer: string) => (call: ProgramCall) => {
    calls.push(call);
    return { stdout: answer };
  };
  const mock = mockProcess({
    argv: ['service', 'status'],
    cwd: '/srv/notes',
    env: { HOME: '/home/elsewhere', PATH: '/usr/bin' },
    home: '/home/me',
    programs: {
      loginctl: record('Linger=yes\n'),
      systemctl: record('ActiveState=inactive\nMainPID=0\n'),
    },
    release: { build: 'distributed' },
  });
  const app = new Application('notes', {
    description: 'Keep notes.',
    plugins: [service({ label: 'com.acme.notes', run: ['serve'] })],
  }).command(new Command('serve', { description: 'Serve.' }).action(() => undefined));
  const code = await app.run({ process: mock });
  expect(code).toBe(0);
  expect(calls.map(({ args, command }) => [command, ...args])).toEqual([
    ['systemctl', '--user', 'show', 'com.acme.notes.service', '--property=ActiveState,MainPID'],
  ]);
  expect(calls[0]).toMatchObject({
    cwd: '/srv/notes',
    env: { HOME: '/home/elsewhere', PATH: '/usr/bin', XDG_RUNTIME_DIR: '/run/user/1000' },
  });
  expect(mock.stdout.text).toContain('not installed');
  expect(mock.stdout.text).toContain('/home/me/.config/systemd/user/com.acme.notes.service');
});

test('a refresh pipes the new binary output into the host streams as Writables, never inherit', async () => {
  const mock = mockProcess({
    programs: { '/opt/notes/bin/notes': () => ({ stdout: 'refreshed' }) },
  });
  const received: Parameters<ProcessHandle['spawn']>[2][] = [];
  const watched: ProcessHandle = Object.create(mock, {
    spawn: {
      value: (
        command: string,
        args: readonly string[],
        options: Parameters<ProcessHandle['spawn']>[2],
      ) => {
        received.push(options);
        return mock.spawn(command, args, options);
      },
    },
  });
  const app = new Application('notes').action(async ({ host, log, signal }) => {
    await refreshByRunning(
      { host, log, path: '/opt/notes/bin/notes', signal },
      {
        notStarted: () => 'not started\n',
        warning: 'The refresh failed.',
        words: ['skills', 'update'],
      },
    );
  });
  await app.run({ process: watched });
  const [options] = received;
  expect(options).toMatchObject({ cwd: '/loom-test', stderr: mock.stderr, stdout: mock.stdout });
  expect(options).not.toHaveProperty('stdin');
  expect(options).not.toHaveProperty('input');
  expect(mock.stdout.text).toBe('refreshed');
});

test('the PowerShell profile query runs the program PATH holds through the mock, from host.home', async () => {
  const bin = folder('loom-pwsh-');
  const home = folder('loom-pwsh-home-');
  const pwsh = join(bin, 'pwsh');
  writeFileSync(pwsh, '');
  chmodSync(pwsh, 0o755);
  const profile = join(home, 'profile.ps1');
  const calls: ProgramCall[] = [];
  const mock = mockProcess({
    argv: ['completion', 'install', 'pwsh'],
    env: { PATH: bin, XDG_STATE_HOME: join(home, 'state') },
    home,
    programs: {
      [pwsh]: (call) => {
        calls.push(call);
        return { stdout: `${Buffer.from(profile).toString('base64')}\n` };
      },
    },
  });
  const app = new Application('jsonkit', { description: 'Read JSON.', plugins: [completion()] });
  const code = await app.run({ process: mock });
  expect(code).toBe(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ cwd: home, input: '' });
  expect(readFileSync(profile, 'utf8')).toContain('jsonkit');
});

test('the skills plugin installs under host.home, not under HOME in the environment', async () => {
  const home = folder('loom-skills-home-');
  const elsewhere = folder('loom-skills-elsewhere-');
  const mock = mockProcess({
    argv: ['skills', 'install', '--agent', 'agents'],
    env: { HOME: elsewhere, XDG_STATE_HOME: join(home, 'state') },
    home,
    release: { build: 'distributed' },
  });
  const app = new Application('notes', {
    description: 'Keep notes.',
    plugins: [
      skills({
        skills: [
          { files: async () => [{ content: '# Notes\n', path: 'SKILL.md' }], name: 'notes' },
        ],
      }),
    ],
  });
  await app.run({ process: mock });
  expect(mock.stderr.text).toContain(`Installed notes for agents in ${home}`);
  expect(existsSync(join(elsewhere, '.agents'))).toBe(false);
  expect(existsSync(join(home, '.agents', 'skills', 'notes'))).toBe(true);
});

test("the logging plugin's ~/ file starts from the destination's home", async () => {
  const home = folder('loom-logging-home-');
  mkdirSync(join(home, 'logs'));
  const mock = mockProcess({ argv: [], env: { HOME: '/home/elsewhere' }, home });
  const app = new Application('notes', {
    plugins: [logging({ file: '~/logs/notes.jsonl' })],
  }).action(({ log }) => {
    log.info('hello');
  });
  await app.run({ process: mock });
  expect(readFileSync(join(home, 'logs', 'notes.jsonl'), 'utf8')).toContain('"message":"hello"');
});
