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
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command } from '@loomcli/core';
import { service } from '@loomcli/plugins/service';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { run as runCompletion } from './fixtures/completion-install-app.ts';
import { runOnMock } from './fixtures/in-process.ts';
import { lockFolder } from './fixtures/locked-folder.ts';
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
    root,
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

/** Runs `check` with the folder at `path` at `mode`, restoring the mode it had afterward. */
async function withMode<Result>(
  path: string,
  mode: number,
  check: () => Promise<Result>,
): Promise<Result> {
  const had = lstatSync(path).mode & 0o7777;
  chmodSync(path, mode);
  try {
    return await check();
  } finally {
    chmodSync(path, had);
  }
}

/** Runs `check` with the folder at `path` read-only, restoring its mode afterward. */
const readOnly = <Result>(path: string, check: () => Promise<Result>) =>
  withMode(path, 0o555, check);

/** Runs `check` with the folder at `path` unsearchable, so nothing below it can be reached. */
const unsearchable = <Result>(path: string, check: () => Promise<Result>) =>
  withMode(path, 0o600, check);

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

/**
 * Every entry below `folder` with its kind, its permission bits, and a file's content, so a failed
 * run is seen to leave folders, modes, and files as it found them.
 */
function tree(folder: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const mode = (lstatSync(path).mode & 0o777).toString(8);
    found[path] = entry.isFile()
      ? `${mode} ${readFileSync(path, 'utf8')}`
      : `${mode} ${entry.isDirectory() ? 'folder' : 'link'}`;
  }
  return found;
}

/** Puts a symbolic link at `path` to a folder that does not exist. */
function dangle(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  symlinkSync(`${path}.gone`, path);
}

const blocked = (path: string) =>
  `Cannot reach ${path} because a file sits where one of its folders is needed. Remove or rename that file, then run the command again.\n`;
const unwritable = (path: string) =>
  `Cannot write ${path} because you do not have permission to write or search there. Make the location writable and searchable, then run the command again.\n`;

const dangling = (path: string) =>
  `Cannot reach ${path} because one of its folders is a link to a folder that does not exist. Create that folder or remove the link, then run the command again.\n`;

const unreadable = (path: string) =>
  `Cannot read ${path} because you do not have permission to reach or read it. Make it readable, then run the command again.\n`;

/** The failure a run ends with, and nothing on stdout. */
const failure = (stderr: string) => ({ status: 1, stderr, stdout: '' });

/**
 * Runs `notes service <argv>` on linux, recording each manager call in `calls`, with the console
 * output path `output` when one is given.
 */
