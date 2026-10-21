/*
 * Acceptance plan for the man pages plugin (docs/plugins/manpage.md#the-page-set).
 *
 * Man pages are proven when public APIs alone produce these results under Node and Bun:
 *
 * - The page. jsonkit installs `manpage()`, and `jsonkit manpage generate --out <folder>` writes
 *   `jsonkit-get.1` byte for byte as above, with jsonkit's version. Two runs, and a run under
 *   another `HOME`, `TERM`, `COLUMNS`, and locale, write identical bytes, and `generate` and
 *   `install` write identical pages. `groff -man -Tutf8 -ww -z` reads every page jsonkit writes
 *   with no warning, and where `mandoc` is on `PATH`, `mandoc -T lint -W warning` reports
 *   `missing date` for each page, which the empty date gives, and nothing else.
 * - The set. jsonkit's set holds a page for the root, each visible child, the deprecated `fetch`,
 *   and each visible plugin Command, and none for `debug`, `paths`, `__complete`, or the alias
 *   `ls`. The root page lists `fetch` with its deprecated fact and neither `debug` nor `paths`, and
 *   `jsonkit-fetch.1` opens its DESCRIPTION with `Deprecated: Use get instead.`
 * - Sections. A fixture covers each section and its omission: a root page whose GLOBAL OPTIONS hold
 *   jsonkit's globals and a child page that holds none and names `jsonkit(1)` under SEE ALSO;
 *   authored outer and inner help sections as `.SH` and `.SS` in help's order; a hidden option on
 *   neither OPTIONS nor ENVIRONMENT; an option with an environment binding and `configInput`, which
 *   prints both lines and an ENVIRONMENT entry; a Boolean of each polarity, a long-only option, a
 *   `shortOnly` option, a counted option, a string option with an implied value, and an option with
 *   a closed set, each tag with the pinned fonts and each text as help prints its row, and each
 *   ENVIRONMENT entry naming the pinned spelling; an example with a note and one without; a Command
 *   with no description, whose NAME is the page name alone and whose parent's entry for it writes
 *   its tag alone; and a root whose authored option section holds a global. An application that
 *   installs neither help nor the configuration plugin still writes every page, reading the values
 *   its Commands carry.
 * - Markdown. A unit test renders each block and inline construct of Markdown details to the pinned
 *   roff: a paragraph's lines filled, a heading at the top level and inside a list item, fenced and
 *   indented code with blank lines at its ends, an empty line inside it, and a line ending in
 *   spaces, a thematic break, nested bullet and ordered lists with `007.` numbering and an item
 *   whose first block is code, a quote holding a list, a quote after a paragraph, an item with two
 *   paragraphs, emphasis, strong emphasis, a code span inside emphasis, a link, a link whose text
 *   is its destination, an image, and an autolink.
 * - Escapes. A description, a details paragraph and heading, an authored help section heading, a
 *   code line, an example, and a version each holding a leading `.`, a `'`, a `"`, a ``
 *   ` ``, a `^`, a `~`, a `\`, `\fB`, a `-`, an escape character, and non-ASCII text such as `café
 *   — 中` render under `groff -man
 *   -Tutf8` as the characters written, the quote kept in a heading and the ASCII characters as ASCII, with the escape character shown as `\u001b`; a tab inside a code line renders as space up to a tab stop, and one in a description as a space. Every page is ASCII, and `groff
 *   -man -Tutf8 -ww -z` reports nothing.
 * - Names that collide. A fixture with a root child `foo-bar` beside `foo bar` fails every build
 *   with the pinned diagnostic under `@loomcli/plugins/manpage/page-name-taken`, and the same graph
 *   with one of the two hidden builds.
 * - Generating. `generate` creates a missing folder and its parents with mode `755` and pages with
 *   mode `644` under umask `077`, replaces a page of the same name and a symbolic link of that
 *   name, leaves every other file, writes no installation record, and runs on a `win32` fixture
 *   host. A `--out` that names a file fails with the pinned sentence and writes nothing, and a run
 *   without `--out` exits 2.
 * - Installing. Process tests set `HOME`, `XDG_STATE_HOME`, and the working directory to temporary
 *   directories, and clear `MANPATH` and `SHELL` unless a case sets them:
 *   - `install` writes the set under `<home>/.local/share/man/man1` with the modes above, records
 *     it in `manpage.json`, and prints the pinned lines; a second `install` prints the unchanged
 *     line and changes no byte. Where `man` is on `PATH`, `man -w jsonkit-get` with `MANPATH` unset
 *     and `<home>/.local/bin` on `PATH` prints the installed page's path.
 *   - With `PATH` lacking `<home>/.local/bin`, and with `MANPATH` set to a list without the folder
 *     or an empty entry, `install` prints the pinned advice and the `export` line on stdout, and
 *     that line, run by `bash -u` with `MANPATH` unset and set, leaves the folder first on
 *     `MANPATH`; with `SHELL` ending in `fish`, it prints the Fish line, which a real Fish, where
 *     one is on `PATH`, runs to the same `MANPATH`; with `MANPATH` ending in a colon and
 *     `<home>/.local/bin` on `PATH`, it prints `Read them with man jsonkit.`
 *   - A page `generate` wrote into the folder, a symbolic link at a page's path, and a recorded
 *     page edited since, each refuse `install` and `update` with exit 1, print the refused line,
 *     and change no byte. After an installed page is deleted, `install` writes it again and prints
 *     the installed line. After an `install` killed once every page was written and before the
 *     record was committed, the next `install` recovers the record and prints the installed line.
 *   - On a `linux` host, after `HOME` changes with `XDG_STATE_HOME` held, `install` writes the set
 *     under the new home and removes the unchanged pages under the old one, printing a removed line
 *     for each. A record left with pages in both folders by an `install` killed while moving fails
 *     `update` with the pinned sentence, `uninstall` removes both folders' pages with one removed
 *     line for each folder, and the next `install` puts the set in one folder.
 *   - After a Command is removed from the fixture, `install` and `update` remove its unchanged page
 *     and keep an edited one with the left-in-place line. After a Command is added, `update` writes
 *     its page into the recorded folder, and on a `linux` host it does so even with `HOME` changed
 *     since and `XDG_STATE_HOME` held.
 *   - With nothing recorded, `update` and `uninstall` print their nothing-to lines and exit 0, and
 *     with every recorded page already deleted, `uninstall` prints its nothing-to-remove line,
 *     deletes `manpage.json`, and exits 0. `uninstall` removes every unchanged page and each
 *     created directory then empty, deletes `manpage.json`, keeps an edited page with the pinned
 *     warning, and leaves a `man1` folder that held another file.
 *   - A damaged `manpage.json` fails each child with the pinned sentence and writes nothing.
 * - Refreshing. `refreshManpages`, given a fixture binary path, runs it with `manpage update`,
 *   pipes its output into the host's streams, and resolves; a child that exits 1, and a path that
 *   cannot start, each add the pinned `warn` log event and resolve. Installed as
 *   `selfUpdate({ afterReplace: refreshManpages })` under the self-update fixture, an update
 *   rewrites a recorded page to the replaced binary's version.
 * - Packed consumers. A consumer installs the packed pack, imports `@loomcli/plugins/manpage`,
 *   compiles against its declaration, and generates the pages.
 */

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

