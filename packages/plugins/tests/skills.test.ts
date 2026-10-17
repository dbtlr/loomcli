import {
  chmodSync,
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

const fixture = new URL('fixtures/skills-run.mjs', import.meta.url);

/** One file a fixture loader answers. */
interface SkillFile {
  readonly path: string;
  readonly content?: string;
  readonly bytes?: readonly number[];
  readonly executable?: boolean;
}

/** One skill of the fixture application, and how its loader answers. */
interface SkillEntry {
  readonly name: string;
  readonly files?: readonly SkillFile[];
  readonly throws?: boolean;
  readonly result?: unknown;
}

const notesFiles: readonly SkillFile[] = [
  { content: '# Notes\n', path: 'SKILL.md' },
  { content: 'commands v1\n', path: 'references/commands.md' },
  { content: '#!/bin/sh\n', executable: true, path: 'scripts/run.sh' },
];

const notes: SkillEntry = { files: notesFiles, name: 'notes' };

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox: a home, a state directory, a repository, and a place for the loader log. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-skills-'));
  roots.push(root);
  const box = {
    elsewhere: join(root, 'elsewhere'),
    home: join(root, 'home'),
    loaded: join(root, 'loaded.log'),
    repo: join(root, 'repo'),
    root,
    scenario: join(root, 'scenario.json'),
    state: join(root, 'state'),
  };
  for (const directory of [box.home, box.state, box.repo, box.elsewhere]) {
    mkdirSync(directory, { recursive: true });
  }
  return box;
}

type Box = ReturnType<typeof sandbox>;

interface Scenario {
  /** The width of the terminal the run writes to, or a pipe when left out. */
  readonly columns?: number;
  readonly skills?: readonly SkillEntry[];
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
  readonly umask?: number;
  readonly platform?: string;
  readonly build?: 'development' | 'distributed';
}

/** Runs `notes skills ...argv` in the sandbox, its fixture skills and environment from the scenario. */
function run(box: Box, argv: string[], scenario: Scenario = {}) {
  writeFileSync(
    box.scenario,
    JSON.stringify({
      ceiling: box.root,
      columns: scenario.columns,
      cwd: scenario.cwd ?? box.repo,
      env: { HOME: box.home, XDG_STATE_HOME: box.state, ...scenario.env },
      loaded: box.loaded,
      platform: scenario.platform,
      release: { build: scenario.build ?? 'distributed' },
      skills: scenario.skills ?? [notes],
      umask: scenario.umask,
    }),
  );
  return invoke(fixture, argv, { env: { SKILLS_SCENARIO: box.scenario } });
}

/** The skill names the loaders were called for, in order. */
function loaded(box: Box): string[] {
  return existsSync(box.loaded) ? readFileSync(box.loaded, 'utf8').trim().split('\n') : [];
}

/** The lines a run wrote to stderr, each with any lane glyph and the space after it removed. */
function lines(stderr: string): string[] {
  return stderr
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\P{ASCII} /u, ''));
}

type Target = 'claude' | 'agents';

function folderOf(box: Box, target: Target, name = 'notes'): string {
  return join(box.home, `.${target}`, 'skills', name);
}

function projectFolder(root: string, target: Target, name = 'notes'): string {
  return join(root, `.${target}`, 'skills', name);
}

function recordPath(box: Box, target: Target): string {
  return join(box.state, 'notes', 'installation', `skills.${target}.json`);
}

/** What the plugin's file for the target records: its state, directories, and folder paths. */
function recorded(box: Box, target: Target) {
  const file: {
    state: string;
    directories: string[];
    files: unknown[];
    folders?: { path: string }[];
  } = JSON.parse(readFileSync(recordPath(box, target), 'utf8'));
  return { ...file, folders: (file.folders ?? []).map(({ path }) => path) };
}

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
      entries[key] = 'directory';
      for (const name of readdirSync(current)) {
        walk(join(current, name), `${key}/${name}`);
      }
    } else {
      entries[key] =
        `file ${(stats.mode & 0o777).toString(8)} ${readFileSync(current).toString('latin1')}`;
    }
  };
  walk(path, '.');
  return entries;
}

/** The permission bits of a file. */
function modeOf(path: string): number {
  return lstatSync(path).mode & 0o777;
}

const written = {
  'SKILL.md': 'file 644 # Notes\n',
  'references/commands.md': 'file 644 commands v1\n',
  'scripts/run.sh': 'file 755 #!/bin/sh\n',
};

/** The tree of a folder holding exactly these files, each as `tree` spells it. */
function holding(files: Record<string, string>): Record<string, string> {
  const entries: Record<string, string> = { '.': 'directory' };
  for (const [path, spelled] of Object.entries(files)) {
    const parts = path.split('/');
    for (let depth = 1; depth < parts.length; depth += 1) {
      entries[`./${parts.slice(0, depth).join('/')}`] = 'directory';
    }
    entries[`./${path}`] = spelled;
  }
  return entries;
}

/** A path's inode and modification time, or `absent`, without following a link. */
function identity(path: string): string {
  const stats = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  return stats === undefined ? 'absent' : `${stats.ino} ${stats.mtimeNs}`;
}

/** A record's content and identity, or `absent`. */
function recordState(path: string): string {
  return existsSync(path) ? `${readFileSync(path, 'utf8')} ${identity(path)}` : 'absent';
}

/**
 * What a run that writes nothing must leave alone: each target's folder identity and each target's
 * record by its content and modification time, absent when nothing is there.
 */
function writeState(box: Box) {
  const target = (name: Target) => ({
    folder: identity(folderOf(box, name)),
    record: recordState(recordPath(box, name)),
  });
  return { agents: target('agents'), claude: target('claude') };
}

/**
 * Leaves what a process killed after the swap leaves for a target: the new folder in place, a
 * stale full copy retired beside it, and a plugin's file still `pending`.
 */