async function runService(box: Box, argv: string[], calls: string[] = [], output?: string) {
  const app = new Application('notes', {
    description: 'Keep notes in sync.',
    plugins: [
      service({
        label: 'com.acme.notes',
        run: ['serve'],
        ...(output === undefined ? {} : { output }),
      }),
    ],
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

/**
 * The pending record a run leaves when its committed write is refused, from the committed record of
 * the same install: each file written, none held before.
 */
const pendingWrite = (committed: string) =>
  committed
    .replace('"state":"committed"', '"state":"pending"')
    .replaceAll(/"digest":(?<digest>"sha256:[\da-f]+")/gu, '"prior":null,"intended":$<digest>');

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

const runPages = (box: Box, args: string[], version?: string, commands?: readonly string[]) =>
  runManpage(['manpage', ...args], {
    cwd: box.work,
    env: environment(box),
    ...(version === undefined ? {} : { version }),
    ...(commands === undefined ? {} : { commands }),
  });

const pagesFolder = (box: Box) => join(box.home, '.local', 'share', 'man');

const notesSkill = {
  files: [{ content: '# Notes\n', path: 'SKILL.md' }],
  name: 'notes',
};

const runSkillsIn = (box: Box, args: string[], skill = notesSkill) =>
  runSkills(['skills', ...args], {
    cwd: box.work,
    env: environment(box),
    loaded: box.loaded,
    skills: [skill],
  });

const notesSkillTwo = {
  files: [{ content: '# Notes, second version\n', path: 'SKILL.md' }],
  name: 'notes',
};

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

    expect(result).toEqual(failure(unwritable(join(box.state, 'notes'))));
    expect(existsSync(join(box.config, 'systemd'))).toBe(false);
  });

  it.skipIf(isRoot)(
    'install with a leftover record staging file its folder cannot give up names the record',
    async () => {
      const box = sandbox();
      const folder = join(box.state, 'notes', 'installation');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, '.service.json.0123456789abcdef.loom-staging'), '{"format":1');
      const before = contents(box.state);
      const calls: string[] = [];

      const result = await readOnly(folder, () => runService(box, ['install'], calls));

      expect(result).toEqual(failure(unwritable(serviceRecord(box))));
      expect(calls).toEqual([]);
      expect(contents(box.state)).toEqual(before);
      expect(existsSync(join(box.config, 'systemd'))).toBe(false);
    },
  );

  it.skipIf(isRoot)(
    'install with output set names the unit its folder cannot take before it creates the output folder',
    async () => {
      const box = sandbox();
      mkdirSync(unitFolder(box), { recursive: true });

      const result = await readOnly(unitFolder(box), () =>
        runService(box, ['install'], [], 'logs/console.log'),
      );

      expect(result).toEqual(failure(unwritable(unitPath(box))));
      expect(existsSync(join(box.home, 'logs'))).toBe(false);
    },
  );

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

  it.skipIf(isRoot)(
    'uninstall names the unit its folder cannot give up before it stops the service',
    async () => {
      const box = sandbox();
      await expect(runService(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const before = { config: contents(box.config), state: contents(box.state) };
      const calls: string[] = [];

      const result = await readOnly(unitFolder(box), () => runService(box, ['uninstall'], calls));

      expect(result).toEqual(failure(unwritable(unitPath(box))));
      expect(calls).toEqual([]);
      expect({ config: contents(box.config), state: contents(box.state) }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'install over an earlier unit names the new unit its folder cannot take before it stops the earlier one',
    async () => {
      const box = sandbox();
      await expect(runService(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const earlier = join(unitFolder(box), 'com.acme.earlier.service');
      renameSync(unitPath(box), earlier);
      const recorded = readFileSync(serviceRecord(box), 'utf8');
      writeFileSync(serviceRecord(box), recorded.replace(unitPath(box), earlier));
      const before = { config: contents(box.config), state: contents(box.state) };
      const calls: string[] = [];

      const result = await readOnly(unitFolder(box), () => runService(box, ['install'], calls));

      expect(result).toEqual(failure(unwritable(unitPath(box))));
      expect(calls).toEqual([]);
      expect({ config: contents(box.config), state: contents(box.state) }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'install over an earlier unit names the record its folder cannot take before it stops the earlier one',
    async () => {
      const box = sandbox();
      await expect(runService(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const earlier = join(unitFolder(box), 'com.acme.earlier.service');
      renameSync(unitPath(box), earlier);
      const recorded = readFileSync(serviceRecord(box), 'utf8');
      writeFileSync(serviceRecord(box), recorded.replace(unitPath(box), earlier));
      const before = { config: contents(box.config), state: contents(box.state) };
      const calls: string[] = [];

      const result = await readOnly(join(box.state, 'notes', 'installation'), () =>
        runService(box, ['install'], calls),
      );

      expect(result).toEqual(failure(unwritable(serviceRecord(box))));
      expect(calls).toEqual([]);
      expect({ config: contents(box.config), state: contents(box.state) }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'install over an earlier unit in a folder it cannot give up names that unit before it stops it',
    async () => {
      const box = sandbox();
      await expect(runService(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const oldFolder = join(box.config, 'old-units');
      mkdirSync(oldFolder);
      const earlier = join(oldFolder, 'com.acme.notes.service');
      renameSync(unitPath(box), earlier);
      const recorded = readFileSync(serviceRecord(box), 'utf8');
      writeFileSync(serviceRecord(box), recorded.replace(unitPath(box), earlier));
      const before = { config: tree(box.config), state: tree(box.state) };
      const calls: string[] = [];

      const result = await readOnly(oldFolder, () => runService(box, ['install'], calls));

      expect(result).toEqual(failure(unwritable(earlier)));
      expect(calls).toEqual([]);
      expect({ config: tree(box.config), state: tree(box.state) }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'uninstall with a pending record and a unit folder it cannot write leaves the record pending',
    async () => {
      const box = sandbox();
      await expect(runService(box, ['install'])).resolves.toMatchObject({ status: 0 });
      writeFileSync(serviceRecord(box), pendingWrite(readFileSync(serviceRecord(box), 'utf8')));
      const before = { config: tree(box.config), state: tree(box.state) };
      const calls: string[] = [];

      const result = await readOnly(unitFolder(box), () => runService(box, ['uninstall'], calls));

      expect(result).toEqual(failure(unwritable(unitPath(box))));
      expect(calls).toEqual([]);
      expect({ config: tree(box.config), state: tree(box.state) }).toEqual(before);
    },
  );

  it('install after a commit the record folder refused reloads the manager and commits the record', async () => {
    const box = sandbox();
    await expect(runService(box, ['install'])).resolves.toMatchObject({ status: 0 });
    const committed = readFileSync(serviceRecord(box), 'utf8');
    writeFileSync(serviceRecord(box), pendingWrite(committed));
    const calls: string[] = [];

    await expect(runService(box, ['install'], calls)).resolves.toMatchObject({ status: 0 });

    expect(calls).toContain('--user daemon-reload');
    expect(readFileSync(serviceRecord(box), 'utf8')).toBe(committed);
  });

  it.skipIf(isRoot)(
    'install after a refused commit names the record whose folder still refuses it and calls no manager',
    async () => {
      const box = sandbox();
      await expect(runService(box, ['install'])).resolves.toMatchObject({ status: 0 });
      writeFileSync(serviceRecord(box), pendingWrite(readFileSync(serviceRecord(box), 'utf8')));
      const before = { config: contents(box.config), state: contents(box.state) };
      const calls: string[] = [];

      const result = await readOnly(join(box.state, 'notes', 'installation'), () =>
        runService(box, ['install'], calls),
      );

      expect(result).toEqual(failure(unwritable(serviceRecord(box))));
      expect(calls).toEqual([]);
      expect({ config: contents(box.config), state: contents(box.state) }).toEqual(before);
    },
  );
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

  it('install names the script whose folder is a link to a folder that is gone', async () => {
    const box = sandbox();
    dangle(join(box.data, 'jsonkit'));
    const before = tree(box.data);

    await expect(runShells(box, ['install', 'bash'])).resolves.toEqual(
      failure(dangling(bashScript(box))),
    );

    expect(tree(box.data)).toEqual(before);
    expect(existsSync(join(box.home, '.bashrc'))).toBe(false);
  });

  it('install, update, and uninstall name the zsh startup file when a file holds the place of ZDOTDIR', async () => {
    const box = sandbox();
    const zdotdir = join(box.home, 'zsh');
    mkdirSync(zdotdir);
    const env = { ...environment(box), ZDOTDIR: zdotdir };
    const runZsh = (args: string[]) =>
      runCompletion(['completion', ...args], { cwd: box.work, env, uid: process.getuid?.() ?? 0 });
    await expect(runZsh(['install', 'zsh'])).resolves.toMatchObject({ status: 0 });
    block(zdotdir);
    const before = {
      data: contents(box.data),
      home: contents(box.home),
      state: contents(box.state),
    };
    const startup = join(zdotdir, '.zshrc');

    await expect(runZsh(['install', 'zsh'])).resolves.toEqual(failure(blocked(startup)));
    await expect(runZsh(['update'])).resolves.toEqual(failure(blocked(startup)));
    await expect(runZsh(['uninstall', 'zsh'])).resolves.toEqual(failure(blocked(startup)));

    expect({
      data: contents(box.data),
      home: contents(box.home),
      state: contents(box.state),
    }).toEqual(before);
  });

  it.skipIf(isRoot)(
    'uninstall of the last shell names the record it cannot delete and removes nothing',
    async () => {
      const box = sandbox();
      await expect(runShells(box, ['install', 'bash'])).resolves.toMatchObject({ status: 0 });
      const before = {
        data: contents(box.data),
        home: contents(box.home),
        state: contents(box.state),
      };
      const record = join(box.state, 'jsonkit', 'installation');

      const result = await readOnly(record, () => runShells(box, ['uninstall', 'bash']));

      expect(result).toEqual(failure(unwritable(join(record, 'completion.bash.json'))));
      expect({
        data: contents(box.data),
        home: contents(box.home),
        state: contents(box.state),
      }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'uninstall of every shell names the script a folder cannot give up and removes none',
    async () => {
      const box = sandbox();
      await expect(runShells(box, ['install', 'bash'])).resolves.toMatchObject({ status: 0 });
      await expect(runShells(box, ['install', 'fish'])).resolves.toMatchObject({ status: 0 });
      const before = {
        config: contents(box.config),
        data: contents(box.data),
        home: contents(box.home),
        state: contents(box.state),
      };

      const result = await readOnly(join(box.config, 'fish', 'completions'), () =>
        runShells(box, ['uninstall']),
      );

      expect(result).toEqual(failure(unwritable(fishScript(box))));
      expect({
        config: contents(box.config),
        data: contents(box.data),
        home: contents(box.home),
        state: contents(box.state),
      }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'update of every shell names the script a folder cannot take and writes none',
    async () => {
      const box = sandbox();
      await expect(runShells(box, ['install', 'bash'])).resolves.toMatchObject({ status: 0 });
      await expect(runShells(box, ['install', 'fish'])).resolves.toMatchObject({ status: 0 });
      rmSync(bashScript(box));
      rmSync(fishScript(box));
      const before = {
        config: contents(box.config),
        data: contents(box.data),
        home: contents(box.home),
        state: contents(box.state),
      };

      const result = await readOnly(join(box.config, 'fish', 'completions'), () =>
        runShells(box, ['update']),
      );

      expect(result).toEqual(failure(unwritable(fishScript(box))));
      expect({
        config: contents(box.config),
        data: contents(box.data),
        home: contents(box.home),
        state: contents(box.state),
      }).toEqual(before);
    },
  );

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

  it('a fresh install over a blocked page folder keeps a leftover staging file of the record', async () => {
    const box = sandbox();
    const record = join(box.state, 'notes', 'installation');
    mkdirSync(record, { recursive: true });
    writeFileSync(join(record, '.manpage.json.0123456789abcdef.loom-staging'), '{"format":1');
    mkdirSync(join(box.home, '.local', 'share'), { recursive: true });
    writeFileSync(pagesFolder(box), '');
    const before = contents(box.state);

    await expect(runPages(box, ['install'])).resolves.toEqual(
      failure(blocked(join(pagesFolder(box), 'man1', 'notes.1'))),
    );

    expect(contents(box.state)).toEqual(before);
  });

  it.skipIf(isRoot)(
    'a refused install with a leftover record staging file its folder cannot give up names the record',
    async () => {
      const box = sandbox();
      const record = join(box.state, 'notes', 'installation');
      mkdirSync(record, { recursive: true });
      writeFileSync(join(record, '.manpage.json.0123456789abcdef.loom-staging'), '{"format":1');
      mkdirSync(join(pagesFolder(box), 'man1'), { recursive: true });
      writeFileSync(join(pagesFolder(box), 'man1', 'notes.1'), 'someone else\n');
      const before = { pages: contents(pagesFolder(box)), state: contents(box.state) };

      const result = await readOnly(record, () => runPages(box, ['install']));

      expect(result).toEqual(failure(unwritable(join(record, 'manpage.json'))));
      expect({ pages: contents(pagesFolder(box)), state: contents(box.state) }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'uninstall names a folder it created whose own folder cannot give it up and removes none',
    async () => {
      const box = sandbox();
      await expect(runPages(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const share = join(box.home, '.local', 'share');
      const before = { home: tree(box.home), state: tree(box.state) };

      const result = await readOnly(share, () => runPages(box, ['uninstall']));

      expect(result).toEqual(failure(unwritable(pagesFolder(box))));
      expect({ home: tree(box.home), state: tree(box.state) }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'uninstall with a pending record and a page folder it cannot write leaves the record pending',
    async () => {
      const box = sandbox();
      await expect(runPages(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const record = join(box.state, 'notes', 'installation', 'manpage.json');
      writeFileSync(record, pendingWrite(readFileSync(record, 'utf8')));
      const before = { home: tree(box.home), state: tree(box.state) };
      const folder = join(pagesFolder(box), 'man1');

      const result = await readOnly(folder, () => runPages(box, ['uninstall']));

      expect(result).toEqual(failure(unwritable(join(folder, 'notes.1'))));
      expect({ home: tree(box.home), state: tree(box.state) }).toEqual(before);
    },
  );

  it('install names the page whose folder is a link to a folder that is gone', async () => {
    const box = sandbox();
    dangle(pagesFolder(box));
    const before = tree(box.home);

    await expect(runPages(box, ['install'])).resolves.toEqual(
      failure(dangling(join(pagesFolder(box), 'man1', 'notes.1'))),
    );

    expect(tree(box.home)).toEqual(before);
    expect(existsSync(join(box.state, 'notes'))).toBe(false);
  });

  it('uninstall names the page whose folder is a link to a folder that is gone and keeps the record', async () => {
    const box = sandbox();
    await expect(runPages(box, ['install'])).resolves.toMatchObject({ status: 0 });
    renameSync(pagesFolder(box), `${pagesFolder(box)}.away`);
    dangle(pagesFolder(box));
    const before = contents(box.state);

    await expect(runPages(box, ['uninstall'])).resolves.toEqual(
      failure(dangling(join(pagesFolder(box), 'man1', 'notes.1'))),
    );

    expect(contents(box.state)).toEqual(before);
  });

  it.skipIf(isRoot)(
    'uninstall names the page its folder cannot give up and removes none',
    async () => {
      const box = sandbox();
      await expect(runPages(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const before = { pages: contents(pagesFolder(box)), state: contents(box.state) };
      const folder = join(pagesFolder(box), 'man1');

      const result = await readOnly(folder, () => runPages(box, ['uninstall']));

      expect(result).toEqual(failure(unwritable(join(folder, 'notes.1'))));
      expect({ pages: contents(pagesFolder(box)), state: contents(box.state) }).toEqual(before);
    },
  );

  it.skipIf(isRoot)('uninstall names a page it cannot read and removes none', async () => {
    const box = sandbox();
    await expect(runPages(box, ['install'])).resolves.toMatchObject({ status: 0 });
    const before = { pages: contents(pagesFolder(box)), state: contents(box.state) };
    const page = join(pagesFolder(box), 'man1', 'notes-sync.1');
    chmodSync(page, 0o000);
    try {
      await expect(runPages(box, ['uninstall'])).resolves.toEqual(failure(unreadable(page)));
    } finally {
      chmodSync(page, 0o644);
    }
    expect({ pages: contents(pagesFolder(box)), state: contents(box.state) }).toEqual(before);
  });

  it.skipIf(isRoot)(
    'an install that drops a page it cannot read names it and writes nothing',
    async () => {
      const box = sandbox();
      await expect(runPages(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const before = { pages: contents(pagesFolder(box)), state: contents(box.state) };
      const page = join(pagesFolder(box), 'man1', 'notes-sync.1');
      chmodSync(page, 0o000);
      try {
        await expect(runPages(box, ['install'], '2.0.0', ['ping'])).resolves.toEqual(
          failure(unreadable(page)),
        );
      } finally {
        chmodSync(page, 0o644);
      }
      expect({ pages: contents(pagesFolder(box)), state: contents(box.state) }).toEqual(before);
    },
  );
});

/** Runs `check` with the folder at `path` at `mode`, restoring its mode wherever it is by then. */
async function whileLocked<Result>(
  box: Box,
  { mode, path }: { readonly mode: number; readonly path: string },
  check: () => Promise<Result>,
): Promise<Result> {
  const unlock = lockFolder(box.root, path, mode);
  try {
    return await check();
  } finally {
    unlock();
  }
}

/** Marks the committed record at `path` pending, each folder intending the files it holds. */
function markPending(path: string): void {
  const record = JSON.parse(readFileSync(path, 'utf8'));
  const folders = record.folders.map((folder: { path: string; files: unknown[] }) => ({
    intended: folder.files,
    path: folder.path,
    prior: folder.files,
  }));
  writeFileSync(path, `${JSON.stringify({ ...record, folders, state: 'pending' })}\n`);
}

/** What a run leaves once it completes: the Claude record's state and the Claude copy's skill file. */
const updated = { record: 'committed', skill: notesSkillTwo.files[0]?.content };
const removed = { record: 'gone', skill: 'gone' };

/** Each run that removes a leftover beside the Claude copy: its command, the record's state before it, and what it leaves. */
const leftoverRuns: readonly {
  readonly command: string;
  readonly state: string;
  readonly after: typeof updated | typeof removed;
}[] = [
  { after: updated, command: 'install', state: 'committed' },
  { after: updated, command: 'install', state: 'pending' },
  { after: updated, command: 'update', state: 'committed' },
  { after: updated, command: 'update', state: 'pending' },
  { after: removed, command: 'uninstall', state: 'pending' },
];

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

  it.each([
    ['a file holds the place of the Agents skills folder', ['.agents', 'skills']],
    ['a file holds the place of the Agents home', ['.agents']],
  ])('a forced install where %s names it and replaces no target', async (_case, blockedAt) => {
    const box = sandbox();
    const claudeFolder = join(claudeSkills(box), 'notes');
    mkdirSync(claudeFolder, { recursive: true });
    writeFileSync(join(claudeFolder, 'NOTES.md'), 'Written by the operator.\n');
    const blocker = join(box.home, ...blockedAt);
    mkdirSync(join(blocker, '..'), { recursive: true });
    writeFileSync(blocker, '');
    const before = contents(box.home);

    await expect(runSkillsIn(box, ['install', '--force'])).resolves.toEqual(
      failure(blocked(join(box.home, '.agents', 'skills', 'notes'))),
    );

    expect(contents(box.home)).toEqual(before);
    expect(existsSync(join(box.state, 'notes'))).toBe(false);
  });

  it.skipIf(isRoot)(
    'a forced install names the Agents skill folder its folder cannot take and replaces no target',
    async () => {
      const box = sandbox();
      const claudeFolder = join(claudeSkills(box), 'notes');
      mkdirSync(claudeFolder, { recursive: true });
      writeFileSync(join(claudeFolder, 'NOTES.md'), 'Written by the operator.\n');
      const agentsSkills = join(box.home, '.agents', 'skills');
      mkdirSync(agentsSkills, { recursive: true });
      const before = contents(box.home);

      const result = await readOnly(agentsSkills, () => runSkillsIn(box, ['install', '--force']));

      expect(result).toEqual(failure(unwritable(join(agentsSkills, 'notes'))));
      expect(contents(box.home)).toEqual(before);
      expect(existsSync(join(box.state, 'notes'))).toBe(false);
    },
  );

  it.skipIf(isRoot)(
    'uninstall names the Agents skill folder its folder cannot give up and removes no target',
    async () => {
      const box = sandbox();
      await expect(runSkillsIn(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const before = { home: contents(box.home), state: contents(box.state) };
      const agentsSkills = join(box.home, '.agents', 'skills');

      const result = await readOnly(agentsSkills, () => runSkillsIn(box, ['uninstall']));

      expect(result).toEqual(failure(unwritable(join(agentsSkills, 'notes'))));
      expect({ home: contents(box.home), state: contents(box.state) }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'a project install names the skills folder it cannot create and writes no folder',
    async () => {
      const box = sandbox();
      // The sandbox's own `.git` ends the walk for the repository root inside it.
      mkdirSync(join(box.work, '.git'));
      const home = join(box.work, '.claude');
      mkdirSync(home);
      mkdirSync(join(box.work, '.agents'));

      const results = await readOnly(home, async () => [
        await runSkillsIn(box, ['install', '--project', '--agent', 'claude']),
        await runSkillsIn(box, ['install', '--project']),
      ]);

      expect(results).toEqual([
        failure(unwritable(join(home, 'skills'))),
        failure(unwritable(join(home, 'skills'))),
      ]);
      expect(readdirSync(home)).toEqual([]);
      expect(readdirSync(join(box.work, '.agents'))).toEqual([]);
    },
  );

  it.skipIf(isRoot)(
    'install names the skill folder whose leftover its skills folder cannot let it claim',
    async () => {
      const box = sandbox();
      const leftover = join(claudeSkills(box), '.notes.0123456789abcdef.loom-staging');
      mkdirSync(leftover, { recursive: true });

      const result = await readOnly(claudeSkills(box), () =>
        runSkillsIn(box, ['install', '--agent', 'claude']),
      );

      expect(result).toEqual(failure(unwritable(join(claudeSkills(box), 'notes'))));
      expect(readdirSync(claudeSkills(box))).toEqual(['.notes.0123456789abcdef.loom-staging']);
    },
  );

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

  it.skipIf(isRoot)(
    'update, install, and a forced install name an installed folder they cannot empty and change no target',
    async () => {
      const box = sandbox();
      await expect(runSkillsIn(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const folder = join(claudeSkills(box), 'notes');
      writeFileSync(join(folder, 'mine.md'), 'Written by the operator.\n');
      const before = { home: tree(box.home), state: tree(box.state) };

      const results = await readOnly(folder, async () => [
        await runSkillsIn(box, ['update'], notesSkillTwo),
        await runSkillsIn(box, ['install'], notesSkillTwo),
        await runSkillsIn(box, ['install', '--force'], notesSkillTwo),
      ]);

      expect(results).toEqual([
        failure(unwritable(folder)),
        failure(unwritable(folder)),
        failure(unwritable(folder)),
      ]);
      expect({ home: tree(box.home), state: tree(box.state) }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'uninstall names an installed folder it cannot empty and removes no target',
    async () => {
      const box = sandbox();
      await expect(runSkillsIn(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const folder = join(claudeSkills(box), 'notes');
      writeFileSync(join(folder, 'mine.md'), 'Written by the operator.\n');
      const before = { home: tree(box.home), state: tree(box.state) };

      const result = await readOnly(folder, () => runSkillsIn(box, ['uninstall']));

      expect(result).toEqual(failure(unwritable(folder)));
      expect({ home: tree(box.home), state: tree(box.state) }).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'a project install names the Agents skill folder its folder cannot take and replaces no copy',
    async () => {
      const box = sandbox();
      mkdirSync(join(box.work, '.git'));
      const claudeCopy = join(box.work, '.claude', 'skills', 'notes');
      mkdirSync(claudeCopy, { recursive: true });
      writeFileSync(join(claudeCopy, 'SKILL.md'), 'The copy that was there.\n');
      const agentsSkills = join(box.work, '.agents', 'skills');
      mkdirSync(agentsSkills, { recursive: true });
      const before = tree(box.work);

      const result = await readOnly(agentsSkills, () => runSkillsIn(box, ['install', '--project']));

      expect(result).toEqual(failure(unwritable(join(agentsSkills, 'notes'))));
      expect(tree(box.work)).toEqual(before);
    },
  );

  it.skipIf(isRoot)(
    'a project install names a copy it cannot empty and replaces no copy',
    async () => {
      const box = sandbox();
      mkdirSync(join(box.work, '.git'));
      const agentsCopy = join(box.work, '.agents', 'skills', 'notes');
      mkdirSync(agentsCopy, { recursive: true });
      writeFileSync(join(agentsCopy, 'SKILL.md'), 'The copy that was there.\n');
      const before = tree(box.work);

      const result = await readOnly(agentsCopy, () => runSkillsIn(box, ['install', '--project']));

      expect(result).toEqual(failure(unwritable(agentsCopy)));
      expect(tree(box.work)).toEqual(before);
    },
  );

  it.skipIf(isRoot).each(['loom-retired', 'loom-staging'])(
    'a project install names a %s leftover it cannot empty and replaces no copy',
    async (suffix) => {
      const box = sandbox();
      // The sandbox's own `.git` ends the walk for the repository root inside it.
      mkdirSync(join(box.work, '.git'));
      const claudeCopy = join(box.work, '.claude', 'skills', 'notes');
      mkdirSync(claudeCopy, { recursive: true });
      writeFileSync(join(claudeCopy, 'SKILL.md'), 'The copy that was there.\n');
      const leftover = join(box.work, '.agents', 'skills', `.notes.0123456789abcdef.${suffix}`);
      const locked = join(leftover, 'sub');
      mkdirSync(locked, { recursive: true });
      writeFileSync(join(locked, 'left.md'), 'Left by a stopped run.\n');
      const before = tree(box.work);

      const result = await whileLocked(box, { mode: 0o555, path: locked }, () =>
        runSkillsIn(box, ['install', '--project']),
      );

      expect(result).toEqual(failure(unwritable(locked)));
      expect(tree(box.work)).toEqual(before);
    },
  );

  it('install names the skill folder whose Claude home is a link to a folder that is gone', async () => {
    const box = sandbox();
    dangle(join(box.home, '.claude'));
    const before = tree(box.home);

    await expect(runSkillsIn(box, ['install'])).resolves.toEqual(
      failure(dangling(join(claudeSkills(box), 'notes'))),
    );

    expect(tree(box.home)).toEqual(before);
    expect(existsSync(join(box.state, 'notes'))).toBe(false);
  });

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

  it.skipIf(isRoot)(
    'update names a subfolder it may write but not search and changes neither target',
    async () => {
      const box = sandbox();
      await expect(runSkillsIn(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const assets = join(claudeSkills(box), 'notes', 'assets');
      mkdirSync(assets);
      writeFileSync(join(assets, 'guide.md'), 'Written by the operator.\n');
      const before = { home: tree(box.home), state: tree(box.state) };

      const result = await whileLocked(box, { mode: 0o644, path: assets }, () =>
        runSkillsIn(box, ['update'], notesSkillTwo),
      );

      expect(result).toEqual(failure(unwritable(assets)));
      expect({ home: tree(box.home), state: tree(box.state) }).toEqual(before);
    },
  );

  it
    .skipIf(isRoot)
    .each(
      ['loom-retired', 'loom-staging'].flatMap((suffix) =>
        leftoverRuns.map(({ after, command, state }) => ({ after, command, state, suffix })),
      ),
    )(
    '$command with a $state record names a $suffix leftover it cannot empty until it can',
    async ({ after, command, state, suffix }) => {
      const box = sandbox();
      await expect(runSkillsIn(box, ['install'])).resolves.toMatchObject({ status: 0 });
      const record = join(box.state, 'notes', 'installation', 'skills.claude.json');
      if (state === 'pending') {
        markPending(record);
      }
      const leftover = join(claudeSkills(box), `.notes.0123456789abcdef.${suffix}`);
      const locked = join(leftover, 'sub');
      mkdirSync(locked, { recursive: true });
      writeFileSync(join(locked, 'left.md'), 'Left by a stopped run.\n');
      const skill = command === 'uninstall' ? notesSkill : notesSkillTwo;
      const before = { home: tree(box.home), state: tree(box.state) };

      const results = await whileLocked(box, { mode: 0o555, path: locked }, async () => [
        await runSkillsIn(box, [command], skill),
        await runSkillsIn(box, [command], skill),
      ]);

      expect(results).toEqual([failure(unwritable(locked)), failure(unwritable(locked))]);
      expect({ home: tree(box.home), state: tree(box.state) }).toEqual(before);
      await expect(runSkillsIn(box, [command], skill)).resolves.toMatchObject({ status: 0 });
      const skillFile = join(claudeSkills(box), 'notes', 'SKILL.md');
      expect({
        leftover: existsSync(leftover),
        record: existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')).state : 'gone',
        skill: existsSync(skillFile) ? readFileSync(skillFile, 'utf8') : 'gone',
      }).toEqual({ ...after, leftover: false });
    },
  );

  it('a project install names the skill folder whose skills folder is a link to a folder that is gone', async () => {
    const box = sandbox();
    // The sandbox's own `.git` ends the walk for the repository root inside it.
    mkdirSync(join(box.work, '.git'));
    const skillsFolder = join(box.work, '.claude', 'skills');
    dangle(skillsFolder);
    const before = tree(box.work);

    await expect(runSkillsIn(box, ['install', '--project'])).resolves.toEqual(
      failure(dangling(join(skillsFolder, 'notes'))),
    );

    expect(tree(box.work)).toEqual(before);
  });

  it('install names the record whose folder is a link to a folder that is gone', async () => {
    const box = sandbox();
    const recordFolder = join(box.state, 'notes', 'installation');
    dangle(recordFolder);
    const before = { home: tree(box.home), state: tree(box.state) };

    await expect(runSkillsIn(box, ['install'])).resolves.toEqual(
      failure(dangling(join(recordFolder, 'skills.claude.json'))),
    );

    expect({ home: tree(box.home), state: tree(box.state) }).toEqual(before);
  });
});
