/*
 * Acceptance plan for the skills folder (docs/plugins/skills.md#the-skills-folder).
 *
 * The folder is proven by in-process runs on a mock process of an application that installs
 * `skills({ folder })`, with a home, a state directory, and a repository in a temporary root:
 *
 * - An unbuilt run. A folder given as a URL, an absolute path, or a `file:` string installs each
 *   skill directory as one skill named for it, every file below it at its relative path, an
 *   executable file with mode 755, a link to a skill directory read through, and a link to a file
 *   inside a skill read as that file. A `README.md`, a link to a file, and a dot directory directly
 *   inside the folder are ignored. Folder skills install in name order, before the listed skills.
 * - Faults. A missing folder, a folder that holds no skill and no listed skill, a skill directory
 *   whose name is not a skill name, a link directly inside that names nothing, a link inside a
 *   skill to a folder, a link inside a skill to nothing, a skill with no SKILL.md, a listed skill that holds a folder
 *   skill's name, and a relative path each fail `install` with the pinned sentence and correction
 *   and write nothing. A built run with nothing carried says the build carried no folder.
 * - What reads. A Command outside `skills`, and `uninstall`, read no folder.
 * - What the artifact carried. Read through the seam that takes the carried value, a development
 *   build reads the source folder the define names, a distributed one reads the copy beside the
 *   base with the define's executable bits, and a build that read nothing, found no folder, or
 *   wrote an unknown format fails with the pinned sentence.
 */

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
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Application, Command, DeclarationError } from '@loomcli/core';
import type { ReleaseFacts } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';
import type { SkillsSettings } from '@loomcli/plugins/skills';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { ruleParts } from '../../../scripts/test-rules.js';
import { folderSkills } from '../src/skills/source.js';
import type { FolderRequest } from '../src/skills/source.js';
import { runOnMock } from './fixtures/in-process.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox: a home, a state directory, a repository, and the skills folder's place. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-skills-folder-'));
  roots.push(root);
  const box = {
    folder: join(root, 'app', 'skills'),
    home: join(root, 'home'),
    repo: join(root, 'repo'),
    root,
    state: join(root, 'state'),
  };
  for (const directory of [box.home, box.state, box.repo]) {
    mkdirSync(directory, { recursive: true });
  }
  return box;
}

type Box = ReturnType<typeof sandbox>;

/** Writes a file under a directory, creating its parents, executable when asked. */
function put(directory: string, path: string, body: string, executable = false) {
  const file = join(directory, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  chmodSync(file, executable ? 0o755 : 0o644);
}

/** The skill `notes` in a folder: its SKILL.md, a reference, and an executable script. */
function notesSkill(folder: string) {
  put(folder, 'notes/SKILL.md', '# Notes\n');
  put(folder, 'notes/references/commands.md', 'commands\n');
  put(folder, 'notes/scripts/run.sh', '#!/bin/sh\n', true);
}

/** Runs `notes ...argv` for an application whose skills plugin takes the settings. */
async function run(
  box: Box,
  settings: SkillsSettings,
  argv: string[],
  build: ReleaseFacts['build'] = 'source',
) {
  const application = new Application('notes', {
    description: 'Keep notes.',
    plugins: [skills(settings)],
  }).command(
    new Command('ping', { description: 'Answer.' }).action(({ out }) => out.print('pong')),
  );
  return await runOnMock(application, {
    argv,
    cwd: box.repo,
    env: { HOME: box.home, XDG_STATE_HOME: box.state },
    home: box.home,
    platform: 'linux',
    release: { build },
  });
}

/** Every entry under a path with its kind, permission bits, and content, without following a link. */
function tree(path: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (current: string, key: string) => {
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) {
      entries[key] = `link ${readlinkSync(current)}`;
    } else if (stats.isDirectory()) {
      entries[key] = 'directory';
      for (const name of readdirSync(current)) {
        walk(join(current, name), `${key}/${name}`);
      }
    } else {
      entries[key] = `file ${(stats.mode & 0o777).toString(8)} ${readFileSync(current, 'utf8')}`;
    }
  };
  walk(path, '.');
  return entries;
}

/** The installed folder of a skill for a target. */
function installed(box: Box, name: string, target: 'claude' | 'agents' = 'claude') {
  return join(box.home, `.${target}`, 'skills', name);
}

/** The lines a run wrote to stderr, each with any lane glyph and the space after it removed. */
function lines(stderr: string): string[] {
  return stderr
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\P{ASCII} /u, ''));
}

