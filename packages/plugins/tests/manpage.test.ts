import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { findOnPath } from '../../../scripts/test-shell.js';

const fixture = new URL('fixtures/manpage-run.mjs', import.meta.url);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox: two homes, a state directory, and a working directory. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-manpage-'));
  roots.push(root);
  const box = {
    cwd: join(root, 'work'),
    home: join(root, 'home'),
    other: join(root, 'other'),
    root,
    scenario: join(root, 'scenario.json'),
    state: join(root, 'state'),
  };
  for (const directory of [box.cwd, box.home, box.other, box.state]) {
    mkdirSync(directory, { recursive: true });
  }
  return box;
}

type Box = ReturnType<typeof sandbox>;

interface Scenario {
  readonly commands?: readonly string[];
  readonly env?: Record<string, string | undefined>;
  readonly home?: string;
  readonly platform?: string;
  readonly umask?: number;
  readonly version?: string;
}

/**
 * Runs `notes ...argv` in the sandbox. `MANPATH` and `SHELL` are cleared and `PATH` holds the
 * home's `.local/bin`, unless the scenario sets them.
 */
function run(box: Box, argv: string[], scenario: Scenario = {}) {
  const home = scenario.home ?? box.home;
  writeFileSync(
    box.scenario,
    JSON.stringify({
      commands: scenario.commands,
      cwd: box.cwd,
      env: {
        HOME: home,
        PATH: `${join(home, '.local', 'bin')}:/usr/bin`,
        XDG_STATE_HOME: box.state,
        ...scenario.env,
      },
      platform: scenario.platform,
      umask: scenario.umask,
      version: scenario.version,
    }),
  );
  return invoke(fixture, argv, { env: { MANPAGE_SCENARIO: box.scenario } });
}

/** The lines a run wrote to stderr, each with any lane glyph and the space after it removed. */
function lines(stderr: string): string[] {
  return stderr
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\P{ASCII} /u, ''));
}

/** The folder `install` writes under a home. */
function folderOf(home: string): string {
  return join(home, '.local', 'share', 'man', 'man1');
}

/** The plugin's file in the installation record. */
function recordPath(box: Box): string {
  return join(box.state, 'notes', 'installation', 'manpage.json');
}

/** The page files of the default fixture, in graph order. */
const defaultSet = [
  'notes.1',
  'notes-manpage.1',
  'notes-manpage-generate.1',
  'notes-manpage-install.1',
  'notes-manpage-update.1',
  'notes-manpage-uninstall.1',
  'notes-ping.1',
  'notes-sync.1',
];

/** Every entry under a path with its kind, permission bits, and content, without following a link. */
function tree(path: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (current: string, key: string) => {
    const stats = lstatSync(current, { throwIfNoEntry: false });
    if (stats === undefined) {
      entries[key] = 'absent';
    } else if (stats.isSymbolicLink()) {
      entries[key] = `link ${readlinkSync(current)}`;
    } else if (stats.isDirectory()) {
      entries[key] = `directory ${(stats.mode & 0o777).toString(8)}`;
      for (const name of readdirSync(current).toSorted()) {
        walk(join(current, name), `${key}/${name}`);
      }
    } else {
      entries[key] = `file ${(stats.mode & 0o777).toString(8)} ${readFileSync(current, 'latin1')}`;
    }
  };
  walk(path, '.');
  return entries;
}

/** A path's inode and modification time, or `absent`, without following a link. */
function identity(path: string): string {
  const stats = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? 'absent' : `${stats.ino} ${stats.mtimeNs}`;
}

/** Everything a run that writes nothing must leave alone: both homes and the record. */
function snapshot(box: Box) {
  const record = recordPath(box);
  return {
    home: tree(box.home),
    other: tree(box.other),
    record: existsSync(record) ? `${readFileSync(record, 'utf8')} ${identity(record)}` : 'absent',
  };
}

/** The paths the plugin's file records. */
function recordedPaths(box: Box): string[] {
  const file: { files: { path: string }[] } = JSON.parse(readFileSync(recordPath(box), 'utf8'));
  return file.files.map(({ path }) => path);
}

