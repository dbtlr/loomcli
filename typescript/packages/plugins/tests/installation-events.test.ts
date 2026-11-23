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
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, plugin } from '@loomcli/core';
import type { LogEvent } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { manpage } from '@loomcli/plugins/manpage';
import { skills } from '@loomcli/plugins/skills';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { lockFolder } from './fixtures/locked-folder.ts';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<{ rmSync: typeof rmSync }>();
  return { ...actual, rmSync: vi.fn(actual.rmSync) };
});

const roots: string[] = [];

afterEach(() => {
  vi.mocked(rmSync).mockReset();
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

/**
 * Runs `notes ...argv` and answers its status, stderr, and the events it raised, as message and path.
 * A run that is expected to fail names more skills than one and leaves the failure's own event out.
 */
async function run(
  box: Sandbox,
  argv: readonly string[],
  options: { readonly skillNames?: readonly string[]; readonly fails?: boolean } = {},
) {
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
        skills: (options.skillNames ?? ['notes']).map((name) => ({
          files: async () => [{ content: '# Notes\n', path: 'SKILL.md' }],
          name,
        })),
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
    changes: events
      .filter(({ level }) => options.fails !== true || level === 'info')
      .map(({ fields, level, message }) => {
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

// A superuser removes any folder, so the case needs an ordinary user.
test.skipIf(process.getuid?.() === 0)(
  'an uninstall of a folder holding a subfolder it may not empty fails before it removes any',
  async () => {
    const box = sandbox();
    const skillNames = ['notes', 'other'];
    const skillsFolder = join(box.home, '.agents', 'skills');
    const second = join(skillsFolder, 'other');
    const installed = await run(box, ['skills', 'install', '--agent', 'agents'], { skillNames });
    expect(installed.status).toBe(0);
    const locked = join(second, 'locked');
    mkdirSync(locked);
    writeFileSync(join(locked, 'kept'), '');
    const unlock = lockFolder(box.root, locked, 0o555);
    try {
      const removed = await run(box, ['skills', 'uninstall', '--agent', 'agents'], {
        fails: true,
        skillNames,
      });
      expect(removed.status).toBe(1);
      expect(removed.stderr).toBe(
        `Cannot write ${locked} because you do not have permission to write or search there. Make the location writable and searchable, then run the command again.\n`,
      );
      expect(removed.changes).toEqual([]);
      expect(readdirSync(skillsFolder).toSorted()).toEqual(['notes', 'other']);
      expect(readdirSync(locked)).toEqual(['kept']);
    } finally {
      unlock();
    }
  },
);

test('an uninstall whose second removal fails records each folder it had removed', async () => {
  const box = sandbox();
  const skillNames = ['notes', 'other'];
  const first = join(box.home, '.agents', 'skills', 'notes');
  const skillsFolder = join(box.home, '.agents', 'skills');
  const installed = await run(box, ['skills', 'install', '--agent', 'agents'], { skillNames });
  expect(installed.status).toBe(0);
  const actual = vi.mocked(rmSync).getMockImplementation();
  vi.mocked(rmSync).mockImplementation((path, options) => {
    // The removal of the second folder, claimed under its retired name, fails as a refused call does.
    if (/\/\.other\.[\da-f]{16}\.loom-retired$/u.test(String(path))) {
      throw Object.assign(new Error('refused'), { code: 'EACCES' });
    }
    actual?.(path, options);
  });
  const removed = await run(box, ['skills', 'uninstall', '--agent', 'agents'], {
    fails: true,
    skillNames,
  });
  vi.mocked(rmSync).mockReset();
  expect(removed.status).toBe(1);
  expect(removed.changes).toEqual([['File removed.', first]]);
  // The removal claimed the folder under a retired name before it failed inside it.
  expect(readdirSync(skillsFolder)).toEqual([
    expect.stringMatching(/^\.other\.[\da-f]{16}\.loom-retired$/u),
  ]);
});