const notesTree = {
  '.': 'directory',
  './SKILL.md': 'file 644 # Notes\n',
  './references': 'directory',
  './references/commands.md': 'file 644 commands\n',
  './scripts': 'directory',
  './scripts/run.sh': 'file 755 #!/bin/sh\n',
};

describe('an unbuilt run', () => {
  it('installs each skill directory of a URL folder, its files at their paths and modes', async () => {
    const box = sandbox();
    notesSkill(box.folder);
    put(box.folder, 'README.md', 'Not a skill.\n');
    put(box.folder, '.drafts/SKILL.md', 'Not a skill.\n');
    put(box.root, 'shared/review/SKILL.md', '# Review\n');
    put(box.root, 'shared/review-tool.sh', '#!/bin/sh\n', true);
    symlinkSync(join(box.root, 'shared/review'), join(box.folder, 'review'));
    symlinkSync(join(box.root, 'shared/review-tool.sh'), join(box.folder, 'notes/scripts/tool.sh'));
    symlinkSync(join(box.folder, 'README.md'), join(box.folder, 'readme-link.md'));
    const result = await run(box, { folder: pathToFileURL(`${box.folder}/`) }, [
      'skills',
      'install',
      '--agent',
      'claude',
    ]);
    expect(result.stderr).not.toContain('--');
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual([
      `Installed notes for claude in ${installed(box, 'notes')}.`,
      `Installed review for claude in ${installed(box, 'review')}.`,
    ]);
    expect(tree(installed(box, 'notes'))).toEqual({
      ...notesTree,
      './scripts/tool.sh': 'file 755 #!/bin/sh\n',
    });
    expect(tree(installed(box, 'review'))).toEqual({
      '.': 'directory',
      './SKILL.md': 'file 644 # Review\n',
    });
    expect(readdirSync(join(box.home, '.claude', 'skills')).toSorted()).toEqual([
      'notes',
      'review',
    ]);
  });

  it.each([
    ['an absolute path', (box: Box) => box.folder],
    ['a file: string', (box: Box) => pathToFileURL(box.folder).href],
  ])('installs a folder named by %s', async (_name, folderOf) => {
    const box = sandbox();
    notesSkill(box.folder);
    const result = await run(box, { folder: folderOf(box) }, ['skills', 'install']);
    expect(result.status).toBe(0);
    expect(tree(installed(box, 'notes', 'agents'))).toEqual(notesTree);
  });

  it('installs the folder skills in name order before the listed skills', async () => {
    const box = sandbox();
    notesSkill(box.folder);
    put(box.folder, 'alpha/SKILL.md', '# Alpha\n');
    const listed = { files: () => [{ content: '# Listed\n', path: 'SKILL.md' }], name: 'listed' };
    const result = await run(box, { folder: box.folder, skills: [listed] }, [
      'skills',
      'install',
      '--agent',
      'claude',
    ]);
    expect(result.status).toBe(0);
    expect(lines(result.stderr)).toEqual(
      ['alpha', 'notes', 'listed'].map(
        (name) => `Installed ${name} for claude in ${installed(box, name)}.`,
      ),
    );
  });

  it('installs the listed skills from an empty folder', async () => {
    const box = sandbox();
    mkdirSync(box.folder, { recursive: true });
    const listed = { files: () => [{ content: '# Listed\n', path: 'SKILL.md' }], name: 'listed' };
    const result = await run(box, { folder: box.folder, skills: [listed] }, ['skills', 'install']);
    expect(result.status).toBe(0);
    expect(existsSync(installed(box, 'listed'))).toBe(true);
  });
});

/** One fault: how the folder is arranged, and the rule, sentence, and correction it draws. */
interface FolderFault {
  readonly arrange: (box: Box) => void;
  readonly settings?: (box: Box) => SkillsSettings;
  readonly build?: ReleaseFacts['build'];
  readonly rule: string;
  readonly sentence: (box: Box) => string;
  readonly correction: string;
}

/** Arranges the `notes` skill in the sandbox's folder. */
function notesSkillOf(box: Box) {
  notesSkill(box.folder);
}

const listedNotes = {
  files: () => [{ content: '# Listed\n', path: 'SKILL.md' }],
  name: 'notes',
};