function digestOf(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

describe('generate', () => {
  it('creates a missing folder and its parents with mode 755 and pages with mode 644 under umask 077', () => {
    const box = sandbox();
    const result = run(box, ['manpage', 'generate', '--out', 'build/man'], { umask: 0o077 });
    const folder = join(box.cwd, 'build', 'man');
    expect(result).toEqual({
      status: 0,
      stderr: expect.any(String),
      stdout: '',
    });
    expect(lines(result.stderr)).toEqual([`Wrote 8 man pages to ${folder}.`]);
    expect(lstatSync(join(box.cwd, 'build')).mode & 0o777).toBe(0o755);
    expect(lstatSync(folder).mode & 0o777).toBe(0o755);
    expect(readdirSync(folder).toSorted()).toEqual(defaultSet.toSorted());
    for (const file of defaultSet) {
      expect(lstatSync(join(folder, file)).mode & 0o777).toBe(0o644);
    }
    expect(existsSync(join(box.state, 'notes'))).toBe(false);
  });

  it('replaces a page and a symbolic link of the same name, and leaves every other file', () => {
    const box = sandbox();
    const folder = join(box.root, 'out');
    mkdirSync(folder);
    writeFileSync(join(folder, 'notes.1'), 'old page\n');
    writeFileSync(join(box.root, 'target'), 'kept\n');
    symlinkSync(join(box.root, 'target'), join(folder, 'notes-ping.1'));
    writeFileSync(join(folder, 'README'), 'mine\n');
    expect(run(box, ['manpage', 'generate', '--out', folder]).status).toBe(0);
    expect(readFileSync(join(folder, 'notes.1'), 'utf8')).toMatch(/^\.TH "NOTES" "1" ""/u);
    expect(lstatSync(join(folder, 'notes-ping.1')).isFile()).toBe(true);
    expect(readFileSync(join(box.root, 'target'), 'utf8')).toBe('kept\n');
    expect(readFileSync(join(folder, 'README'), 'utf8')).toBe('mine\n');
    expect(readdirSync(folder).filter((name) => name.startsWith('.'))).toEqual([]);
  });

  it('runs on a win32 host, and two runs under another HOME, TERM, COLUMNS, and locale write the same bytes', () => {
    const box = sandbox();
    const first = join(box.root, 'first');
    const second = join(box.root, 'second');
    expect(run(box, ['manpage', 'generate', '--out', first]).status).toBe(0);
    expect(
      run(box, ['manpage', 'generate', '--out', second], {
        env: { COLUMNS: '40', LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8', TERM: 'dumb' },
        home: box.other,
        platform: 'win32',
      }).status,
    ).toBe(0);
    expect(tree(second)).toEqual(tree(first));
  });

  it('generate and install write identical pages', () => {
    const box = sandbox();
    const out = join(box.root, 'out');
    run(box, ['manpage', 'generate', '--out', out]);
    run(box, ['manpage', 'install']);
    for (const file of defaultSet) {
      expect(readFileSync(join(folderOf(box.home), file), 'utf8')).toBe(
        readFileSync(join(out, file), 'utf8'),
      );
    }
  });

  it('an --out that names a file fails with the pinned sentence and writes nothing', () => {
    const box = sandbox();
    const file = join(box.cwd, 'man');
    writeFileSync(file, 'a file\n');
    const result = run(box, ['manpage', 'generate', '--out', 'man']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `${file} is not a folder. Name a folder, or a path where notes can create one.`,
    );
    expect(readdirSync(box.cwd)).toEqual(['man']);
    expect(readFileSync(file, 'utf8')).toBe('a file\n');
  });

  it('a run without --out is a usage error with exit 2', () => {
    const box = sandbox();
    expect(run(box, ['manpage', 'generate']).status).toBe(2);
  });
});

describe('install', () => {
  it('writes the set under the home with the modes, records it, and a second install changes no byte', () => {
    const box = sandbox();
    const folder = folderOf(box.home);
    const first = run(box, ['manpage', 'install'], { umask: 0o077 });
    expect(first.status).toBe(0);
    expect(first.stdout).toBe('');
    expect(lines(first.stderr)).toEqual([
      `Installed 8 man pages in ${folder}.`,
      'Read them with man notes.',
    ]);
    for (const directory of [
      '.local',
      '.local/share',
      '.local/share/man',
      '.local/share/man/man1',
    ]) {
      expect(lstatSync(join(box.home, directory)).mode & 0o777).toBe(0o755);
    }
    expect(readdirSync(folder).toSorted()).toEqual(defaultSet.toSorted());
    for (const file of defaultSet) {
      expect(lstatSync(join(folder, file)).mode & 0o777).toBe(0o644);
    }
    expect(recordedPaths(box)).toEqual(defaultSet.map((file) => join(folder, file)));
    const before = snapshot(box);
    const second = run(box, ['manpage', 'install']);
    expect(second.status).toBe(0);
    expect(lines(second.stderr)).toEqual([
      `The 8 man pages in ${folder} are unchanged.`,
      'Read them with man notes.',
    ]);
    expect(snapshot(box)).toEqual(before);
  });

  it.skipIf(findOnPath('man') === undefined)(
    'man finds an installed page with MANPATH unset and the home bin folder on PATH',
    () => {
      const box = sandbox();
      run(box, ['manpage', 'install']);
      const found = spawnSync('man', ['-w', 'notes-ping'], {
        encoding: 'utf8',
        env: { HOME: box.home, PATH: `${join(box.home, '.local', 'bin')}:${process.env.PATH}` },
      });
      expect(found.stdout.trim()).toBe(join(folderOf(box.home), 'notes-ping.1'));
    },
  );

  it('after an installed page is deleted, install writes it again', () => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    rmSync(join(folderOf(box.home), 'notes-ping.1'));
    const result = run(box, ['manpage', 'install']);
    expect(lines(result.stderr)[0]).toBe(`Installed 8 man pages in ${folderOf(box.home)}.`);
    expect(existsSync(join(folderOf(box.home), 'notes-ping.1'))).toBe(true);
  });

  it('after an install killed once every page was written, the next install recovers the record', () => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    const folder = folderOf(box.home);
    // A kill after the last rename and before the commit leaves every page and a pending record.
    writeFileSync(
      recordPath(box),
      `${JSON.stringify({
        directories: [],
        files: defaultSet.map((file) => ({
          intended: digestOf(readFileSync(join(folder, file), 'utf8')),
          path: join(folder, file),
          prior: null,
        })),
        format: 1,
        state: 'pending',
      })}\n`,
    );
    const result = run(box, ['manpage', 'install']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)[0]).toBe(`Installed 8 man pages in ${folder}.`);
    expect(JSON.parse(readFileSync(recordPath(box), 'utf8')).state).toBe('committed');
    expect(recordedPaths(box)).toEqual(defaultSet.map((file) => join(folder, file)));
  });

  it('a home that is not an absolute path fails with the pinned sentence', () => {
    const box = sandbox();
    const result = run(box, ['manpage', 'install'], { home: 'relative' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'notes cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.',
    );
  });
});

