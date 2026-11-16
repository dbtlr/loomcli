/*
 * The change events of the completion, man page, and skills Commands, under "At -v and in the log"
 * in each plugin's reference and ADR-0165. Each case runs notes with the three plugins and an
 * `onLog` observer on mockProcess, its home and XDG directories in a fresh sandbox under the
 * temporary directory, which it removes after.
 *
 * - Each file a Command writes, the plugin's record file at each write included, and each startup
 *   file whose line it added or removed records `File written.`; each file it deletes records
 *   `File removed.`. A skill folder records one event under its path.
 * - A leftover staging file the plugin removes beside a file it writes records `File removed.`.
 * - A file already there with the digest it would hold, which the install leaves, records nothing.
 * - An uninstall with nothing installed records no `File removed.`.
 * - `manpage generate` records each page it writes.
 * - The Commands print no line of their own at -vv.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, plugin } from '@loomcli/core';
import type { LogEvent } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { manpage } from '@loomcli/plugins/manpage';
import { skills } from '@loomcli/plugins/skills';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox: the home and the XDG data and state homes. */
interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly data: string;
  readonly state: string;
  readonly record: string;
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'loom-installation-events-'));
  roots.push(root);
  const home = join(root, 'home');
  mkdirSync(home);
  const state = join(root, 'state');
  return {
    data: join(root, 'data'),
    home,
    record: join(state, 'notes', 'installation'),
    root,
    state,
  };
}

/** Runs `notes ...argv` and answers its status, stderr, and the events it raised, as message and path. */
async function run(box: Sandbox, argv: readonly string[]) {
  const events: LogEvent[] = [];
  const observer = plugin('fixture/observer', {
    onLog: (event) => {
      events.push(event);
      return undefined;
    },
  });
  const app = new Application('notes', {
    plugins: [
      observer,
      verbose(),
      completion(),
      manpage(),
      skills({
        skills: [
          { files: async () => [{ content: '# Notes\n', path: 'SKILL.md' }], name: 'notes' },
        ],
      }),
    ],
  });
  const mock = mockProcess({
    argv,
    cwd: box.root,
    env: { HOME: box.home, SHELL: '', XDG_DATA_HOME: box.data, XDG_STATE_HOME: box.state },
    home: box.home,
    platform: 'linux',
    // The startup file is the test user's own, so the plugin may change it.
    uid: process.getuid?.() ?? 0,
  });
  await app.run({ process: mock });
  return {
    changes: events.map(({ fields, level, message }) => {
      expect(level).toBe('info');
      return [message, fields.path];
    }),
    status: mock.exitCode,
    stderr: mock.stderr.text,
  };
}

test('completion records its script, startup file, and record file, and removes them', async () => {
  const box = sandbox();
  const script = join(box.data, 'notes', 'completion', 'notes.bash');
  const startup = join(box.home, '.bashrc');
  const record = join(box.record, 'completion.bash.json');
  const installed = await run(box, ['completion', 'install', 'bash']);
  expect(installed.status).toBe(0);
  expect(installed.changes).toEqual([
    ['File written.', record],
    ['File written.', script],
    ['File written.', startup],
    ['File written.', record],
  ]);
  // An install that finds everything in place changes nothing, so it records nothing.
  const again = await run(box, ['-vv', 'completion', 'install', 'bash']);
  expect(again.changes).toEqual([]);
  expect(again.stderr).not.toMatch(/›|┆/u);
  const removed = await run(box, ['completion', 'uninstall', 'bash']);
  expect(removed.changes).toEqual([
    ['File removed.', script],
    ['File written.', startup],
    ['File removed.', record],
  ]);
});

test('an uninstall with nothing installed records no File removed.', async () => {
  const box = sandbox();
  for (const argv of [
    ['manpage', 'uninstall'],
    ['completion', 'uninstall', 'bash'],
    ['completion', 'uninstall'],
    ['skills', 'uninstall', '--agent', 'agents'],
  ]) {
    const { changes } = await run(box, argv);
    expect(changes.filter(([message]) => message === 'File removed.')).toEqual([]);
  }
});

test('a leftover staging file beside a written file records File removed.', async () => {
  const box = sandbox();
  mkdirSync(box.record, { recursive: true });
  const staging = join(box.record, '.manpage.json.0123456789abcdef.loom-staging');
  writeFileSync(staging, 'partial');
  const { changes } = await run(box, ['manpage', 'install']);
  expect(changes[0]).toEqual(['File removed.', staging]);
  expect(changes.slice(1).every(([message]) => message === 'File written.')).toBe(true);
});

test('man pages record each page, generate included, and the record file', async () => {
  const box = sandbox();
  const page = join(box.home, '.local', 'share', 'man', 'man1', 'notes.1');
  const record = join(box.record, 'manpage.json');
  const installed = await run(box, ['manpage', 'install']);
  expect(installed.changes).toContainEqual(['File written.', page]);
  expect(installed.changes.at(0)).toEqual(['File written.', record]);
  expect(installed.changes.at(-1)).toEqual(['File written.', record]);
  const out = join(box.root, 'build');
  const generated = await run(box, ['manpage', 'generate', '--out', out]);
  expect(generated.changes).toContainEqual(['File written.', join(out, 'notes.1')]);
  expect(generated.changes.every(([message]) => message === 'File written.')).toBe(true);
});

test('a skill folder records one event under its path, globally and in a project', async () => {
  const box = sandbox();
  const folder = join(box.home, '.agents', 'skills', 'notes');
  const record = join(box.record, 'skills.agents.json');
  const installed = await run(box, ['skills', 'install', '--agent', 'agents']);
  expect(installed.status).toBe(0);
  expect(installed.changes).toEqual([
    ['File written.', record],
    ['File written.', folder],
    ['File written.', record],
  ]);
  const removed = await run(box, ['skills', 'uninstall', '--agent', 'agents']);
  expect(removed.changes).toEqual([
    ['File removed.', folder],
    ['File removed.', record],
  ]);
  // The sandbox's own `.git` ends the walk for the repository root inside it.
  mkdirSync(join(box.root, '.git'));
  const project = join(box.root, '.agents', 'skills', 'notes');
  mkdirSync(join(box.root, '.agents', 'skills'), { recursive: true });
  const leftover = join(box.root, '.agents', 'skills', '.notes.0123456789abcdef.loom-staging');
  mkdirSync(leftover);
  const placed = await run(box, ['skills', 'install', '--project', '--agent', 'agents']);
  expect(placed.status).toBe(0);
  expect(placed.changes).toEqual([
    ['File removed.', leftover],
    ['File written.', project],
  ]);
});