function killedAfterSwap(box: Box): string[] {
  const retired: string[] = [];
  for (const target of ['claude', 'agents'] as const) {
    const leftover = join(folderOf(box, target), '..', '.notes.0123456789abcdef.loom-retired');
    mkdirSync(leftover);
    writeFileSync(join(leftover, 'SKILL.md'), 'stale\n');
    retired.push(leftover);
    const record = JSON.parse(readFileSync(recordPath(box, target), 'utf8'));
    writeFileSync(recordPath(box, target), `${JSON.stringify({ ...record, state: 'pending' })}\n`);
  }
  return retired;
}

const installedBoth = [
  'Installed notes for claude in HOME/.claude/skills/notes.',
  'Installed notes for agents in HOME/.agents/skills/notes.',
];

/** Lines with the sandbox's home replaced by the word HOME. */
function pinned(box: Box, text: string): string[] {
  return lines(text).map((line) => line.replaceAll(box.home, 'HOME'));
}

describe('installing globally', () => {
  it.each([0o002, 0o077])(
    'writes both folders with the pinned modes under umask %o and records each target apart',
    (umask) => {
      const box = sandbox();
      const result = run(box, ['skills', 'install'], { umask });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(pinned(box, result.stderr)).toEqual(installedBoth);
      for (const target of ['claude', 'agents'] as const) {
        const folder = folderOf(box, target);
        expect(tree(folder)).toEqual(holding(written));
        expect(modeOf(join(folder, 'scripts/run.sh'))).toBe(0o755);
        expect(modeOf(join(folder, 'SKILL.md'))).toBe(0o644);
        const record = recorded(box, target);
        expect(record.state).toBe('committed');
        expect(record.folders).toEqual([folder]);
        expect(record.files).toEqual([]);
        expect(record.directories).toEqual([
          join(box.home, `.${target}`),
          join(box.home, `.${target}`, 'skills'),
        ]);
      }
    },
  );

  it('writes bytes as given', () => {
    const box = sandbox();
    const bytes = [0, 255, 10, 128];
    const skills = [{ files: [...notesFiles, { bytes, path: 'assets/blob.bin' }], name: 'notes' }];
    expect(run(box, ['skills', 'install'], { skills }).status).toBe(0);
    expect([...readFileSync(join(folderOf(box, 'claude'), 'assets/blob.bin'))]).toEqual(bytes);
  });

  it('keeps an installed folder whose path holds spaces on one line at a narrow width', () => {
    const box = sandbox();
    const home = join(box.root, 'Application Support', 'home');
    mkdirSync(home, { recursive: true });
    const folder = folderOf({ ...box, home }, 'claude');
    const narrow = run(box, ['skills', 'install'], { columns: 40, env: { HOME: home } });
    expect(narrow.status).toBe(0);
    const stderr = narrow.stderr.split('\n');
    expect(stderr).toContain(`  ${folder}.`);
    expect(lines(narrow.stderr)).toContain('Installed notes for claude in');
    rmSync(join(home, '.claude'), { force: true, recursive: true });
    rmSync(join(home, '.agents'), { force: true, recursive: true });
    rmSync(join(box.state, 'notes'), { force: true, recursive: true });
    const piped = run(box, ['skills', 'install'], { env: { HOME: home } });
    expect(lines(piped.stderr)).toContain(`Installed notes for claude in ${folder}.`);
  });

  it('with --agent claude writes only the Claude folder and leaves the agents record and folders alone', () => {
    const box = sandbox();
    expect(run(box, ['skills', 'install']).status).toBe(0);
    const before = {
      folder: tree(folderOf(box, 'agents')),
      record: readFileSync(recordPath(box, 'agents'), 'utf8'),
    };
    const next = [{ files: [{ content: 'v2\n', path: 'SKILL.md' }], name: 'notes' }];
    const result = run(box, ['skills', 'install', '--agent', 'claude'], { skills: next });
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual([installedBoth[0]]);
    expect(tree(folderOf(box, 'claude'))).toEqual(holding({ 'SKILL.md': 'file 644 v2\n' }));
    expect(tree(folderOf(box, 'agents'))).toEqual(before.folder);
    expect(readFileSync(recordPath(box, 'agents'), 'utf8')).toBe(before.record);
  });

  it('with --agent agents leaves the Claude record and folder alone', () => {
    const box = sandbox();
    const result = run(box, ['skills', 'install', '--agent', 'agents']);
    expect(pinned(box, result.stderr)).toEqual([installedBoth[1]]);
    expect(existsSync(join(box.home, '.claude'))).toBe(false);
    expect(existsSync(recordPath(box, 'claude'))).toBe(false);
    expect(existsSync(recordPath(box, 'agents'))).toBe(true);
  });

  it('prints the unchanged lines on a second install and writes nothing', () => {
    const box = sandbox();
    run(box, ['skills', 'install']);
    const before = writeState(box);
    const result = run(box, ['skills', 'install']);
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual([
      'HOME/.claude/skills/notes is unchanged.',
      'HOME/.agents/skills/notes is unchanged.',
    ]);
    expect(writeState(box)).toEqual(before);
  });

  it.each(['install', 'update'])(
    '%s resolves a pending record whose folder already matches, and removes the retired copy',
    (child) => {
      const box = sandbox();
      run(box, ['skills', 'install']);
      const retired = killedAfterSwap(box);
      expect(recorded(box, 'claude').state).toBe('pending');
      const result = run(box, ['skills', child]);
      expect(result.status).toBe(0);
      for (const target of ['claude', 'agents'] as const) {
        expect(recorded(box, target).state).toBe('committed');
        expect(recorded(box, target).folders).toEqual([folderOf(box, target)]);
        expect(tree(folderOf(box, target))).toEqual(holding(written));
        expect(readdirSync(join(folderOf(box, target), '..'))).toEqual(['notes']);
      }
      expect(retired.some((path) => existsSync(path))).toBe(false);
    },
  );

  const changes: [string, (box: Box) => void, Scenario?][] = [
    ['a file mode changed', (box) => chmodSync(join(folderOf(box, 'claude'), 'SKILL.md'), 0o600)],
    [
      'someone added a file',
      (box) => writeFileSync(join(folderOf(box, 'claude'), 'extra.md'), 'x'),
    ],
    [
      'someone added a folder',
      (box) => mkdirSync(join(folderOf(box, 'claude'), 'extra'), { recursive: true }),
    ],
    ['a file was edited', (box) => writeFileSync(join(folderOf(box, 'claude'), 'SKILL.md'), 'x')],
    [
      'the skill flips a file’s executable',
      () => {},
      {
        skills: [
          {
            files: notesFiles.map(({ content, executable, path }) => ({
              content: content ?? '',
              executable: executable !== true,
              path,
            })),
            name: 'notes',
          },
        ],
      },
    ],
  ];

  it.each(changes)('replaces the folder whole after %s', (_reason, change, scenario) => {
    const box = sandbox();
    run(box, ['skills', 'install']);
    change(box);
    const result = run(box, ['skills', 'install'], scenario);
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual(
      scenario === undefined
        ? [installedBoth[0], 'HOME/.agents/skills/notes is unchanged.']
        : installedBoth,
    );
    const files =
      scenario === undefined
        ? written
        : {
            'SKILL.md': 'file 755 # Notes\n',
            'references/commands.md': 'file 755 commands v1\n',
            'scripts/run.sh': 'file 644 #!/bin/sh\n',
          };
    expect(tree(folderOf(box, 'claude'))).toEqual(holding(files));
  });

  it('moves the Claude folder under an absolute CLAUDE_CONFIG_DIR and ignores a relative one', () => {
    const box = sandbox();
    const config = join(box.root, 'claude-config');
    run(box, ['skills', 'install'], { env: { CLAUDE_CONFIG_DIR: config } });
    expect(tree(join(config, 'skills', 'notes'))).toEqual(holding(written));
    expect(existsSync(join(box.home, '.claude'))).toBe(false);
    expect(recorded(box, 'claude').folders).toEqual([join(config, 'skills', 'notes')]);
    const other = sandbox();
    run(other, ['skills', 'install'], { env: { CLAUDE_CONFIG_DIR: 'relative/config' } });
    expect(tree(folderOf(other, 'claude'))).toEqual(holding(written));
  });

  it('installs --agent claude under an absolute CLAUDE_CONFIG_DIR with a relative HOME', () => {
    const box = sandbox();
    const config = join(box.root, 'claude-config');
    const result = run(box, ['skills', 'install', '--agent', 'claude'], {
      env: { CLAUDE_CONFIG_DIR: config, HOME: 'relative-home' },
    });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed notes for claude in ${join(config, 'skills', 'notes')}.`,
    ]);
  });

  it('exits 2 for an --agent value outside the set', () => {
    const box = sandbox();
    const result = run(box, ['skills', 'install', '--agent', 'cursor']);
    expect(result.status).toBe(2);
    expect(existsSync(join(box.home, '.claude'))).toBe(false);
  });
});

describe('refusing', () => {
  const obstacles: [string, (box: Box, folder: string) => void][] = [
    ['an unrecorded directory', (_box, folder) => mkdirSync(folder, { recursive: true })],
    [
      'a regular file',
      (_box, folder) => {
        mkdirSync(join(folder, '..'), { recursive: true });
        writeFileSync(folder, 'mine');
      },
    ],
    [
      'a symbolic link',
      (box, folder) => {
        mkdirSync(join(folder, '..'), { recursive: true });
        symlinkSync(box.elsewhere, folder);
      },
    ],
  ];

  it.each(obstacles)(
    'install refuses %s at a skill folder and changes nothing',
    (_name, obstruct) => {
      const box = sandbox();
      obstruct(box, folderOf(box, 'agents'));
      const before = {
        agents: tree(join(box.home, '.agents')),
        claude: tree(join(box.home, '.claude')),
        written: writeState(box),
      };
      const result = run(box, ['skills', 'install']);
      expect(result.status).toBe(1);
      expect(pinned(box, result.stderr)).toEqual([
        'HOME/.agents/skills/notes was not installed by notes skills install.',
        'notes skills install changed nothing, because folders it did not install are in the way. Remove them, or run notes skills install --force to replace them.',
      ]);
      expect(tree(join(box.home, '.agents'))).toEqual(before.agents);
      expect(tree(join(box.home, '.claude'))).toEqual(before.claude);
      expect(writeState(box)).toEqual(before.written);
      expect(existsSync(recordPath(box, 'claude'))).toBe(false);
      expect(existsSync(recordPath(box, 'agents'))).toBe(false);
      expect(tree(box.elsewhere)).toEqual({ '.': 'directory' });
    },
  );

  it.each(obstacles)(
    'update refuses %s in the way of a newly declared skill and writes nothing',
    (_name, obstruct) => {
      const box = sandbox();
      run(box, ['skills', 'install']);
      const second: SkillEntry = {
        files: [{ content: 'second\n', path: 'SKILL.md' }],
        name: 'second',
      };
      obstruct(box, folderOf(box, 'agents', 'second'));
      const before = {
        agents: tree(join(box.home, '.agents')),
        claude: tree(join(box.home, '.claude')),
        written: writeState(box),
      };
      const result = run(box, ['skills', 'update'], { skills: [notes, second] });
      expect(result.status).toBe(1);
      expect(pinned(box, result.stderr)).toEqual([
        'HOME/.agents/skills/second was not installed by notes skills install.',
        'notes skills update changed nothing, because folders it did not install are in the way. Remove them, or run notes skills install --force to replace them.',
      ]);
      expect(tree(join(box.home, '.agents'))).toEqual(before.agents);
      expect(tree(join(box.home, '.claude'))).toEqual(before.claude);
      expect(writeState(box)).toEqual(before.written);
    },
  );

  it('reports each refused folder across both targets', () => {
    const box = sandbox();
    mkdirSync(folderOf(box, 'claude'), { recursive: true });
    mkdirSync(folderOf(box, 'agents'), { recursive: true });
    const result = run(box, ['skills', 'install']);
    expect(pinned(box, result.stderr).slice(0, 2)).toEqual([
      'HOME/.claude/skills/notes was not installed by notes skills install.',
      'HOME/.agents/skills/notes was not installed by notes skills install.',
    ]);
  });

  const damaged: [string, string][] = [
    ['a damaged file', '{"format":1,'],
    ['a file of an unknown format', '{"format":2,"state":"committed"}\n'],
  ];

  it.each(damaged)(
    'install, update, and uninstall fail on %s with the record sentence',
    (_name, text) => {
      const box = sandbox();
      mkdirSync(join(box.state, 'notes', 'installation'), { recursive: true });
      writeFileSync(recordPath(box, 'claude'), text);
      const record = recordPath(box, 'claude');
      for (const child of ['install', 'update', 'uninstall']) {
        const result = run(box, ['skills', child]);
        expect(result.status).toBe(1);
        const word = child === 'uninstall' ? 'uninstall' : 'install';
        expect(lines(result.stderr)).toEqual([
          `${record} cannot be read, so notes will not change the folders it lists. Remove it and the folders it lists, then run notes skills ${word} again.`,
        ]);
      }
      expect(existsSync(folderOf(box, 'agents'))).toBe(false);
    },
  );

  it('fails every global child on a relative HOME', () => {
    const box = sandbox();
    for (const child of ['install', 'update', 'uninstall']) {
      const result = run(box, ['skills', child], { env: { HOME: 'relative' } });
      expect(result.status).toBe(1);
      expect(lines(result.stderr)).toEqual([
        'notes cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.',
      ]);
    }
    expect(loaded(box)).toEqual([]);
  });

  it('names USERPROFILE on win32', () => {
    const box = sandbox();
    const result = run(box, ['skills', 'install'], {
      env: { HOME: box.home, USERPROFILE: 'relative' },
      platform: 'win32',
    });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      'notes cannot find your home folder because USERPROFILE is not an absolute path. Set USERPROFILE to an absolute path, then run the command again.',
    ]);
  });

  it('names the variable the record lookup answers when HOME and XDG_STATE_HOME are relative', () => {
    const box = sandbox();
    const result = run(box, ['skills', 'install', '--agent', 'claude'], {
      env: {
        CLAUDE_CONFIG_DIR: join(box.root, 'claude-config'),
        HOME: 'relative-home',
        XDG_STATE_HOME: 'relative-state',
      },
    });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([
      'notes cannot find its installation record because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.',
    ]);
    expect(loaded(box)).toEqual([]);
  });
});

describe('forcing', () => {
  it('replaces a link to the other target’s folder, as npx skills leaves it, and leaves the folder it pointed at', () => {
    const box = sandbox();
    run(box, ['skills', 'install', '--agent', 'agents']);
    const agentsBefore = tree(folderOf(box, 'agents'));
    mkdirSync(join(box.home, '.claude', 'skills'), { recursive: true });
    symlinkSync(folderOf(box, 'agents'), folderOf(box, 'claude'));
    const result = run(box, ['skills', 'install', '--force']);
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual([
      'Replaced HOME/.claude/skills/notes, which notes skills install did not install.',
      installedBoth[0],
      'HOME/.agents/skills/notes is unchanged.',
    ]);
    expect(lstatSync(folderOf(box, 'claude')).isSymbolicLink()).toBe(false);
    expect(tree(folderOf(box, 'claude'))).toEqual(holding(written));
    expect(tree(folderOf(box, 'agents'))).toEqual(agentsBefore);
    expect(recorded(box, 'claude').folders).toEqual([folderOf(box, 'claude')]);
  });

  it.each([
    [
      'an unrecorded directory',
      (folder: string) => mkdirSync(join(folder, 'mine'), { recursive: true }),
    ],
    ['a regular file', (folder: string) => writeFileSync(folder, 'mine')],
  ])('replaces %s at a skill folder under --force', (_name, obstruct) => {
    const box = sandbox();
    mkdirSync(join(box.home, '.claude', 'skills'), { recursive: true });
    obstruct(folderOf(box, 'claude'));
    const result = run(box, ['skills', 'install', '--force', '--agent', 'claude']);
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual([
      'Replaced HOME/.claude/skills/notes, which notes skills install did not install.',
      installedBoth[0],
    ]);
    expect(tree(folderOf(box, 'claude'))).toEqual(holding(written));
    expect(recorded(box, 'claude').folders).toEqual([folderOf(box, 'claude')]);
  });

  it('removes a link alone and leaves its target byte for byte', () => {
    const box = sandbox();
    mkdirSync(join(box.elsewhere, 'sub'), { recursive: true });
    writeFileSync(join(box.elsewhere, 'sub', 'keep.md'), 'keep');
    const before = tree(box.elsewhere);
    mkdirSync(join(box.home, '.claude', 'skills'), { recursive: true });
    symlinkSync(box.elsewhere, folderOf(box, 'claude'));
    const result = run(box, ['skills', 'install', '--force', '--agent', 'claude']);
    expect(result.status).toBe(0);
    expect(tree(box.elsewhere)).toEqual(before);
    expect(tree(folderOf(box, 'claude'))).toEqual(holding(written));
  });

  it('installs as --project does with --force --project', () => {
    const box = sandbox();
    mkdirSync(join(box.repo, '.git'));
    const forced = run(box, ['skills', 'install', '--project', '--force']);
    expect(forced.status).toBe(0);
    expect(lines(forced.stderr)).toEqual([
      `Installed notes for claude in ${projectFolder(box.repo, 'claude')}.`,
      `Installed notes for agents in ${projectFolder(box.repo, 'agents')}.`,
    ]);
    expect(existsSync(join(box.state, 'notes'))).toBe(false);
  });
});

describe('updating', () => {
  const revised: SkillEntry = {
    files: [
      { content: '# Notes v2\n', path: 'SKILL.md' },
      { content: 'commands v1\n', path: 'references/guides/commands.md' },
      { content: 'new\n', path: 'references/added.md' },
    ],
    name: 'notes',
  };

  it('leaves exactly the new files, including over a folder someone edited', () => {
    const box = sandbox();
    run(box, ['skills', 'install']);
    writeFileSync(join(folderOf(box, 'claude'), 'SKILL.md'), 'edited');
    writeFileSync(join(folderOf(box, 'agents'), 'mine.md'), 'mine');
    const result = run(box, ['skills', 'update'], { skills: [revised] });
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual([
      'Updated notes for claude in HOME/.claude/skills/notes.',
      'Updated notes for agents in HOME/.agents/skills/notes.',
    ]);
    for (const target of ['claude', 'agents'] as const) {
      expect(tree(folderOf(box, target))).toEqual(
        holding({
          'SKILL.md': 'file 644 # Notes v2\n',
          'references/added.md': 'file 644 new\n',
          'references/guides/commands.md': 'file 644 commands v1\n',
        }),
      );
    }
  });

  it('prints the unchanged lines when nothing changed', () => {
    const box = sandbox();
    run(box, ['skills', 'install']);
    const before = writeState(box);
    const result = run(box, ['skills', 'update']);
    expect(pinned(box, result.stderr)).toEqual([
      'HOME/.claude/skills/notes is unchanged.',
      'HOME/.agents/skills/notes is unchanged.',
    ]);
    expect(writeState(box)).toEqual(before);
  });

  it('acts only on a target whose plugin’s file lists a folder', () => {
    const box = sandbox();
    run(box, ['skills', 'install', '--agent', 'agents']);
    const result = run(box, ['skills', 'update'], { skills: [revised] });
    expect(pinned(box, result.stderr)).toEqual([
      'Updated notes for agents in HOME/.agents/skills/notes.',
    ]);
    expect(existsSync(join(box.home, '.claude'))).toBe(false);
  });

  it('removes the folder of a skill the application stopped declaring, whole', () => {
    const box = sandbox();
    const second: SkillEntry = { files: [{ content: 's\n', path: 'SKILL.md' }], name: 'second' };
    run(box, ['skills', 'install'], { skills: [notes, second] });
    writeFileSync(join(folderOf(box, 'claude', 'second'), 'mine.md'), 'mine');
    const result = run(box, ['skills', 'update']);
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual([
      'Updated notes for claude in HOME/.claude/skills/notes.',
      'Removed HOME/.claude/skills/second.',
      'Updated notes for agents in HOME/.agents/skills/notes.',
      'Removed HOME/.agents/skills/second.',
    ]);
    expect(existsSync(folderOf(box, 'claude', 'second'))).toBe(false);
    expect(existsSync(folderOf(box, 'agents', 'second'))).toBe(false);
    expect(recorded(box, 'claude').folders).toEqual([folderOf(box, 'claude')]);
  });

  it('says there is nothing to update, and exits 0, when nothing is recorded', () => {
    const box = sandbox();
    const result = run(box, ['skills', 'update']);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      'notes has no skills installed in your home folder, so there is nothing to update. Run notes skills install to install them.',
    ]);
    expect(loaded(box)).toEqual(['notes']);
  });

  it('leaves a project folder byte for byte', () => {
    const box = sandbox();
    mkdirSync(join(box.repo, '.git'));
    run(box, ['skills', 'install', '--project']);
    run(box, ['skills', 'install']);
    const before = tree(join(box.repo, '.claude'));
    const result = run(box, ['skills', 'update'], { skills: [revised] });
    expect(result.status).toBe(0);
    expect(tree(join(box.repo, '.claude'))).toEqual(before);
  });
});

describe('uninstalling', () => {
  it('removes every recorded folder whole, the directories it created, and the plugin’s file', () => {
    const box = sandbox();
    run(box, ['skills', 'install']);
    writeFileSync(join(folderOf(box, 'claude'), 'SKILL.md'), 'edited');
    writeFileSync(join(folderOf(box, 'agents'), 'extra.md'), 'extra');
    const result = run(box, ['skills', 'uninstall']);
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual([
      'Removed HOME/.claude/skills/notes.',
      'Removed HOME/.agents/skills/notes.',
    ]);
    expect(existsSync(join(box.home, '.claude'))).toBe(false);
    expect(existsSync(join(box.home, '.agents'))).toBe(false);
    expect(existsSync(recordPath(box, 'claude'))).toBe(false);
    expect(existsSync(recordPath(box, 'agents'))).toBe(false);
  });

  it('leaves an unrecorded folder in place and says there is nothing to remove on a second run', () => {
    const box = sandbox();
    run(box, ['skills', 'install']);
    mkdirSync(folderOf(box, 'claude', 'mine'), { recursive: true });
    // The mode is explicit, so the pinned 644 holds under any umask.
    writeFileSync(join(folderOf(box, 'claude', 'mine'), 'SKILL.md'), 'mine', { mode: 0o644 });
    run(box, ['skills', 'uninstall']);
    expect(tree(folderOf(box, 'claude', 'mine'))).toEqual({
      '.': 'directory',
      './SKILL.md': 'file 644 mine',
    });
    expect(existsSync(folderOf(box, 'claude'))).toBe(false);
    const second = run(box, ['skills', 'uninstall']);
    expect(second.status).toBe(0);
    expect(lines(second.stderr)).toEqual([
      'notes has no skills installed in your home folder, so there is nothing to remove.',
    ]);
  });

  it('says a recorded folder that is already gone was already gone', () => {
    const box = sandbox();
    run(box, ['skills', 'install']);
    rmSync(folderOf(box, 'agents'), { recursive: true });
    const result = run(box, ['skills', 'uninstall']);
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual([
      'Removed HOME/.claude/skills/notes.',
      'HOME/.agents/skills/notes was already gone.',
    ]);
    expect(existsSync(recordPath(box, 'agents'))).toBe(false);
  });

  it('removes a Claude folder that became a link to the agents folder as a link alone', () => {
    const box = sandbox();
    run(box, ['skills', 'install']);
    rmSync(folderOf(box, 'claude'), { recursive: true });
    symlinkSync(folderOf(box, 'agents'), folderOf(box, 'claude'));
    const agents = tree(folderOf(box, 'agents'));
    const result = run(box, ['skills', 'uninstall', '--agent', 'claude']);
    expect(pinned(box, result.stderr)).toEqual(['Removed HOME/.claude/skills/notes.']);
    expect(existsSync(folderOf(box, 'claude'))).toBe(false);
    expect(tree(folderOf(box, 'agents'))).toEqual(agents);
  });

  it('with --agent agents leaves the Claude folder and its record alone', () => {
    const box = sandbox();
    run(box, ['skills', 'install']);
    const claude = tree(folderOf(box, 'claude'));
    const record = readFileSync(recordPath(box, 'claude'), 'utf8');
    const result = run(box, ['skills', 'uninstall', '--agent', 'agents']);
    expect(pinned(box, result.stderr)).toEqual(['Removed HOME/.agents/skills/notes.']);
    expect(tree(folderOf(box, 'claude'))).toEqual(claude);
    expect(readFileSync(recordPath(box, 'claude'), 'utf8')).toBe(record);
    expect(existsSync(recordPath(box, 'agents'))).toBe(false);
  });

  it('calls no loader and succeeds when a loader throws', () => {
    const box = sandbox();
    run(box, ['skills', 'install']);
    rmSync(box.loaded);
    const result = run(box, ['skills', 'uninstall'], { skills: [{ name: 'notes', throws: true }] });
    expect(result.status).toBe(0);
    expect(loaded(box)).toEqual([]);
  });
});

/** A home where `~/.claude/skills` links to `~/.agents/skills`, as operators who share skills arrange. */
function linked(box: Box): void {
  mkdirSync(join(box.home, '.agents', 'skills'), { recursive: true });
  mkdirSync(join(box.home, '.claude'), { recursive: true });
  symlinkSync(join(box.home, '.agents', 'skills'), join(box.home, '.claude', 'skills'));
}

describe('one folder for both targets', () => {
  it('writes the folder once, records it for claude alone, and prints the same-folder line', () => {
    const box = sandbox();
    linked(box);
    const result = run(box, ['skills', 'install']);
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual([
      'HOME/.agents/skills is the same folder as HOME/.claude/skills, so notes acts on it once, for claude.',
      'Installed notes for claude in HOME/.claude/skills/notes.',
    ]);
    expect(existsSync(recordPath(box, 'agents'))).toBe(false);
    expect(recorded(box, 'claude').folders).toEqual([folderOf(box, 'claude')]);
    expect(tree(folderOf(box, 'agents'))).toEqual(holding(written));
  });

  it('removes the folder once on uninstall', () => {
    const box = sandbox();
    linked(box);
    run(box, ['skills', 'install']);
    const result = run(box, ['skills', 'uninstall']);
    expect(result.status).toBe(0);
    expect(pinned(box, result.stderr)).toEqual([
      'HOME/.agents/skills is the same folder as HOME/.claude/skills, so notes acts on it once, for claude.',
      'Removed HOME/.claude/skills/notes.',
    ]);
    expect(existsSync(folderOf(box, 'agents'))).toBe(false);
  });

  it('refuses an explicit --agent agents over a folder the claude record owns', () => {
    const box = sandbox();
    linked(box);
    run(box, ['skills', 'install']);
    const result = run(box, ['skills', 'install', '--agent', 'agents']);
    expect(result.status).toBe(1);
    expect(pinned(box, result.stderr)[0]).toBe(
      'HOME/.agents/skills/notes was not installed by notes skills install.',
    );
  });
});

const guard = (path: string) =>
  `notes skills install --project would write to ${path}, the folder notes skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.`;

describe('project installs', () => {
  it('writes to the root that holds a .git directory, from a subdirectory', () => {
    const box = sandbox();
    mkdirSync(join(box.repo, '.git'));
    const start = join(box.repo, 'packages', 'app');
    mkdirSync(start, { recursive: true });
    const result = run(box, ['skills', 'install', '--project'], { cwd: start });
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed notes for claude in ${projectFolder(box.repo, 'claude')}.`,
      `Installed notes for agents in ${projectFolder(box.repo, 'agents')}.`,
    ]);
    expect(tree(projectFolder(box.repo, 'claude'))).toEqual(holding(written));
    expect(modeOf(join(projectFolder(box.repo, 'agents'), 'scripts/run.sh'))).toBe(0o755);
    expect(existsSync(join(box.state, 'notes'))).toBe(false);
  });

  it('writes the pinned modes under umask 077', () => {
    const box = sandbox();
    mkdirSync(join(box.repo, '.git'));
    run(box, ['skills', 'install', '--project', '--agent', 'claude'], { umask: 0o077 });
    expect(modeOf(join(projectFolder(box.repo, 'claude'), 'SKILL.md'))).toBe(0o644);
    expect(modeOf(join(projectFolder(box.repo, 'claude'), 'scripts/run.sh'))).toBe(0o755);
  });

  it('treats a .git file as the root marker', () => {
    const box = sandbox();
    writeFileSync(join(box.repo, '.git'), 'gitdir: elsewhere\n');
    const start = join(box.repo, 'sub');
    mkdirSync(start);
    const result = run(box, ['skills', 'install', '--project', '--agent', 'agents'], {
      cwd: start,
    });
    expect(lines(result.stderr)).toEqual([
      `Installed notes for agents in ${projectFolder(box.repo, 'agents')}.`,
    ]);
  });

  it('writes to the start when no .git is above it', () => {
    const box = sandbox();
    const start = join(box.repo, 'sub');
    mkdirSync(start);
    const result = run(box, ['skills', 'install', '--project', '--agent', 'claude'], {
      cwd: start,
    });
    expect(result.status).toBe(0);
    expect(tree(projectFolder(start, 'claude'))).toEqual(holding(written));
  });

  it('starts the walk at the directory -C names', () => {
    const box = sandbox();
    const other = join(box.root, 'other');
    mkdirSync(join(other, '.git'), { recursive: true });
    mkdirSync(join(other, 'deep'));
    const result = run(box, [
      'skills',
      'install',
      '--project',
      '-C',
      join(other, 'deep'),
      '--agent',
      'claude',
    ]);
    expect(result.status).toBe(0);
    expect(tree(projectFolder(other, 'claude'))).toEqual(holding(written));
    const relative = run(box, [
      'skills',
      'install',
      '--project',
      '--directory',
      '../other',
      '--agent',
      'claude',
    ]);
    expect(relative.status).toBe(0);
    expect(lines(relative.stderr)).toEqual([
      `Installed notes for claude in ${projectFolder(other, 'claude')}, replacing the copy that was there.`,
    ]);
  });

  it('exits 2 for a -C directory that is missing or is a file', () => {
    const box = sandbox();
    const missing = join(box.root, 'missing');
    const result = run(box, ['skills', 'install', '--project', '-C', missing]);
    expect(result.status).toBe(2);
    expect(lines(result.stderr)[0]).toBe(
      `notes: Option "--directory" names ${missing}, which is not a directory. Name a directory that exists.`,
    );
    expect(loaded(box)).toEqual([]);
    const file = join(box.root, 'file');
    writeFileSync(file, 'x');
    expect(run(box, ['skills', 'install', '--project', '-C', file]).status).toBe(2);
  });

  it('exits 2 for -C without --project', () => {
    const box = sandbox();
    const result = run(box, ['skills', 'install', '-C', box.repo]);
    expect(result.status).toBe(2);
    expect(lines(result.stderr)[0]).toBe(
      'notes: Option "--directory" needs --project. Add --project, or leave out --directory.',
    );
    expect(loaded(box)).toEqual([]);
  });

  it('refuses from a home folder that holds .git and writes nothing', () => {
    const box = sandbox();
    mkdirSync(join(box.home, '.git'));
    const result = run(box, ['skills', 'install', '--project'], { cwd: box.home });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([guard(folderOf(box, 'claude'))]);
    expect(existsSync(join(box.home, '.claude'))).toBe(false);
    expect(loaded(box)).toEqual([]);
  });

  it('refuses from a home folder with no .git above it', () => {
    const box = sandbox();
    const result = run(box, ['skills', 'install', '--project', '--agent', 'agents'], {
      cwd: box.home,
    });
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([guard(folderOf(box, 'agents'))]);
  });

  it('refuses a repository whose .claude links to the home folder’s .claude', () => {
    const box = sandbox();
    mkdirSync(join(box.repo, '.git'));
    run(box, ['skills', 'install']);
    const before = tree(join(box.home, '.claude'));
    symlinkSync(join(box.home, '.claude'), join(box.repo, '.claude'));
    const result = run(box, ['skills', 'install', '--project']);
    expect(result.status).toBe(1);
    expect(lines(result.stderr)).toEqual([guard(folderOf(box, 'claude'))]);
    expect(tree(join(box.home, '.claude'))).toEqual(before);
  });

  it('refuses a repository reached through a linked root', () => {
    const box = sandbox();
    mkdirSync(join(box.home, '.git'));
    const alias = join(box.root, 'alias');
    symlinkSync(box.home, alias);
    const result = run(box, ['skills', 'install', '--project', '--agent', 'claude'], {
      cwd: alias,
    });
    expect(result.status).toBe(1);
    expect(existsSync(join(box.home, '.claude'))).toBe(false);
  });

  it('removes a link inside the folder as a link and leaves the directory it pointed at', () => {
    const box = sandbox();
    mkdirSync(join(box.repo, '.git'));
    run(box, ['skills', 'install', '--project', '--agent', 'claude']);
    writeFileSync(join(box.elsewhere, 'keep.md'), 'keep');
    const before = tree(box.elsewhere);
    symlinkSync(box.elsewhere, join(projectFolder(box.repo, 'claude'), 'link'));
    const result = run(box, ['skills', 'install', '--project', '--agent', 'claude']);
    expect(result.status).toBe(0);
    expect(tree(box.elsewhere)).toEqual(before);
    expect(tree(projectFolder(box.repo, 'claude'))).toEqual(holding(written));
  });

  it('removes a dropped file and an added one, and prints the replacing line', () => {
    const box = sandbox();
    mkdirSync(join(box.repo, '.git'));
    run(box, ['skills', 'install', '--project', '--agent', 'claude']);
    writeFileSync(join(projectFolder(box.repo, 'claude'), 'mine.md'), 'mine');
    const next = [{ files: [{ content: 'v2\n', path: 'SKILL.md' }], name: 'notes' }];
    const result = run(box, ['skills', 'install', '--project', '--agent', 'claude'], {
      skills: next,
    });
    expect(lines(result.stderr)).toEqual([
      `Installed notes for claude in ${projectFolder(box.repo, 'claude')}, replacing the copy that was there.`,
    ]);
    expect(tree(projectFolder(box.repo, 'claude'))).toEqual(
      holding({ 'SKILL.md': 'file 644 v2\n' }),
    );
    expect(readdirSync(join(box.repo, '.claude', 'skills'))).toEqual(['notes']);
  });

  it('replaces a symbolic link at the folder without touching its target', () => {
    const box = sandbox();
    mkdirSync(join(box.repo, '.git'));
    writeFileSync(join(box.elsewhere, 'keep.md'), 'keep');
    const before = tree(box.elsewhere);
    mkdirSync(join(box.repo, '.claude', 'skills'), { recursive: true });
    symlinkSync(box.elsewhere, projectFolder(box.repo, 'claude'));
    const result = run(box, ['skills', 'install', '--project', '--agent', 'claude']);
    expect(lines(result.stderr)).toEqual([
      `Installed notes for claude in ${projectFolder(box.repo, 'claude')}, replacing the copy that was there.`,
    ]);
    expect(tree(box.elsewhere)).toEqual(before);
    expect(tree(projectFolder(box.repo, 'claude'))).toEqual(holding(written));
  });

  it('writes nothing to the installation record', () => {
    const box = sandbox();
    mkdirSync(join(box.repo, '.git'));
    run(box, ['skills', 'install', '--project']);
    expect(existsSync(join(box.state, 'notes'))).toBe(false);
  });
});