/** The advice line for a home whose man folder man will not find. */
function advice(home: string): string {
  return `man will not find these pages until MANPATH lists ${join(home, '.local', 'share', 'man')}. Add this line to your shell's startup file:`;
}

describe('advice when man will not find the pages', () => {
  it.each<[string, Record<string, string | undefined>]>([
    ['PATH lacks the home bin folder', { PATH: '/usr/bin' }],
    ['PATH holds the bare home .local folder alone', { PATH: 'HOME/.local:/usr/bin' }],
    ['MANPATH lists neither the folder nor an empty entry', { MANPATH: '/usr/share/man' }],
  ])('%s: the advice and the export line on stdout', (_name, env) => {
    const box = sandbox();
    const resolved = Object.fromEntries(
      Object.entries(env).map(([key, value]) => [key, value?.replace('HOME', box.home)]),
    );
    const result = run(box, ['manpage', 'install'], { env: resolved });
    const manFolder = join(box.home, '.local', 'share', 'man');
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed 8 man pages in ${folderOf(box.home)}.`,
      advice(box.home),
    ]);
    expect(result.stdout).toBe(`export MANPATH="${manFolder}:\${MANPATH-}"\n`);
    for (const manpath of [undefined, '/usr/share/man']) {
      const shell = spawnSync('bash', ['-u', '-c', `${result.stdout}printf %s "$MANPATH"`], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, ...(manpath === undefined ? {} : { MANPATH: manpath }) },
      });
      expect(shell.stdout).toBe(`${manFolder}:${manpath ?? ''}`);
    }
  });

  it('a home holding shell characters is escaped in the export line', () => {
    const box = sandbox();
    const home = join(box.root, 'a"b$c`d\\e');
    mkdirSync(home);
    const result = run(box, ['manpage', 'install'], { env: { PATH: '/usr/bin' }, home });
    const manFolder = join(home, '.local', 'share', 'man');
    const shell = spawnSync('bash', ['-u', '-c', `${result.stdout}printf %s "$MANPATH"`], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    expect(shell.stdout).toBe(`${manFolder}:`);
  });

  it('a SHELL ending in fish gets the Fish line', () => {
    const box = sandbox();
    const result = run(box, ['manpage', 'install'], {
      env: { PATH: '/usr/bin', SHELL: '/usr/local/bin/fish' },
    });
    const manFolder = join(box.home, '.local', 'share', 'man');
    expect(result.stdout).toBe(`set -gx MANPATH '${manFolder}' "$MANPATH"\n`);
  });

  it.skipIf(findOnPath('fish') === undefined)(
    'a real Fish runs the Fish line to the same MANPATH, with MANPATH unset and set',
    () => {
      const box = sandbox();
      const result = run(box, ['manpage', 'install'], {
        env: { PATH: '/usr/bin', SHELL: '/usr/local/bin/fish' },
      });
      const manFolder = join(box.home, '.local', 'share', 'man');
      for (const manpath of [undefined, '/usr/share/man']) {
        const fish = spawnSync(
          'fish',
          ['--no-config', '-c', `${result.stdout}printf %s "$MANPATH"`],
          {
            encoding: 'utf8',
            env: { PATH: process.env.PATH, ...(manpath === undefined ? {} : { MANPATH: manpath }) },
          },
        );
        expect(fish.stdout).toBe(`${manFolder}:${manpath ?? ''}`);
      }
    },
  );

  it.each<[string, string]>([
    ['MANPATH ending in a colon', '/usr/share/man:'],
    ['MANPATH listing the folder', 'HOME/.local/share/man'],
  ])('%s, with the home bin folder on PATH, prints Read them', (_name, manpath) => {
    const box = sandbox();
    const result = run(box, ['manpage', 'install'], {
      env: { MANPATH: manpath.replace('HOME', box.home) },
    });
    expect(result.stdout).toBe('');
    expect(lines(result.stderr).at(-1)).toBe('Read them with man notes.');
  });
});

describe('files the record does not list', () => {
  it.each<[string, (box: Box) => void, (box: Box) => string]>([
    [
      'a page generate wrote into the folder',
      (box) => {
        run(box, ['manpage', 'generate', '--out', folderOf(box.home)]);
      },
      (box) => `${join(folderOf(box.home), 'notes.1')} was not installed by notes manpage install.`,
    ],
    [
      'a symbolic link at a page path',
      (box) => {
        mkdirSync(folderOf(box.home), { recursive: true });
        symlinkSync(join(box.root, 'elsewhere'), join(folderOf(box.home), 'notes-ping.1'));
      },
      (box) =>
        `${join(folderOf(box.home), 'notes-ping.1')} was not installed by notes manpage install.`,
    ],
  ])('%s refuses install, which changes no byte', (_name, arrange, refused) => {
    const box = sandbox();
    arrange(box);
    const before = snapshot(box);
    const result = run(box, ['manpage', 'install']);
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toContain(refused(box));
    expect(result.stderr).toContain(
      'notes manpage install changed nothing, because files it did not install are in the way. Remove them, then run notes manpage install again.',
    );
    expect(snapshot(box)).toEqual(before);
  });

  it.each(['install', 'update'])('a recorded page edited since refuses %s', (verb) => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    const page = join(folderOf(box.home), 'notes-ping.1');
    writeFileSync(page, 'edited\n');
    const before = snapshot(box);
    const result = run(box, ['manpage', verb], { version: '2.0.0' });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)[0]).toBe(`${page} changed since notes manpage install wrote it.`);
    expect(result.stderr).toContain(
      `notes manpage ${verb} changed nothing, because files it did not install are in the way. Remove them, then run notes manpage install again.`,
    );
    expect(snapshot(box)).toEqual(before);
  });
});

