/*
 * The failures of a unit write and of an installation record write that cannot reach its folder,
 * under "Writes that fail" in docs/plugins/service.md#the-children. Each case runs `notes service install` on
 * mockProcess with a sandbox whose folder is a regular file or cannot be written, and expects the
 * sentence that names the path and a step, with nothing else written.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command } from '@loomcli/core';
import { service } from '@loomcli/plugins/service';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { runOnMock } from './fixtures/in-process.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** Whether the run may write anywhere, which a read-only folder cannot stop. */
const isRoot = process.getuid?.() === 0;

/** A sandbox with a home and the XDG config and state folders. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-installation-write-'));
  roots.push(root);
  const box = {
    config: join(root, 'config'),
    home: join(root, 'home'),
    state: join(root, 'state'),
  };
  for (const folder of Object.values(box)) {
    mkdirSync(folder);
  }
  return box;
}

type Box = ReturnType<typeof sandbox>;

async function install(box: Box) {
  const app = new Application('notes', {
    description: 'Keep notes in sync.',
    plugins: [service({ label: 'com.acme.notes', run: ['serve'] })],
  }).command(new Command('serve').action(() => {}));
  const result = await runOnMock(app, {
    argv: ['service', 'install'],
    env: {
      HOME: box.home,
      XDG_CONFIG_HOME: box.config,
      XDG_RUNTIME_DIR: '/run/user/501',
      XDG_STATE_HOME: box.state,
    },
    home: box.home,
    platform: 'linux',
    program: ['/opt/notes/bin/notes'],
    programs: { loginctl: () => ({}), systemctl: () => ({}) },
    release: { build: 'distributed' },
    uid: 501,
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** Where the service plugin's installation record sits in the sandbox. */
const recordPath = (box: Box) => join(box.state, 'notes', 'installation', 'service.json');

const blocked = (path: string) =>
  `Cannot write ${path} because a file sits where a folder is needed. Remove or rename the file, then run the command again.\n`;
const unwritable = (path: string) =>
  `Cannot write ${path} because you do not have permission to write there. Make the location writable, then run the command again.\n`;

describe('a unit write that cannot reach its folder', () => {
  it('fails with the folder a file holds', async () => {
    const box = sandbox();
    writeFileSync(join(box.config, 'systemd'), '');

    const result = await install(box);

    expect(result).toEqual({
      status: 1,
      stderr: blocked(join(box.config, 'systemd', 'user')),
      stdout: '',
    });
  });

  it.skipIf(isRoot)('fails with a folder that cannot be written', async () => {
    const box = sandbox();
    chmodSync(box.config, 0o555);
    try {
      const result = await install(box);

      expect(result).toEqual({
        status: 1,
        stderr: unwritable(join(box.config, 'systemd')),
        stdout: '',
      });
    } finally {
      chmodSync(box.config, 0o755);
    }
  });
});

describe('an installation record write that cannot reach its folder', () => {
  it('fails with the folder a file holds', async () => {
    const box = sandbox();
    writeFileSync(join(box.state, 'notes'), '');

    const result = await install(box);

    expect(result).toEqual({
      status: 1,
      stderr: blocked(recordPath(box)),
      stdout: '',
    });
    expect(existsSync(join(box.config, 'systemd'))).toBe(false);
  });

  it.skipIf(isRoot)('fails with a folder that cannot be written', async () => {
    const box = sandbox();
    chmodSync(box.state, 0o555);
    try {
      const result = await install(box);

      expect(result).toEqual({ status: 1, stderr: unwritable(recordPath(box)), stdout: '' });
      expect(existsSync(join(box.config, 'systemd'))).toBe(false);
    } finally {
      chmodSync(box.state, 0o755);
    }
  });
});