describe('loading', () => {
  it('calls no loader for a run of any Command outside skills', () => {
    const box = sandbox();
    const result = run(box, ['ping']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('pong\n');
    expect(loaded(box)).toEqual([]);
    expect(run(box, ['skills', '--help']).status).toBe(0);
    expect(loaded(box)).toEqual([]);
  });

  it('calls each loader once, in declaration order', () => {
    const box = sandbox();
    const second: SkillEntry = { files: [{ content: 's', path: 'SKILL.md' }], name: 'second' };
    run(box, ['skills', 'install'], { skills: [second, notes] });
    expect(loaded(box)).toEqual(['second', 'notes']);
  });

  const diagnostics: [string, SkillEntry, string, string][] = [
    [
      'a result that is not a list',
      { name: 'notes', result: 'nope' },
      'Skill "notes" loaded something that is not a list of files.',
      "Return a list of { path, content } files from the skill's files function.",
    ],
    [
      'an entry whose path is not a string',
      { name: 'notes', result: [{ content: 'x', path: 1 }] },
      'Skill "notes" loaded something that is not a list of files.',
      "Return a list of { path, content } files from the skill's files function.",
    ],
    [
      'an entry whose content is neither text nor bytes',
      { name: 'notes', result: [{ content: 5, path: 'SKILL.md' }] },
      'Skill "notes" loaded something that is not a list of files.',
      "Return a list of { path, content } files from the skill's files function.",
    ],
    [
      'a path that leaves the folder',
      {
        name: 'notes',
        result: [
          { content: 'x', path: '../notes.md' },
          { content: 'x', path: 'SKILL.md' },
        ],
      },
      'Skill "notes" lists a file path that is not a plain relative path: ../notes.md.',
      'Use a relative path with / between its parts and no empty, ., or .. part, such as references/commands.md.',
    ],
    [
      'an absolute path',
      { name: 'notes', result: [{ content: 'x', path: '/SKILL.md' }] },
      'Skill "notes" lists a file path that is not a plain relative path: /SKILL.md.',
      'Use a relative path with / between its parts and no empty, ., or .. part, such as references/commands.md.',
    ],
    [
      'a path with a backslash',
      { name: 'notes', result: [{ content: 'x', path: String.raw`a\b.md` }] },
      String.raw`Skill "notes" lists a file path that is not a plain relative path: a\b.md.`,
      'Use a relative path with / between its parts and no empty, ., or .. part, such as references/commands.md.',
    ],
    [
      'a path with an empty segment',
      { name: 'notes', result: [{ content: 'x', path: 'a//b.md' }] },
      'Skill "notes" lists a file path that is not a plain relative path: a//b.md.',
      'Use a relative path with / between its parts and no empty, ., or .. part, such as references/commands.md.',
    ],
    [
      'an empty path',
      { name: 'notes', result: [{ content: 'x', path: '' }] },
      'Skill "notes" lists a file path that is not a plain relative path: .',
      'Use a relative path with / between its parts and no empty, ., or .. part, such as references/commands.md.',
    ],
    [
      'a path with a control character, escaped',
      { name: 'notes', result: [{ content: 'x', path: 'a\u0007b.md' }] },
      String.raw`Skill "notes" lists a file path that is not a plain relative path: a\u0007b.md.`,
      'Use a relative path with / between its parts and no empty, ., or .. part, such as references/commands.md.',
    ],
    [
      'a path listed twice',
      {
        name: 'notes',
        result: [
          { content: 'x', path: 'SKILL.md' },
          { content: 'x', path: 'references/commands.md' },
          { content: 'y', path: 'references/commands.md' },
        ],
      },
      'Skill "notes" lists the file references/commands.md twice.',
      'List each file once.',
    ],
    [
      'no SKILL.md',
      { name: 'notes', result: [{ content: 'x', path: 'README.md' }] },
      'Skill "notes" lists no SKILL.md.',
      "Add the skill's SKILL.md at the top of its files.",
    ],
  ];

  it.each(diagnostics)(
    'throws the pinned diagnostic for %s and writes nothing',
    (_name, skill, sentence, correction) => {
      const box = sandbox();
      for (const child of ['install', 'update']) {
        const result = run(box, ['skills', child], { build: 'development', skills: [skill] });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('@loomcli/plugins/skills/files');
        expect(result.stderr).toContain(sentence);
        expect(result.stderr).toContain(correction);
      }
      expect(existsSync(join(box.home, '.claude'))).toBe(false);
      expect(existsSync(join(box.state, 'notes'))).toBe(false);
      const project = run(box, ['skills', 'install', '--project'], {
        build: 'development',
        skills: [skill],
      });
      expect(project.status).toBe(1);
      expect(existsSync(join(box.repo, '.claude'))).toBe(false);
    },
  );

  it('fails the run through the ordinary path when a loader throws', () => {
    const box = sandbox();
    const result = run(box, ['skills', 'install'], {
      build: 'development',
      skills: [{ name: 'notes', throws: true }],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('The notes loader failed.');
    expect(existsSync(join(box.home, '.claude'))).toBe(false);
  });
});

describe('the Commands', () => {
  it('describes skills and its three children', () => {
    const box = sandbox();
    const result = run(box, ['skills', 'install', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Install the skills for your coding agents.');
    expect(result.stdout).toContain(
      'The agents to install for: claude, or agents for Codex and others. Both when left out.',
    );
    expect(result.stdout).toContain(
      'Install into the current repository instead of your home folder.',
    );
    expect(result.stdout).toContain(
      'Find the repository from this directory instead of the current one.',
    );
    expect(result.stdout).toContain('-C, --directory');
    expect(result.stdout).toContain(
      'Replace skill files that something else wrote or that you changed.',
    );
    const group = run(box, ['skills', '--help']);
    expect(group.stdout).toContain("Install this application's agent skills.");
    expect(group.stdout).toContain('Bring installed skills up to date with this version.');
    expect(group.stdout).toContain('Remove the skills from your coding agents.');
    const removal = run(box, ['skills', 'uninstall', '--help']);
    expect(removal.stdout).toContain(
      'The agents to remove the skills from: claude or agents. Both when left out.',
    );
    expect(run(box, ['skills', 'update', '--agent', 'claude']).status).toBe(2);
  });
});