/** The lines a run wrote to stderr as written, each lane glyph included. */
function rawLines(stderr: string): string[] {
  return stderr.trim().split('\n');
}

/** The glyph each lane marks its line with on a terminal that shows the main glyphs. */
const laneGlyphs = {
  info: String.fromCodePoint(0x21_39),
  success: String.fromCodePoint(0x27_14),
  warning: String.fromCodePoint(0x26_a0),
};

/** A line as a lane writes it: the lane's glyph, a space, and the message. */
function laned(mark: keyof typeof laneGlyphs, message: string): string {
  return `${laneGlyphs[mark]} ${message}`;
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

  it.each(['man/sub', 'man/sub/deeper'])(
    'an --out under a file, %s, fails with the pinned sentence and writes nothing',
    (out) => {
      const box = sandbox();
      const file = join(box.cwd, 'man');
      writeFileSync(file, 'a file\n');
      const result = run(box, ['manpage', 'generate', '--out', out]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `${join(box.cwd, out)} is not a folder. Name a folder, or a path where notes can create one.`,
      );
      expect(readdirSync(box.cwd)).toEqual(['man']);
      expect(readFileSync(file, 'utf8')).toBe('a file\n');
    },
  );

  it('an --out under a symbolic link whose target is missing fails with the pinned sentence and writes nothing', () => {
    const box = sandbox();
    symlinkSync(join(box.cwd, 'missing'), join(box.cwd, 'man'));
    const result = run(box, ['manpage', 'generate', '--out', 'man/sub']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `${join(box.cwd, 'man/sub')} is not a folder. Name a folder, or a path where notes can create one.`,
    );
    expect(readdirSync(box.cwd)).toEqual(['man']);
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
    expect(rawLines(first.stderr)).toEqual([
      laned('success', `Installed 8 man pages in ${folder}.`),
      laned('info', 'Read them with man notes.'),
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
    expect(rawLines(second.stderr)).toEqual([
      laned('info', `The 8 man pages in ${folder} are unchanged.`),
      laned('info', 'Read them with man notes.'),
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
    [
      'MANPATH holds an empty entry while PATH lacks the home bin folder',
      { MANPATH: ':/usr/share/man', PATH: '/usr/bin' },
    ],
  ])('%s: the advice and the export line on stdout', (_name, env) => {
    const box = sandbox();
    const resolved = Object.fromEntries(
      Object.entries(env).map(([key, value]) => [key, value?.replace('HOME', box.home)]),
    );
    const result = run(box, ['manpage', 'install'], { env: resolved });
    const manFolder = join(box.home, '.local', 'share', 'man');
    expect(result.status).toBe(0);
    expect(rawLines(result.stderr)).toEqual([
      laned('success', `Installed 8 man pages in ${folderOf(box.home)}.`),
      laned('warning', advice(box.home)),
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

  it.each<[string, Record<string, string>]>([
    ['MANPATH ending in a colon, with the home bin folder on PATH', { MANPATH: '/usr/share/man:' }],
    [
      'MANPATH listing the folder, with PATH lacking the home bin folder',
      { MANPATH: 'HOME/.local/share/man', PATH: '/usr/bin' },
    ],
    [
      'MANPATH listing the folder with a trailing slash, with PATH lacking the home bin folder',
      { MANPATH: 'HOME/.local/share/man/', PATH: '/usr/bin' },
    ],
    [
      'MANPATH unset, with the home bin folder on PATH with a trailing slash',
      { PATH: 'HOME/.local/bin/:/usr/bin' },
    ],
  ])('%s prints Read them', (_name, env) => {
    const box = sandbox();
    const result = run(box, ['manpage', 'install'], {
      env: Object.fromEntries(
        Object.entries(env).map(([key, value]) => [key, value.replace('HOME', box.home)]),
      ),
    });
    expect(result.stdout).toBe('');
    expect(lines(result.stderr).at(-1)).toBe('Read them with man notes.');
  });
});

describe('files the record does not list', () => {
  it.each<[string, 'install' | 'update', 'generate' | 'link']>([
    ['a page generate wrote into the folder', 'install', 'generate'],
    ['a page generate wrote into the folder', 'update', 'generate'],
    ['a symbolic link at a page path', 'install', 'link'],
    ['a symbolic link at a page path', 'update', 'link'],
  ])('%s refuses %s, which changes no byte', (_name, verb, kind) => {
    const box = sandbox();
    const folder = folderOf(box.home);
    // Update acts on an installed set, so the file sits at the page of a Command added since.
    const commands = verb === 'update' ? ['ping', 'sync', 'tidy'] : ['ping', 'sync'];
    const page = join(folder, verb === 'update' ? 'notes-tidy.1' : 'notes-ping.1');
    if (verb === 'update') {
      run(box, ['manpage', 'install']);
    }
    if (kind === 'generate') {
      run(box, ['manpage', 'generate', '--out', folder], { commands });
    } else {
      mkdirSync(folder, { recursive: true });
      symlinkSync(join(box.root, 'elsewhere'), page);
    }
    const before = snapshot(box);
    const result = run(box, ['manpage', verb], { commands });
    expect(result.status).toBe(1);
    expect(rawLines(result.stderr)).toContain(
      laned('warning', `${page} was not installed by notes manpage install.`),
    );
    expect(result.stderr).toContain(
      `notes manpage ${verb} changed nothing, because files it did not install are in the way. Remove them, then run notes manpage install again.`,
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

  it.each(['install', 'update'])(
    'a page holding the bytes this run would write, whose record holds an older digest, refuses %s',
    (verb) => {
      const box = sandbox();
      run(box, ['manpage', 'install']);
      const page = join(folderOf(box.home), 'notes-ping.1');
      const record: { files: { digest: string; path: string }[] } = JSON.parse(
        readFileSync(recordPath(box), 'utf8'),
      );
      for (const file of record.files.filter(({ path }) => path === page)) {
        file.digest = digestOf('an older page\n');
      }
      writeFileSync(recordPath(box), `${JSON.stringify(record)}\n`);
      const before = snapshot(box);
      const result = run(box, ['manpage', verb]);
      expect(result.status).toBe(1);
      expect(lines(result.stderr)[0]).toBe(`${page} changed since notes manpage install wrote it.`);
      expect(result.stderr).not.toContain('unchanged');
      expect(snapshot(box)).toEqual(before);
    },
  );
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
      const said = rawLines(result.stderr);
      expect(said[0]).toBe(
        laned(
          'success',
          `${verb === 'install' ? 'Installed' : 'Updated'} 7 man pages in ${folder}.`,
        ),
      );
      expect(said).toContain(laned('info', `Removed ${join(folder, 'notes-sync.1')}.`));
      expect(said).toContain(
        laned(
          'warning',
          `${join(folder, 'notes-tidy.1')} changed since notes manpage install wrote it, so it was left in place.`,
        ),
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
    expect(rawLines(result.stderr)).toEqual([
      laned('success', `Removed 7 man pages from ${folder}.`),
      laned(
        'warning',
        `${join(folder, 'notes-ping.1')} changed since notes manpage install wrote it, so it was left in place.`,
      ),
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
});
