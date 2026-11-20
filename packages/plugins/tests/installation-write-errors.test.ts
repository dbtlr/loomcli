/*
 * The failures of an installed path or an installation record that a run cannot reach, under "A
 * path that cannot be reached" and "A failed write" in docs/core/installation-record.md#installed-files
 * and "Paths that fail" in docs/plugins/service.md#the-children. Each case runs a plugin's real Command on mockProcess in a sandbox
 * with a private HOME and XDG folders, where a file sits in place of a folder the run needs, or a
 * folder cannot be written. The run fails with the sentence that names the path and a step, before
 * it changes anything: the plugin's file stays as it was, so the installed files stay owned.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command } from '@loomcli/core';
import { service } from '@loomcli/plugins/service';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { run as runCompletion } from './fixtures/completion-install-app.ts';
import { runOnMock } from './fixtures/in-process.ts';
import { run as runManpage } from './fixtures/manpage-app.ts';
import { run as runSkills } from './fixtures/skills-run-app.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** Whether the run may write anywhere, which a read-only folder cannot stop. */
const isRoot = process.getuid?.() === 0;

/** A sandbox with a home, a working folder, and the XDG config, data, and state folders. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-installation-reach-'));
  roots.push(root);
  const box = {
    config: join(root, 'config'),
    data: join(root, 'data'),
    home: join(root, 'home'),
    loaded: join(root, 'loaded.log'),
    state: join(root, 'state'),
    work: join(root, 'work'),
  };
  for (const folder of [box.config, box.data, box.home, box.state, box.work]) {
    mkdirSync(folder);
  }
  return box;
}

type Box = ReturnType<typeof sandbox>;

/** The private HOME and XDG folders every run reads. */
function environment(box: Box) {
  return {
    HOME: box.home,
    XDG_CONFIG_HOME: box.config,
    XDG_DATA_HOME: box.data,
    XDG_RUNTIME_DIR: '/run/user/501',
    XDG_STATE_HOME: box.state,
  };
}

/** Moves the folder at `path` aside and puts an empty file in its place. */
function block(path: string): void {
  renameSync(path, `${path}.away`);
  writeFileSync(path, '');
}

/** Removes the file `block` put at `path` and moves the folder back. */
function unblock(path: string): void {
  rmSync(path);
  renameSync(`${path}.away`, path);
}

/** Runs `check` with the folder at `path` read-only, restoring its mode afterward. */
async function readOnly<Result>(path: string, check: () => Promise<Result>): Promise<Result> {
  chmodSync(path, 0o555);
  try {
    return await check();
  } finally {
    chmodSync(path, 0o755);
  }
}

/** Runs `check` with the folder at `path` unsearchable, so nothing below it can be reached. */
async function unsearchable<Result>(path: string, check: () => Promise<Result>): Promise<Result> {
  chmodSync(path, 0o600);
  try {
    return await check();
  } finally {
    chmodSync(path, 0o755);
  }
}

/** Every file below `folder` with its content, which a failed run must leave as it found it. */
function contents(folder: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      found[path] = readFileSync(path, 'utf8');
    }
  }
  return found;
}

const blocked = (path: string) =>
  `Cannot reach ${path} because a file sits where one of its folders is needed. Remove or rename that file, then run the command again.\n`;
const unwritable = (path: string) =>
  `Cannot write ${path} because you do not have permission to write there. Make the location writable, then run the command again.\n`;

const unreadable = (path: string) =>
  `Cannot read ${path} because you do not have permission to reach or read it. Make it readable, then run the command again.\n`;

/** The failure a run ends with, and nothing on stdout. */
const failure = (stderr: string) => ({ status: 1, stderr, stdout: '' });