const faults: Record<string, FolderFault> = {
  'a broken link directly inside the folder': {
    arrange: (box) => {
      notesSkill(box.folder);
      symlinkSync(join(box.root, 'gone'), join(box.folder, 'shared'));
    },
    correction: "Point the link at the skill's folder, or remove it.",
    rule: 'folder',
    sentence: (box) => `The skills folder ${box.folder} holds shared, a link that names nothing.`,
  },
  'a folder that holds no skill': {
    arrange: (box) => {
      put(box.folder, 'README.md', 'No skills yet.\n');
    },
    correction: 'Add a folder for each skill, holding its SKILL.md, such as skills/notes/SKILL.md.',
    rule: 'folder',
    sentence: (box) => `The skills folder ${box.folder} holds no skill.`,
  },
  'a link inside a skill that names a folder': {
    arrange: (box) => {
      notesSkill(box.folder);
      mkdirSync(join(box.root, 'lib64'));
      symlinkSync(join(box.root, 'lib64'), join(box.folder, 'notes/scripts/lib64'));
    },
    correction: "Replace the link with the folder's files, or remove it.",
    rule: 'folder',
    sentence: () =>
      'The skill notes holds scripts/lib64, a link to a folder, which a skill cannot hold.',
  },
  'a link inside a skill that names nothing': {
    arrange: (box) => {
      notesSkill(box.folder);
      symlinkSync(join(box.root, 'gone'), join(box.folder, 'notes/gone.md'));
    },
    correction: 'Replace it with the file it stands for, or remove it.',
    rule: 'folder',
    sentence: () => 'The skill notes holds gone.md, which is not a file or a folder.',
  },
  'a listed skill that holds a folder skill name': {
    arrange: notesSkillOf,
    correction: 'Give the listed skill another name, or remove it from the list or the folder.',
    rule: 'files',
    sentence: (box) =>
      `The skills setting lists the skill notes, which the skills folder ${box.folder} holds too.`,
    settings: (box) => ({ folder: box.folder, skills: [listedNotes] }),
  },
  'a missing folder': {
    arrange: () => undefined,
    correction: 'Create the folder, or name the folder that holds the skills.',
    rule: 'folder',
    sentence: (box) =>
      `Plugin "@loomcli/plugins/skills" setting "folder" names ${box.folder}, which is not a folder.`,
  },
  'a missing folder in a built run that carried none': {
    arrange: () => undefined,
    // A distributed build shows an operator the generic message, so a development one shows the diagnostic.
    build: 'development',
    correction:
      'Build with loom build at the version of @loomcli/plugins, which carries the folder skills() names.',
    rule: 'folder',
    sentence: (box) => `The build carried no skills folder, and ${box.folder} is not a folder.`,
  },
  'a relative path': {
    arrange: notesSkillOf,
    correction:
      "Name the folder with new URL('../skills', import.meta.url), resolved against the module that calls skills().",
    rule: 'folder',
    sentence: () =>
      'Plugin "@loomcli/plugins/skills" setting "folder" is the relative path ../skills, which only loom build resolves.',
    settings: () => ({ folder: '../skills' }),
  },
  'a skill directory that is not a skill name': {
    arrange: (box) => {
      notesSkill(box.folder);
      put(box.folder, 'My Notes/SKILL.md', '# Mine\n');
    },
    correction:
      "Name each skill's folder with lowercase letters, digits, and single hyphens, such as notes.",
    rule: 'folder',
    sentence: (box) =>
      `The skills folder ${box.folder} holds a folder that is not a skill name: My Notes.`,
  },
  'a skill with no SKILL.md': {
    arrange: (box) => {
      put(box.folder, 'notes/README.md', '# Notes\n');
    },
    correction: "Add the skill's SKILL.md at the top of its files.",
    rule: 'files',
    sentence: () => 'Skill "notes" lists no SKILL.md.',
  },
};

describe('faults', () => {
  it.each(Object.entries(faults))('%s fails install and writes nothing', async (_name, fault) => {
    const box = sandbox();
    fault.arrange(box);
    const settings = fault.settings?.(box) ?? { folder: box.folder };
    for (const argv of [
      ['skills', 'install'],
      ['skills', 'install', '--project'],
    ]) {
      const result = await run(box, settings, argv, fault.build);
      expect(result.status).toBe(1);
      expect(ruleParts(result.stderr)).toEqual({
        correction: fault.correction,
        identity: `@loomcli/plugins/skills/${fault.rule}`,
        sentence: fault.sentence(box),
      });
    }
    expect(existsSync(join(box.home, '.claude'))).toBe(false);
    expect(existsSync(join(box.home, '.agents'))).toBe(false);
    expect(existsSync(join(box.state, 'notes'))).toBe(false);
    expect(readdirSync(box.repo)).toEqual([]);
  });
});