describe('moving and changing the set', () => {
  it('on linux, after HOME changes with XDG_STATE_HOME held, install moves the set to the new home', () => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    const result = run(box, ['manpage', 'install'], { home: box.other });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed 8 man pages in ${folderOf(box.other)}.`,
      ...defaultSet.map((file) => `Removed ${join(folderOf(box.home), file)}.`),
      'Read them with man notes.',
    ]);
    expect(readdirSync(folderOf(box.home))).toEqual([]);
    expect(readdirSync(folderOf(box.other)).toSorted()).toEqual(defaultSet.toSorted());
  });

  it('a record with pages in two folders fails update, uninstall removes both, and install puts the set in one', () => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    run(box, ['manpage', 'generate', '--out', folderOf(box.other)]);
    // An install killed while it moved the set left some pages in each folder, all recorded.
    const files = defaultSet.map((file, index) => {
      const path = join(folderOf(index < 3 ? box.other : box.home), file);
      return { digest: digestOf(readFileSync(path, 'utf8')), path };
    });
    for (const file of defaultSet.slice(0, 3)) {
      rmSync(join(folderOf(box.home), file));
    }
    for (const file of defaultSet.slice(3)) {
      rmSync(join(folderOf(box.other), file));
    }
    writeFileSync(
      recordPath(box),
      `${JSON.stringify({ directories: [], files, format: 1, state: 'committed' })}\n`,
    );
    const before = snapshot(box);
    const update = run(box, ['manpage', 'update']);
    expect(update.status).toBe(1);
    expect(update.stderr).toContain(
      `${recordPath(box)} lists man pages in more than one folder, so notes manpage update cannot tell where they belong. Run notes manpage install to put them in one folder.`,
    );
    expect(snapshot(box)).toEqual(before);
    const install = run(box, ['manpage', 'install']);
    expect(install.status).toBe(0);
    expect(readdirSync(folderOf(box.home)).toSorted()).toEqual(defaultSet.toSorted());
    expect(readdirSync(folderOf(box.other))).toEqual([]);
  });

  it('uninstall removes the pages of both folders with one removed line for each folder', () => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    run(box, ['manpage', 'generate', '--out', folderOf(box.other)]);
    const files = defaultSet.map((file, index) => {
      const path = join(folderOf(index < 3 ? box.other : box.home), file);
      return { digest: digestOf(readFileSync(path, 'utf8')), path };
    });
    writeFileSync(
      recordPath(box),
      `${JSON.stringify({ directories: [], files, format: 1, state: 'committed' })}\n`,
    );
    const result = run(box, ['manpage', 'uninstall']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Removed 3 man pages from ${folderOf(box.other)}.`,
      `Removed 5 man pages from ${folderOf(box.home)}.`,
    ]);
    expect(existsSync(recordPath(box))).toBe(false);
  });

  it.each(['install', 'update'])(
    'after a Command is removed, %s removes its unchanged page and keeps an edited one',
    (verb) => {
      const box = sandbox();
      run(box, ['manpage', 'install'], { commands: ['ping', 'sync', 'tidy'] });
      const folder = folderOf(box.home);
      writeFileSync(join(folder, 'notes-tidy.1'), 'edited\n');
      const result = run(box, ['manpage', verb], { commands: ['ping'] });
      expect(result.status).toBe(0);
      const said = lines(result.stderr);
      expect(said[0]).toBe(
        `${verb === 'install' ? 'Installed' : 'Updated'} 7 man pages in ${folder}.`,
      );
      expect(said).toContain(`Removed ${join(folder, 'notes-sync.1')}.`);
      expect(said).toContain(
        `${join(folder, 'notes-tidy.1')} changed since notes manpage install wrote it, so it was left in place.`,
      );
      expect(existsSync(join(folder, 'notes-sync.1'))).toBe(false);
      expect(readFileSync(join(folder, 'notes-tidy.1'), 'utf8')).toBe('edited\n');
    },
  );

  it('after a Command is added, update writes its page into the recorded folder, even under a new HOME', () => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    const result = run(box, ['manpage', 'update'], {
      commands: ['ping', 'sync', 'tidy'],
      home: box.other,
    });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([`Updated 9 man pages in ${folderOf(box.home)}.`]);
    expect(existsSync(join(folderOf(box.home), 'notes-tidy.1'))).toBe(true);
    expect(existsSync(join(box.other, '.local'))).toBe(false);
  });

  it('update rewrites a page to this version, and an unchanged set prints the unchanged line', () => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    const page = join(folderOf(box.home), 'notes.1');
    expect(lines(run(box, ['manpage', 'update']).stderr)).toEqual([
      `The 8 man pages in ${folderOf(box.home)} are unchanged.`,
    ]);
    run(box, ['manpage', 'update'], { version: '2.0.0' });
    expect(readFileSync(page, 'utf8').split('\n')[0]).toBe('.TH "NOTES" "1" "" "notes 2.0.0" ""');
  });
});

