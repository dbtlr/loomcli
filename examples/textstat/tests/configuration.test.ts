import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/src/main.js', import.meta.url);
const hostFixture = new URL('fixtures/config-host.mjs', import.meta.url);

/**
 * One temporary workspace per test: the project directory textstat runs in, with two files to
 * count, and one directory per variable the user file derives from.
 */
interface Workspace {
  readonly root: string;
  readonly project: string;
  readonly home: string;
  readonly xdg: string;
  readonly appdata: string;
  /** The built application, run in the project directory with each user-file variable set. */
  textstat(argv: string[], env?: Record<string, string | undefined>): ReturnType<typeof invoke>;
  /** The built application under a `win32` host, run from the temporary root. */
  windows(argv: string[], env?: Record<string, string | undefined>): ReturnType<typeof invoke>;
  /** Writes one file under a base directory, creating its directories, and answers its path. */
  write(base: string, relative: string, content: string): string;
}

function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'loom-textstat-config-'));
  const project = join(root, 'project');
  const home = join(root, 'home');
  const xdg = join(root, 'xdg');
  const appdata = join(root, 'appdata');
  for (const directory of [project, home, xdg, appdata]) {
    mkdirSync(directory);
  }
  writeFileSync(join(project, 'one.txt'), 'hello\n');
  writeFileSync(join(project, 'two.txt'), 'é');
  const variables = { APPDATA: appdata, HOME: home, XDG_CONFIG_HOME: xdg };
  return {
    appdata,
    home,
    project,
    root,
    textstat: (argv, env = {}) =>
      invoke(main, argv, { cwd: project, env: { ...variables, ...env } }),
    windows: (argv, env = {}) =>
      invoke(hostFixture, ['win32', project, ...argv], {
        cwd: root,
        env: { ...variables, ...env },
      }),
    write: (base, relative, content) => {
      const path = join(base, relative);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
    xdg,
  };
}

/** Runs one test body in a fresh workspace and removes it afterward. */
function inWorkspace(body: (space: Workspace) => void): () => void {
  return () => {
    const space = workspace();
    try {
      body(space);
    } finally {
      rmSync(space.root, { force: true, recursive: true });
    }
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** The failure the named file prints for one clause. */
function namedFailure(path: string, clause: string): string {
  return `Invalid input: Option "--config": File "${path}" ${clause}\n`;
}

/** The warning a discovered file prints for one clause. */
function skipped(file: string, clause: string): string {
  return `⚠ Skipped ${file}: the file ${clause}\n`;
}

const files = ['one.txt', 'two.txt'];
const both = 'COUNT  SOURCE\n    6  one.txt\n    2  two.txt\n';
const filtered = 'COUNT  SOURCE\n    6  one.txt\n';
const withTotal = `${both}    8  total\n`;

test(
  'textstat reads the user file its name derives under each platform rule',
  inWorkspace((space) => {
    space.write(space.xdg, 'textstat/config.json', json({ minBytes: 5 }));
    space.write(space.home, '.config/textstat/config.json', json({ total: true }));
    space.write(space.appdata, 'textstat/config.json', json({ minBytes: 3 }));
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: filtered });
    expect(space.textstat(files, { XDG_CONFIG_HOME: '' })).toEqual({
      status: 0,
      stderr: '',
      stdout: withTotal,
    });
    expect(space.textstat(files, { HOME: undefined, XDG_CONFIG_HOME: undefined })).toEqual({
      status: 0,
      stderr: '',
      stdout: both,
    });
    expect(space.windows(files)).toEqual({
      status: 0,
      stderr: '',
      stdout: `${filtered}resolved:0\n`,
    });
    expect(space.windows(files, { APPDATA: undefined })).toEqual({
      status: 0,
      stderr: '',
      stdout: `${both}resolved:0\n`,
    });
  }),
);

test(
  'the project file beats the user file key by key, and the environment and a flag beat both',
  inWorkspace((space) => {
    space.write(space.project, '.textstat.json', json({ minBytes: 5 }));
    space.write(space.xdg, 'textstat/config.json', json({ minBytes: 1, total: true }));
    expect(space.textstat(files)).toEqual({
      status: 0,
      stderr: '',
      stdout: `${filtered}    6  total\n`,
    });
    expect(space.textstat(files, { TEXTSTAT_MIN_BYTES: '0' })).toEqual({
      status: 0,
      stderr: '',
      stdout: withTotal,
    });
    expect(space.textstat([...files, '--min-bytes', '0'], { TEXTSTAT_MIN_BYTES: '5' })).toEqual({
      status: 0,
      stderr: '',
      stdout: withTotal,
    });
  }),
);