/** Runs `notes service <argv>` on linux, recording each manager call in `calls`. */
async function runService(box: Box, argv: string[], calls: string[] = []) {
  const app = new Application('notes', {
    description: 'Keep notes in sync.',
    plugins: [service({ label: 'com.acme.notes', run: ['serve'] })],
  }).command(new Command('serve').action(() => {}));
  const answer = (call: { readonly args: readonly string[] }) => {
    calls.push(call.args.join(' '));
    return {};
  };
  const result = await runOnMock(app, {
    argv: ['service', ...argv],
    env: environment(box),
    home: box.home,
    platform: 'linux',
    program: ['/opt/notes/bin/notes'],
    programs: { loginctl: answer, systemctl: answer },
    release: { build: 'distributed' },
    uid: 501,
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

const unitFolder = (box: Box) => join(box.config, 'systemd', 'user');
const unitPath = (box: Box) => join(unitFolder(box), 'com.acme.notes.service');
const serviceRecord = (box: Box) => join(box.state, 'notes', 'installation', 'service.json');

const runShells = (box: Box, args: string[]) =>
  runCompletion(['completion', ...args], {
    cwd: box.work,
    env: environment(box),
    uid: process.getuid?.() ?? 0,
  });

const bashScript = (box: Box) => join(box.data, 'jsonkit', 'completion', 'jsonkit.bash');
const fishScript = (box: Box) => join(box.config, 'fish', 'completions', 'jsonkit.fish');

const runPages = (box: Box, args: string[], version?: string) =>
  runManpage(['manpage', ...args], {
    cwd: box.work,
    env: environment(box),
    ...(version === undefined ? {} : { version }),
  });

const pagesFolder = (box: Box) => join(box.home, '.local', 'share', 'man');

const notesSkill = {
  files: [{ content: '# Notes\n', path: 'SKILL.md' }],
  name: 'notes',
};

const runSkillsIn = (box: Box, args: string[]) =>
  runSkills(['skills', ...args], {
    cwd: box.work,
    env: environment(box),
    loaded: box.loaded,
    skills: [notesSkill],
  });

const claudeSkills = (box: Box) => join(box.home, '.claude', 'skills');

describe('service', () => {
  it('install names the unit when a file holds the place of its folder', async () => {
    const box = sandbox();
    writeFileSync(join(box.config, 'systemd'), '');

    await expect(runService(box, ['install'])).resolves.toEqual(failure(blocked(unitPath(box))));
    expect(existsSync(serviceRecord(box))).toBe(false);
  });

  it.skipIf(isRoot)('install names the folder it cannot create', async () => {
    const box = sandbox();

    const result = await readOnly(box.config, () => runService(box, ['install']));

    expect(result).toEqual(failure(unwritable(join(box.config, 'systemd'))));
  });

  it.skipIf(isRoot)('install names the unit its folder cannot take', async () => {
    const box = sandbox();
    mkdirSync(unitFolder(box), { recursive: true });

    const result = await readOnly(unitFolder(box), () => runService(box, ['install']));

    expect(result).toEqual(failure(unwritable(unitPath(box))));
    expect(readdirSync(unitFolder(box))).toEqual([]);
  });

  it.skipIf(isRoot)('install names the unit its config folder will not let it reach', async () => {
    const box = sandbox();

    const result = await unsearchable(box.config, () => runService(box, ['install']));

    expect(result).toEqual(failure(unreadable(unitPath(box))));
    expect(existsSync(serviceRecord(box))).toBe(false);
  });

  it.skipIf(isRoot)('install names the record its state folder will not let it reach', async () => {
    const box = sandbox();

    const result = await unsearchable(box.state, () => runService(box, ['install']));

    expect(result).toEqual(failure(unreadable(serviceRecord(box))));
    expect(existsSync(join(box.config, 'systemd'))).toBe(false);
  });

  it('install names the record when a file holds the place of its folder', async () => {
    const box = sandbox();
    writeFileSync(join(box.state, 'notes'), '');

    await expect(runService(box, ['install'])).resolves.toEqual(
      failure(blocked(serviceRecord(box))),
    );
    expect(existsSync(join(box.config, 'systemd'))).toBe(false);
  });

  it.skipIf(isRoot)('install names the record whose folder cannot be written', async () => {
    const box = sandbox();

    const result = await readOnly(box.state, () => runService(box, ['install']));

    expect(result).toEqual(failure(unwritable(serviceRecord(box))));
    expect(existsSync(join(box.config, 'systemd'))).toBe(false);
  });

  it('uninstall and install over a blocked unit folder fail and keep the record', async () => {
    const box = sandbox();
    await expect(runService(box, ['install'])).resolves.toMatchObject({ status: 0 });
    const before = contents(box.state);
    block(join(box.config, 'systemd'));
    const calls: string[] = [];

    await expect(runService(box, ['uninstall'], calls)).resolves.toEqual(
      failure(blocked(unitPath(box))),
    );
    await expect(runService(box, ['install'], calls)).resolves.toEqual(
      failure(blocked(unitPath(box))),
    );

    expect(calls).toEqual([]);
    expect(contents(box.state)).toEqual(before);
    unblock(join(box.config, 'systemd'));
    expect(existsSync(unitPath(box))).toBe(true);
  });
});

describe('completion', () => {
  it('uninstall and install over a blocked script folder fail and keep the record and line', async () => {
    const box = sandbox();
    await expect(runShells(box, ['install', 'bash'])).resolves.toMatchObject({ status: 0 });
    const before = { home: contents(box.home), state: contents(box.state) };
    block(join(box.data, 'jsonkit'));

    await expect(runShells(box, ['uninstall', 'bash'])).resolves.toEqual(
      failure(blocked(bashScript(box))),
    );
    await expect(runShells(box, ['install', 'bash'])).resolves.toEqual(
      failure(blocked(bashScript(box))),
    );

    expect({ home: contents(box.home), state: contents(box.state) }).toEqual(before);
    unblock(join(box.data, 'jsonkit'));
    expect(existsSync(bashScript(box))).toBe(true);
  });

  it.skipIf(isRoot)(
    'install over an installed script it cannot read names the script',
    async () => {
      const box = sandbox();
      await expect(runShells(box, ['install', 'bash'])).resolves.toMatchObject({ status: 0 });
      const before = { home: contents(box.home), state: contents(box.state) };
      chmodSync(bashScript(box), 0o000);
      try {
        await expect(runShells(box, ['install', 'bash'])).resolves.toEqual(
          failure(unreadable(bashScript(box))),
        );
      } finally {
        chmodSync(bashScript(box), 0o644);
      }
      expect({ home: contents(box.home), state: contents(box.state) }).toEqual(before);
    },
  );

  it('uninstall of every shell checks each before it removes any', async () => {
    const box = sandbox();
    await expect(runShells(box, ['install', 'bash'])).resolves.toMatchObject({ status: 0 });
    await expect(runShells(box, ['install', 'fish'])).resolves.toMatchObject({ status: 0 });
    const before = {
      config: contents(box.config),
      data: contents(box.data),
      home: contents(box.home),
      state: contents(box.state),
    };
    block(join(box.config, 'fish', 'completions'));

    await expect(runShells(box, ['uninstall'])).resolves.toEqual(failure(blocked(fishScript(box))));

    unblock(join(box.config, 'fish', 'completions'));
    expect({
      config: contents(box.config),
      data: contents(box.data),
      home: contents(box.home),
      state: contents(box.state),
    }).toEqual(before);
  });

  it('uninstall of one shell reads every other shell before it hands any folder over', async () => {
    const box = sandbox();
    for (const shell of ['bash', 'zsh', 'fish']) {
      await expect(runShells(box, ['install', shell])).resolves.toMatchObject({ status: 0 });
    }
    const before = {
      config: contents(box.config),
      data: contents(box.data),
      home: contents(box.home),
      state: contents(box.state),
    };
    block(join(box.config, 'fish'));

    await expect(runShells(box, ['uninstall', 'bash'])).resolves.toEqual(
      failure(blocked(fishScript(box))),
    );

    unblock(join(box.config, 'fish'));
    expect({
      config: contents(box.config),
      data: contents(box.data),
      home: contents(box.home),
      state: contents(box.state),
    }).toEqual(before);
  });
});

describe('man pages', () => {
  it('uninstall, update, and install over a blocked page folder fail and keep the record', async () => {
    const box = sandbox();
    await expect(runPages(box, ['install'])).resolves.toMatchObject({ status: 0 });
    const before = contents(box.state);
    const installed = contents(pagesFolder(box));
    // The record lists the root page first, and the run reads it first.
    const page = join(pagesFolder(box), 'man1', 'notes.1');
    block(pagesFolder(box));

    await expect(runPages(box, ['uninstall'])).resolves.toEqual(failure(blocked(page)));
    await expect(runPages(box, ['update'], '2.0.0')).resolves.toEqual(failure(blocked(page)));
    await expect(runPages(box, ['install'], '2.0.0')).resolves.toEqual(failure(blocked(page)));

    expect(contents(box.state)).toEqual(before);
    unblock(pagesFolder(box));
    expect(contents(pagesFolder(box))).toEqual(installed);
  });
});

describe('skills', () => {
  it('install names the skill folder when a file holds the place of the skills folder', async () => {
    const box = sandbox();
    mkdirSync(join(box.home, '.claude'));
    writeFileSync(claudeSkills(box), '');

    await expect(runSkillsIn(box, ['install'])).resolves.toEqual(
      failure(blocked(join(claudeSkills(box), 'notes'))),
    );
    expect(existsSync(join(box.state, 'notes'))).toBe(false);
    expect(existsSync(join(box.home, '.agents'))).toBe(false);
  });

  it.skipIf(isRoot)('install names the skill folder its skills folder cannot take', async () => {
    const box = sandbox();
    mkdirSync(claudeSkills(box), { recursive: true });

    const result = await readOnly(claudeSkills(box), () =>
      runSkillsIn(box, ['install', '--agent', 'claude']),
    );

    expect(result).toEqual(failure(unwritable(join(claudeSkills(box), 'notes'))));
    expect(readdirSync(claudeSkills(box))).toEqual([]);
  });

  it.skipIf(isRoot)(
    'install, status, and uninstall name a skills home they cannot search',
    async () => {
      const box = sandbox();
      mkdirSync(claudeSkills(box), { recursive: true });
      const home = join(box.home, '.claude');

      const results = await unsearchable(home, async () => [
        await runSkillsIn(box, ['install']),
        await runSkillsIn(box, ['status']),
        await runSkillsIn(box, ['uninstall']),
      ]);

      expect(results).toEqual([
        failure(unreadable(claudeSkills(box))),
        failure(unreadable(claudeSkills(box))),
        failure(unreadable(claudeSkills(box))),
      ]);
      expect(existsSync(join(box.state, 'notes'))).toBe(false);
    },
  );

  it('uninstall, status, and install over a blocked skills folder fail and keep the records', async () => {
    const box = sandbox();
    await expect(runSkillsIn(box, ['install'])).resolves.toMatchObject({ status: 0 });
    const before = contents(box.state);
    block(claudeSkills(box));
    const folder = join(claudeSkills(box), 'notes');

    await expect(runSkillsIn(box, ['uninstall'])).resolves.toEqual(failure(blocked(folder)));
    await expect(runSkillsIn(box, ['status'])).resolves.toEqual(failure(blocked(folder)));
    await expect(runSkillsIn(box, ['install'])).resolves.toEqual(failure(blocked(folder)));

    expect(contents(box.state)).toEqual(before);
    unblock(claudeSkills(box));
    expect(existsSync(join(folder, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(box.home, '.agents', 'skills', 'notes', 'SKILL.md'))).toBe(true);
  });
});