describe('uninstall and the nothing-to lines', () => {
  it('with nothing recorded, update and uninstall print their nothing-to lines and exit 0', () => {
    const box = sandbox();
    expect(run(box, ['manpage', 'update'])).toMatchObject({ status: 0, stdout: '' });
    expect(lines(run(box, ['manpage', 'update']).stderr)).toEqual([
      'notes has no man pages installed, so there is nothing to update. Run notes manpage install to install them.',
    ]);
    const removed = run(box, ['manpage', 'uninstall']);
    expect(removed.status).toBe(0);
    expect(lines(removed.stderr)).toEqual([
      'notes has no man pages installed, so there is nothing to remove.',
    ]);
  });

  it('with every recorded page deleted, uninstall prints the nothing-to-remove line and deletes the record', () => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    for (const file of defaultSet) {
      rmSync(join(folderOf(box.home), file));
    }
    const result = run(box, ['manpage', 'uninstall']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      'notes has no man pages installed, so there is nothing to remove.',
    ]);
    expect(existsSync(recordPath(box))).toBe(false);
  });

  it('uninstall removes unchanged pages and empty created folders, and keeps an edited page', () => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    const folder = folderOf(box.home);
    writeFileSync(join(folder, 'notes-ping.1'), 'edited\n');
    const result = run(box, ['manpage', 'uninstall']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Removed 7 man pages from ${folder}.`,
      `${join(folder, 'notes-ping.1')} changed since notes manpage install wrote it, so it was left in place.`,
    ]);
    expect(readdirSync(folder)).toEqual(['notes-ping.1']);
    expect(existsSync(recordPath(box))).toBe(false);
  });

  it('uninstall removes every created folder then empty, and leaves a man1 folder that holds another file', () => {
    const box = sandbox();
    run(box, ['manpage', 'install']);
    expect(run(box, ['manpage', 'uninstall']).status).toBe(0);
    expect(readdirSync(box.home)).toEqual([]);
    run(box, ['manpage', 'install']);
    writeFileSync(join(folderOf(box.home), 'other.1'), 'theirs\n');
    run(box, ['manpage', 'uninstall']);
    expect(readdirSync(folderOf(box.home))).toEqual(['other.1']);
  });
});

describe('record and platform checks', () => {
  it.each<[string, string]>([
    ['install', 'install'],
    ['update', 'install'],
    ['uninstall', 'uninstall'],
  ])(
    'a damaged manpage.json fails %s with the pinned sentence and writes nothing',
    (verb, named) => {
      const box = sandbox();
      mkdirSync(join(box.state, 'notes', 'installation'), { recursive: true });
      writeFileSync(recordPath(box), '{"format":1,"state":');
      const before = snapshot(box);
      const result = run(box, ['manpage', verb]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `${recordPath(box)} cannot be read, so notes will not change the man pages it lists. Remove it and the pages it lists, then run notes manpage ${named} again.`,
      );
      expect(snapshot(box)).toEqual(before);
    },
  );

  it('a win32 host fails install, while update and uninstall print their nothing-to lines', () => {
    const box = sandbox();
    const install = run(box, ['manpage', 'install'], { platform: 'win32' });
    expect(install.status).toBe(1);
    expect(install.stderr).toContain(
      'notes manpage install works on Linux and macOS, which have man. Write the pages with notes manpage generate --out <folder> instead.',
    );
    expect(existsSync(join(box.home, '.local'))).toBe(false);
    const update = run(box, ['manpage', 'update'], { platform: 'win32' });
    expect(update.status).toBe(0);
    expect(lines(update.stderr)).toEqual([
      'notes has no man pages installed, so there is nothing to update. Run notes manpage install to install them.',
    ]);
    const uninstall = run(box, ['manpage', 'uninstall'], { platform: 'win32' });
    expect(uninstall.status).toBe(0);
    expect(lines(uninstall.stderr)).toEqual([
      'notes has no man pages installed, so there is nothing to remove.',
    ]);
  });
});