test(
  'a failure on a filled value names the file that answered',
  inWorkspace((space) => {
    space.write(space.project, '.textstat.json', json({ minBytes: 'many' }));
    const fromProject = space.textstat(files);
    expect(fromProject.status).toBe(2);
    expect(fromProject.stderr).toMatch(
      /^Invalid input: Option "--min-bytes" \(from minBytes in \.textstat\.json\): /u,
    );
    rmSync(join(space.project, '.textstat.json'));
    const user = space.write(space.xdg, 'textstat/config.json', json({ minBytes: -1 }));
    expect(space.textstat(files).stderr).toContain(`(from minBytes in ${user})`);
  }),
);

test(
  '--config names the one file the run reads, and a bad named file fails the run',
  inWorkspace((space) => {
    space.write(space.xdg, 'textstat/config.json', json({ minBytes: 5, total: true }));
    space.write(space.project, 'pinned.json', json({ minBytes: 1 }));
    expect(space.textstat([...files, '--config', 'pinned.json'])).toEqual({
      status: 0,
      stderr: '',
      stdout: both,
    });
    expect(space.textstat([...files, '--config', 'missing.json'])).toEqual({
      status: 2,
      stderr: namedFailure('missing.json', 'does not exist.'),
      stdout: '',
    });
    space.write(space.project, 'broken.json', '{');
    expect(space.textstat([...files, '--config', 'broken.json'])).toEqual({
      status: 2,
      stderr: namedFailure('broken.json', 'is not valid JSON.'),
      stdout: '',
    });
    space.write(space.project, 'list.json', '[]');
    expect(space.textstat([...files, '--config', 'list.json'])).toEqual({
      status: 2,
      stderr: namedFailure('list.json', 'does not hold a JSON object.'),
      stdout: '',
    });
    const help = space.textstat(['--config', 'missing.json', '--help']);
    expect(help).toMatchObject({ status: 0, stderr: '' });
    expect(help.stdout.startsWith('textstat')).toBe(true);
    // Every bound option is filled from argv, so no file is read and the bad name never surfaces.
    expect(
      space.textstat([...files, '--config', 'missing.json', '--min-bytes', '0', '--total']),
    ).toEqual({ status: 0, stderr: '', stdout: withTotal });
  }),
);

test(
  'a discovered file that is missing is silent, and a broken one warns once and is skipped',
  inWorkspace((space) => {
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: both });
    mkdirSync(join(space.project, '.textstat.json'));
    expect(space.textstat(files)).toEqual({
      status: 0,
      stderr: skipped('.textstat.json', 'could not be read.'),
      stdout: both,
    });
    rmSync(join(space.project, '.textstat.json'), { recursive: true });
    const broken: readonly (readonly [string, string])[] = [
      ['', 'is not valid JSON.'],
      ['{"minBytes": ', 'is not valid JSON.'],
      ['[5]', 'does not hold a JSON object.'],
    ];
    for (const [content, clause] of broken) {
      space.write(space.project, '.textstat.json', content);
      expect(space.textstat(files)).toEqual({
        status: 0,
        stderr: skipped('.textstat.json', clause),
        stdout: both,
      });
    }
    rmSync(join(space.project, '.textstat.json'));
    const user = space.write(space.xdg, 'textstat/config.json', 'null');
    const help = space.textstat(['--help']);
    expect(help.status).toBe(0);
    expect(help.stderr).toBe(skipped(user, 'does not hold a JSON object.'));
    expect(help.stdout.startsWith('textstat')).toBe(true);
  }),
);

test(
  'a value follows the option type, and a wrong value is a usage failure',
  inWorkspace((space) => {
    space.write(space.project, '.textstat.json', json({ minBytes: 5 }));
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: filtered });
    space.write(space.project, '.textstat.json', json({ total: 'yes' }));
    expect(space.textstat(files)).toEqual({
      status: 2,
      stderr:
        'Invalid input: Option "--total" (from total in .textstat.json): Use true or false.\n',
      stdout: '',
    });
    space.write(space.project, '.textstat.json', json({ minBytes: { max: 5 } }));
    expect(space.textstat(files)).toEqual({
      status: 2,
      stderr:
        'Invalid input: Option "--min-bytes" (from minBytes in .textstat.json): Use a string or a number.\n',
      stdout: '',
    });
  }),
);