describe('what reads the folder', () => {
  it('reads no folder for a Command outside skills or for uninstall', async () => {
    const box = sandbox();
    const settings = { folder: box.folder };
    const ping = await run(box, settings, ['ping']);
    expect(ping.status).toBe(0);
    expect(ping.stdout).toBe('pong\n');
    const uninstall = await run(box, settings, ['skills', 'uninstall']);
    expect(uninstall.status).toBe(0);
    expect(lines(uninstall.stderr)).toEqual([
      'notes has no skills installed in your home folder, so there is nothing to remove.',
    ]);
  });
});

/** The folder skills of a request, each file's content as text, or the fault's parts. */
function read(request: Partial<FolderRequest> & Pick<FolderRequest, 'carried'>) {
  try {
    return folderSkills({
      base: 'file:///nowhere/main.js',
      build: 'distributed',
      listed: [],
      setting: '../skills',
      ...request,
    }).map(({ files, name }) => ({
      files: files.map(({ content, executable, path }) => ({
        content: typeof content === 'string' ? content : Buffer.from(content).toString('utf8'),
        executable,
        path,
      })),
      name,
    }));
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    return { correction: error.correction, rule: error.rule?.identity, sentence: error.sentence };
  }
}

describe('what the artifact carried', () => {
  it('reads the source folder a development build names, whatever the setting says', () => {
    const box = sandbox();
    notesSkill(box.folder);
    const carried = { folder: box.folder, format: 1, kind: 'source' };
    expect(read({ build: 'development', carried })).toEqual([
      {
        files: [
          { content: '# Notes\n', executable: false, path: 'SKILL.md' },
          { content: 'commands\n', executable: false, path: 'references/commands.md' },
          { content: '#!/bin/sh\n', executable: true, path: 'scripts/run.sh' },
        ],
        name: 'notes',
      },
    ]);
  });

  it('reads the copy beside the base, executable as the define names it', () => {
    const box = sandbox();
    const out = join(box.root, 'dist');
    put(out, 'loom-skills/notes/SKILL.md', '# Notes\n');
    put(out, 'loom-skills/notes/scripts/run me #1.sh', '#!/bin/sh\n');
    const carried = {
      format: 1,
      kind: 'carried',
      skills: [
        {
          files: [
            { executable: false, path: 'SKILL.md' },
            { executable: true, path: 'scripts/run me #1.sh' },
          ],
          name: 'notes',
        },
      ],
    };
    const base = pathToFileURL(join(out, 'chunk-abc.js')).href;
    expect(read({ base, carried })).toEqual([
      {
        files: [
          { content: '# Notes\n', executable: false, path: 'SKILL.md' },
          { content: '#!/bin/sh\n', executable: true, path: 'scripts/run me #1.sh' },
        ],
        name: 'notes',
      },
    ]);
  });

  const exportCorrection =
    'Export the Application from the module paths.application names, src/application.ts by convention, call skills() as it loads, and build again.';
  const versions = {
    correction: 'Install @loomcli/plugins and @loomcli/loom at one version, and build again.',
    rule: '@loomcli/plugins/skills/folder',
    sentence:
      'This @loomcli/plugins cannot read the skills folder the installed @loomcli/loom carried.',
  };

  it.each([
    [
      'a build that read nothing',
      { format: 1, kind: 'unread' },
      {
        correction: exportCorrection,
        rule: '@loomcli/plugins/skills/folder',
        sentence:
          'loom build could not read the skills folder, because it could not load the application module.',
      },
    ],
    [
      'a build that found no folder',
      { format: 1, kind: 'none' },
      {
        correction: exportCorrection,
        rule: '@loomcli/plugins/skills/folder',
        sentence: 'loom build found no skills folder in the application module.',
      },
    ],
    ['an unknown format', { format: 2, kind: 'carried', skills: [] }, versions],
    ['an unknown kind', { format: 1, kind: 'embedded' }, versions],
    ['a malformed copy', { format: 1, kind: 'carried', skills: [{ name: 'notes' }] }, versions],
    ['a value that is not an object', 'skills', versions],
  ])('fails for %s', (_name, carried, expected) => {
    expect(read({ carried })).toEqual(expected);
  });

  it('reads nothing for a setting that names no folder, whatever was carried', () => {
    expect(read({ carried: { format: 1, kind: 'unread' }, setting: undefined })).toEqual([]);
  });
});
