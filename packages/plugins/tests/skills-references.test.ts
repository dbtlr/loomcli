// @module-tag docs
/*
 * Acceptance plan for generated command references (docs/plugins/skills.md#command-references).
 *
 * The references are proven by in-process runs on a mock process, and by `commandReferences` and
 * `skillFolders` over graphs the test builds:
 *
 * - Rendering. Over the page's application, the index and one file per selected Command match the
 *   golden files in `fixtures/skill-references/` byte for byte, and those are the page's worked
 *   examples. Text is escaped, labels are code spans, the author's Markdown is inserted as written,
 *   options show no alias, and the index lists the visible globals; guidance can be left out.
 * - Selecting. Paths overlap, a hidden Command and everything under it give no file, and paths that
 *   select only hidden Commands give nothing.
 * - Judged at build. A path that names no Command, two Commands that give one file, and a root
 *   whose file is the index's each fail the build with the pinned diagnostic.
 * - Installing. `install`, `update`, and a project install write the author's files and the
 *   generated files as one folder; the author's files are unchanged, a hand-written file under
 *   `references/commands/` that is no owned name installs, and an author's file at an owned name is
 *   left out with its `-vv` line. `update` after a graph change rewrites the skill.
 * - Reading outside an install. `skillFolders` returns what an install writes, keeps two
 *   applications apart, returns `undefined` with no skills plugin, and refuses an entry of an
 *   unknown format.
 */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Application, Command, DeclarationError, FatalError, plugin } from '@loomcli/core';
import type { CommandGraph, LogEvent } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { commandReferences, skillFolders, skills } from '@loomcli/plugins/skills';
import type { FolderSkillsSettings, Skill, SkillsSettings } from '@loomcli/plugins/skills';
import { skillCommand } from '@loomcli/plugins/skills/extension';
import { verbose } from '@loomcli/plugins/verbose';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { ruleParts } from '../../../scripts/test-rules.js';
import { runOnMock } from './fixtures/in-process.js';
import { notesApplication } from './fixtures/skill-references-app.js';

const golden = new URL('fixtures/skill-references/', import.meta.url);

/** One golden file's text. */
function goldenFile(name: string): string {
  return readFileSync(new URL(name, golden), 'utf8');
}

/** The golden files of the page's `note` subtree, by their path in an installed skill. */
function goldenReferences(): Record<string, string> {
  return Object.fromEntries(
    ['index.md', 'notes-note.md', 'notes-note-add.md', 'notes-note-list.md'].map((name) => [
      `references/commands/${name}`,
      `644 ${goldenFile(name)}`,
    ]),
  );
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox: a home, a state directory, a repository holding `.git`, and the skills folder. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-skill-references-'));
  roots.push(root);
  const box = {
    folder: join(root, 'app', 'skills'),
    home: join(root, 'home'),
    repo: join(root, 'repo'),
    root,
    state: join(root, 'state'),
  };
  // The repository's `.git` ends a project install's walk inside the sandbox.
  for (const directory of [box.home, box.state, join(box.repo, '.git'), box.folder]) {
    mkdirSync(directory, { recursive: true });
  }
  return box;
}

type Box = ReturnType<typeof sandbox>;

/** Writes a file under a directory, creating its parents. */
function put(directory: string, path: string, body: string) {
  const file = join(directory, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  chmodSync(file, 0o644);
}

/** Every file below a folder by its relative path, as its permission bits and its text. */
function files(folder: string): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (directory: string, prefix: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (lstatSync(path).isDirectory()) {
        walk(path, `${prefix}${name}/`);
      } else {
        found[`${prefix}${name}`] =
          `${(lstatSync(path).mode & 0o777).toString(8)} ${readFileSync(path, 'utf8')}`;
      }
    }
  };
  walk(folder, '');
  return found;
}

/** The author's `notes` skill: its own files, a kept file under `references/commands/`, and three at owned names. */
const authored: Record<string, string> = {
  'SKILL.md': '# Notes\n',
  'references/commands/deep/notes-x.md': 'Below the folder.\n',
  'references/commands/index.md': 'An old index.\n',
  'references/commands/notes-deep/a.md': 'In a folder named like a reference.\n',
  'references/commands/notes-old.md': 'A Command since removed.\n',
  'references/commands/notes-x.markdown': 'Long extension.\n',
  'references/commands/notes.md': 'An old root.\n',
  'references/commands/notes.txt': 'Not Markdown.\n',
  'references/commands/notesx.md': 'Another prefix.\n',
  'references/commands/overview.md': 'How the Commands fit together.\n',
  'references/commands/sub/index.md': 'Nested index.\n',
  'references/workflow.md': 'Take a note, then list the notes.\n',
};

/** The author's files an install keeps: every one but those at a name the plugin owns. */
const kept: Record<string, string> = Object.fromEntries(
  Object.entries(authored)
    .filter(
      ([path]) =>
        ![
          'references/commands/index.md',
          'references/commands/notes-old.md',
          'references/commands/notes.md',
        ].includes(path),
    )
    .map(([path, body]) => [path, `644 ${body}`]),
);

/** Writes the author's `notes` skill into the skills folder. */
function authorNotes(box: Box) {
  for (const [path, body] of Object.entries(authored)) {
    put(join(box.folder, 'notes'), path, body);
  }
}

/** The page's settings: the folder, and an entry without files that selects `note`. */
function pageSettings(box: Box): FolderSkillsSettings {
  return { folder: box.folder, skills: [{ commands: [['note']], name: 'notes' }] };
}

/** Runs an application on a mock process in the sandbox. */
async function run(box: Box, application: Pick<Application, 'run'>, argv: string[]) {
  return await runOnMock(application, {
    argv,
    cwd: box.repo,
    env: { HOME: box.home, XDG_STATE_HOME: box.state },
    home: box.home,
    platform: 'linux',
    release: { build: 'source' },
  });
}

/** The installed `notes` folder of a target. */
function installed(box: Box, target: 'claude' | 'agents' = 'claude') {
  return join(box.home, `.${target}`, 'skills', 'notes');
}

/** The lines a run wrote to stderr, each with any lane glyph and the space after it removed. */
function lines(stderr: string): string[] {
  return stderr
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\P{ASCII} /u, ''));
}

/** The parts of the `DeclarationError` a call throws. */
function thrown(call: () => unknown) {
  try {
    call();
  } catch (error) {
    if (error instanceof DeclarationError) {
      return { correction: error.correction, rule: error.rule?.identity, sentence: error.sentence };
    }
    throw error;
  }
  return undefined;
}

const listedNotes: Skill = {
  files: () => [{ content: '# Notes\n', path: 'SKILL.md' }],
  name: 'notes',
};

describe('the command references of a selected subtree', () => {
  it('writes the index and each selected Command file as the golden files hold them', () => {
    const graph = notesApplication({ skills: [listedNotes] }).inspect();
    const references = commandReferences(graph, { commands: [['note']], guidance: true });
    expect(references.map(({ name }) => name)).toStrictEqual([
      'index.md',
      'notes-note.md',
      'notes-note-add.md',
      'notes-note-list.md',
    ]);
    for (const file of references) {
      expect(file.content).toBe(goldenFile(file.name));
    }
  });

  it('matches the worked examples on the page', () => {
    const page = readFileSync(new URL('../../../docs/plugins/skills.md', import.meta.url), 'utf8');
    for (const name of ['index.md', 'notes-note-list.md', 'notes-note-add.md']) {
      const text = goldenFile(name);
      const fence = name === 'index.md' ? '```' : '````';
      expect(page).toContain(`${fence}markdown\n${text}${fence}\n`);
    }
  });

  it('leaves out the guidance when asked, and selects a Command two paths name once', () => {
    const graph = notesApplication({ skills: [listedNotes] }).inspect();
    const references = commandReferences(graph, {
      commands: [['note', 'list'], ['note'], ['note', 'list']],
      guidance: false,
    });
    expect(references.map(({ name }) => name)).toStrictEqual([
      'index.md',
      'notes-note.md',
      'notes-note-add.md',
      'notes-note-list.md',
    ]);
    const guidance =
      '## Guidance\n\nRead each row with `--format json`, and pass its `id` to the Command that changes a note.\n\n';
    expect(goldenFile('notes-note-list.md')).toContain(guidance);
    expect(references.at(-1)?.content).toBe(goldenFile('notes-note-list.md').replace(guidance, ''));
  });

  it('gives no file for nothing selected or for hidden Commands alone', () => {
    const application = new Application('kit')
      .command(
        new Command('secret', { hidden: true }).command(
          new Command('inner', { description: 'Under a hidden Command.' }).action(() => {}),
        ),
      )
      .command(new Command('shown', { description: 'Shown.' }).action(() => {}));
    const graph = application.inspect();
    expect(commandReferences(graph, { commands: [], guidance: true })).toStrictEqual([]);
    expect(
      commandReferences(graph, { commands: [['secret'], ['secret', 'inner']], guidance: true }),
    ).toStrictEqual([]);
    expect(
      commandReferences(graph, { commands: [[]], guidance: true }).map(({ name }) => name),
    ).toStrictEqual(['index.md', 'kit.md', 'kit-shown.md']);
  });
});

/** An application whose texts and inputs reach every escaping and cell rule. */
function escapingApplication() {
  const get = new Command('get', {
    deprecated: 'Use\nread instead.',
    description: '1. Read <path> & see &amp; or [x] *now*_ok a_b _c NOTES_TAG `t`',
    extensions: [
      skillCommand({ guidance: '\r\n\n  \n    indented code\r\nline two  \n\n' }),
      helpCommand({ details: '# First\n' }),
      // The author's value collects first, and help's details follow it.
      manifestCommand({
        details: '\n\nSecond.',
        examples: [{ command: 'get `x`' }, { command: 'get a', note: '- one' }],
      }),
    ],
  })
    .visibleAlias('read', 'fetch')
    .argument('path', { default: 'a.json', description: '# The file.', type: 'string' })
    .passthrough({ description: 'Arguments for the reader.' })
    .option('file', {
      description: 'The file.',
      short: 'f',
      type: 'string',
      visibleAliases: ['input'],
    })
    .option('metric', { description: 'The metric.', short: 'm', shortOnly: true, type: 'string' })
    .option('verbose', { short: 'v', type: 'count' })
    .option('backup', { description: 'Back up.', implied: 'simple', short: 'b', type: 'string' })
    .option('color', { description: '> Color it.', polarity: 'both', type: 'boolean' })
    .option('secret', { hidden: true, type: 'boolean' })
    .action(() => {});
  return new Application('index-tools', {
    description: '+ Tools.',
    plugins: [help()],
    version: '1.10',
  })
    .globalOption('trace', { description: 'Trace & log.', type: 'boolean' })
    .globalOption('quiet-hidden', { hidden: true, type: 'boolean' })
    .command(get);
}

describe('the text a command reference shows', () => {
  it('escapes shown text, writes labels as code spans, and inserts Markdown as written', () => {
    const references = commandReferences(escapingApplication().inspect(), {
      commands: [['get']],
      guidance: true,
    });
    expect(references.map(({ name }) => name)).toStrictEqual(['index.md', 'index-tools-get.md']);
    expect(references[0]?.content).toBe(
      [
        '---',
        'application: "index-tools"',
        'version: "1.10"',
        '---',
        '',
        '# index-tools commands',
        '',
        '- [index-tools get](index-tools-get.md): 1. Read \\<path> & see \\&amp; or \\[x] \\*now\\*\\_ok a_b \\_c NOTES_TAG \\`t\\` (aliases: read, fetch, deprecated)',
        '',
        '## Global options',
        '',
        '- `--trace`: Trace & log.',
        '- `--help`: Show this help.',
        '',
      ].join('\n'),
    );
    expect(references[1]?.content).toBe(
      [
        '# index-tools get',
        '',
        'Aliases: read, fetch',
        '',
        'Deprecated: Use read instead.',
        '',
        '1\\. Read \\<path> & see \\&amp; or \\[x] \\*now\\*\\_ok a_b \\_c NOTES_TAG \\`t\\`',
        '',
        '## Usage',
        '',
        '```text',
        'index-tools get [path] [options] [-- <args>...]',
        '```',
        '',
        '## Arguments',
        '',
        '- `path`: # The file.  (default: a.json)',
        '- `-- <args>...`: Arguments for the reader.',
        '',
        '## Options',
        '',
        '- `--file <file>`: The file.',
        '- `-m <metric>`: The metric.',
        '- `--verbose...`',
        '- `--backup[=<backup>]`: Back up.  (implied: simple)',
        '- `--[no-]color`: > Color it.',
        '',
        '## Guidance',
        '',
        '    indented code',
        'line two  ',
        '',
        '## Details',
        '',
        'Second.',
        '',
        '# First',
        '',
        '## Examples',
        '',
        '- `` index-tools get `x` ``',
        '- `index-tools get a`: - one',
        '',
      ].join('\n'),
    );
  });
});

/** An application whose `config set` and `config-set` give one file, unless the latter is hidden. */
function configApplication(hidden: boolean) {
  return new Application('notes', {
    plugins: [skills({ skills: [{ ...listedNotes, commands: [[]] }] })],
  })
    .command(
      new Command('config').command(new Command('set', { description: 'Set.' }).action(() => {})),
    )
    .command(new Command('config-set', { hidden }).action(() => {}));
}

/** An application named `index` whose skill `tools` selects the given paths. */
function toolsApplication(commands: readonly (readonly string[])[]) {
  return new Application('index', {
    plugins: [skills({ skills: [{ commands, files: listedNotes.files, name: 'tools' }] })],
  }).command(new Command('get').action(() => {}));
}

/** A Command whose guidance is whitespace alone. */
function blankGuidance() {
  return new Command('get', { extensions: [skillCommand({ guidance: ' \n ' })] });
}

describe('judged at build', () => {
  it('fails the build for a path that names no Command', async () => {
    const box = sandbox();
    const application = notesApplication({
      skills: [{ ...listedNotes, commands: [['note'], ['note', 'show']] }],
    });
    const expected = {
      correction:
        'Name each Command on the path from the root down, such as ["note", "add"], or select [] for the whole application.',
      rule: '@loomcli/plugins/skills/commands',
      sentence: 'Skill "notes" selects the path ["note", "show"], which names no Command.',
    };
    expect(thrown(() => application.inspect())).toStrictEqual(expected);
    const result = await run(box, application, ['note', 'list']);
    expect(result.status).toBe(1);
    expect(ruleParts(result.stderr)).toStrictEqual({
      correction: expected.correction,
      identity: expected.rule,
      sentence: expected.sentence,
    });
    expect(
      thrown(() =>
        commandReferences(notesApplication({ skills: [listedNotes] }).inspect(), {
          commands: [['note', 'show']],
          guidance: true,
        }),
      ),
    ).toStrictEqual({ ...expected, sentence: 'The path ["note", "show"] names no Command.' });
  });

  it('fails the build for two Commands that give one file, unless one is hidden', () => {
    const correction = 'Rename one of them, hide one, or select one of them alone.';
    expect(thrown(() => configApplication(false).inspect())).toStrictEqual({
      correction,
      rule: '@loomcli/plugins/skills/reference-name-taken',
      sentence:
        'Skill "notes" selects Commands "config set" and "config-set", which both give the file references/commands/notes-config-set.md.',
    });
    expect(thrown(() => configApplication(true).inspect())).toBeUndefined();
    const graph = new Application('notes')
      .command(new Command('config').command(new Command('set').action(() => {})))
      .command(new Command('config-set').action(() => {}))
      .inspect();
    expect(
      thrown(() => commandReferences(graph, { commands: [[]], guidance: true })),
    ).toStrictEqual({
      correction,
      rule: '@loomcli/plugins/skills/reference-name-taken',
      sentence: 'Commands "config set" and "config-set" both give the file notes-config-set.md.',
    });
  });

  it('fails the build for a selected root whose file is the index', () => {
    const correction =
      'Select the root\'s Commands by their own paths, such as ["get"], in place of [].';
    expect(thrown(() => toolsApplication([[]]).inspect())).toStrictEqual({
      correction,
      rule: '@loomcli/plugins/skills/reference-name-taken',
      sentence:
        'Skill "tools" selects the root of index, whose file references/commands/index.md is the name of the index.',
    });
    const graph = toolsApplication([['get']]).inspect();
    expect(
      thrown(() => commandReferences(graph, { commands: [[]], guidance: true })),
    ).toStrictEqual({
      correction,
      rule: '@loomcli/plugins/skills/reference-name-taken',
      sentence: 'The root of index gives the file index.md, which is the name of the index.',
    });
  });
});

describe('installing a selecting skill', () => {
  it('writes the author files and the generated files as one folder, leaving out owned names', async () => {
    const box = sandbox();
    authorNotes(box);
    const before = files(box.folder);
    const events: LogEvent[] = [];
    const observer = plugin('fixture/observer', {
      onLog: (event) => {
        events.push(event);
        return undefined;
      },
    });
    const application = notesApplication(pageSettings(box), [observer]);
    const result = await run(box, application, ['skills', 'install', '--agent', 'claude']);
    expect(result.status).toBe(0);
    expect(files(installed(box))).toStrictEqual({ ...kept, ...goldenReferences() });
    expect(files(box.folder)).toStrictEqual(before);
    expect(
      events
        .filter(
          ({ level, plugin: from }) => level === 'trace' && from === '@loomcli/plugins/skills',
        )
        .map(({ fields, message, plugin: from }) => ({ fields, message, plugin: from })),
    ).toStrictEqual(
      ['index.md', 'notes-old.md', 'notes.md'].map((name) => ({
        fields: { path: `references/commands/${name}`, skill: 'notes' },
        message:
          'Left out {path}, which the skill {skill} supplies, because the plugin owns that name for its command references.',
        plugin: '@loomcli/plugins/skills',
      })),
    );
    expect(lines(result.stderr)).toStrictEqual([
      `Installed notes for claude in ${installed(box)}.`,
    ]);
  });

  it('says at -vv which author file it left out', async () => {
    const box = sandbox();
    put(join(box.folder, 'notes'), 'SKILL.md', '# Notes\n');
    put(join(box.folder, 'notes'), 'references/commands/notes.md', 'An old root.\n');
    const application = notesApplication(pageSettings(box), [verbose()]);
    const result = await run(box, application, ['skills', 'update', '-vv']);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      'Left out references/commands/notes.md, which the skill notes supplies, because the plugin owns that name for its command references.',
    );
  });

  it('writes the same folder into a project', async () => {
    const box = sandbox();
    authorNotes(box);
    const application = notesApplication(pageSettings(box));
    const result = await run(box, application, ['skills', 'install', '--project']);
    expect(result.status).toBe(0);
    for (const target of ['claude', 'agents']) {
      expect(files(join(box.repo, `.${target}`, 'skills', 'notes'))).toStrictEqual({
        ...kept,
        ...goldenReferences(),
      });
    }
  });

  it('keeps every author file of a skill that selects no Command', async () => {
    const box = sandbox();
    authorNotes(box);
    const result = await run(box, notesApplication({ folder: box.folder }), [
      'skills',
      'install',
      '--agent',
      'claude',
    ]);
    expect(result.status).toBe(0);
    expect(files(installed(box))).toStrictEqual(
      Object.fromEntries(Object.entries(authored).map(([path, body]) => [path, `644 ${body}`])),
    );
  });

  it('updates the skill when the graph changes, and leaves it when it does not', async () => {
    const box = sandbox();
    authorNotes(box);
    const before = files(box.folder);
    const settings: FolderSkillsSettings = {
      folder: box.folder,
      skills: [{ commands: [[]], name: 'notes' }],
    };
    const first = await run(box, notesApplication(settings), ['skills', 'install']);
    expect(first.status).toBe(0);
    const same = await run(box, notesApplication(settings), ['skills', 'update']);
    expect(lines(same.stderr)).toStrictEqual([
      `${installed(box)} is unchanged.`,
      `${installed(box, 'agents')} is unchanged.`,
    ]);
    const grown = notesApplication(settings).command(
      new Command('tags', { description: 'List the tags.' }).action(() => {}),
    );
    const changed = await run(box, grown, ['skills', 'update']);
    expect(lines(changed.stderr)).toStrictEqual([
      `Updated notes for claude in ${installed(box)}.`,
      `Updated notes for agents in ${installed(box, 'agents')}.`,
    ]);
    expect(readFileSync(join(installed(box), 'references/commands/notes-tags.md'), 'utf8')).toBe(
      '# notes tags\n\nList the tags.\n\n## Usage\n\n```text\nnotes tags [options]\n```\n',
    );
    expect(readFileSync(join(installed(box), 'references/commands/index.md'), 'utf8')).toContain(
      '- [notes tags](notes-tags.md): List the tags.\n',
    );
    expect(files(box.folder)).toStrictEqual(before);
  });
});

describe('reading skills outside an install', () => {
  it('returns every file an install writes, the generated files included', async () => {
    const box = sandbox();
    authorNotes(box);
    const application = notesApplication(pageSettings(box));
    const folders = await skillFolders(application.inspect());
    await run(box, application, ['skills', 'install', '--agent', 'claude']);
    expect(folders?.map(({ name }) => name)).toStrictEqual(['notes']);
    const [notes] = folders ?? [];
    expect(
      Object.fromEntries(
        (notes?.files ?? []).map(({ content, executable, path }) => [
          path,
          `${executable ? '755' : '644'} ${typeof content === 'string' ? content : Buffer.from(content).toString('utf8')}`,
        ]),
      ),
    ).toStrictEqual(files(installed(box)));
    expect(notes?.files.slice(-4).map(({ path }) => path)).toStrictEqual([
      'references/commands/index.md',
      'references/commands/notes-note.md',
      'references/commands/notes-note-add.md',
      'references/commands/notes-note-list.md',
    ]);
  });

  it('keeps two applications apart, and resolves a relative folder against the module directory', async () => {
    const box = sandbox();
    authorNotes(box);
    const review: Skill = {
      files: () => [{ content: '# Review\n', path: 'SKILL.md' }],
      name: 'review',
    };
    const first = notesApplication({ folder: 'skills', skills: [{ commands: [], name: 'notes' }] });
    const firstGraph = first.inspect();
    const secondGraph = new Application('review', {
      plugins: [skills({ skills: [review] })],
    }).inspect();
    const folders = await skillFolders(firstGraph, { moduleDirectory: join(box.root, 'app') });
    expect(folders?.map(({ name }) => name)).toStrictEqual(['notes']);
    const others = await skillFolders(secondGraph);
    expect(others?.map(({ name }) => name)).toStrictEqual(['review']);
  });

  it('rejects as the loader rejects, and with the folder fault an install raises', async () => {
    const box = sandbox();
    const failing: Skill = {
      files: () => {
        throw new FatalError('The loader failed.');
      },
      name: 'notes',
    };
    const graph = new Application('notes', { plugins: [skills({ skills: [failing] })] }).inspect();
    await expect(skillFolders(graph)).rejects.toThrow('The loader failed.');
    const missing = new Application('notes', {
      plugins: [skills({ folder: join(box.root, 'missing') })],
    }).inspect();
    await expect(skillFolders(missing)).rejects.toMatchObject({
      correction: 'Create the folder, or name the folder that holds the skills.',
      rule: { identity: '@loomcli/plugins/skills/folder' },
      sentence: `Plugin "@loomcli/plugins/skills" setting "folder" names ${join(box.root, 'missing')}, which is not a folder.`,
    });
  });

  it('resolves to undefined for an application without the skills plugin or a copied graph', async () => {
    const plain = new Application('plain', { plugins: [help()] })
      .command(new Command('get').action(() => {}))
      .inspect();
    await expect(skillFolders(plain)).resolves.toBeUndefined();
    const graph = new Application('notes', {
      plugins: [skills({ skills: [listedNotes] })],
    }).inspect();
    const copy: CommandGraph = { ...graph };
    await expect(skillFolders(copy)).resolves.toBeUndefined();
  });

  it('refuses an entry whose format this copy does not know', async () => {
    const graph = new Application('notes', {
      plugins: [skills({ skills: [listedNotes] })],
    }).inspect();
    const recorded: unknown = Reflect.get(globalThis, Symbol.for('@loomcli/plugins/skills/graphs'));
    if (!(recorded instanceof WeakMap)) {
      throw new TypeError('The skills plugin recorded no graph.');
    }
    recorded.set(graph, { format: 2, read: () => Promise.resolve([]) });
    const error: unknown = await skillFolders(graph).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(DeclarationError);
    expect(error).toMatchObject({
      correction: 'Install @loomcli/plugins at one version, and run again.',
      rule: { identity: '@loomcli/plugins/skills/folder' },
      sentence:
        "This @loomcli/plugins cannot read the skills the application's @loomcli/plugins recorded.",
    });
  });
});

describe('skill guidance', () => {
  it('rejects guidance that is whitespace alone through the extension value rule', () => {
    expect(thrown(blankGuidance)?.rule).toBe('@loomcli/core/invalid-extension-value');
  });
});

describe('the settings type', () => {
  it('takes an entry without files only beside a folder', () => {
    const settings: (SkillsSettings | FolderSkillsSettings)[] = [
      { folder: 'skills', skills: [{ commands: [['note']], name: 'notes' }] },
      // @ts-expect-error An entry without files names a folder skill, so it needs a folder.
      { skills: [{ commands: [['note']], name: 'notes' }] },
    ];
    expect(settings).toHaveLength(2);
  });

  it('keeps SkillsSettings an interface an author can extend, in the shape earlier releases had', () => {
    interface TeamSettings extends SkillsSettings {
      readonly team: string;
    }
    const earlier: TeamSettings = { folder: 'skills', skills: [], team: 'docs' };
    // The claim is the compile: `skills()` takes a value of a type that extends the interface.
    expect(skills(earlier)).toBeDefined();
  });
});

/** The whole file of one selected leaf, with no plugin contributing options. */
function leafReference(command: Command) {
  return commandReferences(new Application('p8').command(command).inspect(), {
    commands: [['get']],
    guidance: true,
  })[1]?.content;
}

describe('exact command reference text witnesses', () => {
  it.each([
    [String.raw`a \# b`, String.raw`a \\# b`],
    ['&#42;', String.raw`\&#42;`],
    ['# hash', String.raw`\# hash`],
    ['> quote', String.raw`\> quote`],
    ['+ plus', String.raw`\+ plus`],
    ['- dash', String.raw`\- dash`],
    ['~~~ warning', String.raw`\~~~ warning`],
    ['~~~~x', String.raw`\~~~~x`],
    ['~/notes and ~~ two', '~/notes and ~~ two'],
    ['1) paren', String.raw`1\) paren`],
    ['12. twelve', String.raw`12\. twelve`],
    ['v1_2', 'v1_2'],
    ['foo_ bar', String.raw`foo\_ bar`],
    [' \tedge \t', 'edge'],
    ...['\r\n', '\n', '\v', '\f', '\r', '\u0085', '\u2028', '\u2029'].map((terminator) => [
      `a${terminator}b`,
      'a b',
    ]),
  ])('shows description %j as %j', (description, expected) => {
    expect(leafReference(new Command('get', { description }).action(() => {}))).toBe(
      `# p8 get\n\n${expected}\n\n## Usage\n\n\`\`\`text\np8 get [options]\n\`\`\`\n`,
    );
  });

  it.each([
    ['\t\nG\n\t \n', 'G'],
    ['G\u2028H\rI', 'G\nH\nI'],
    ...['\r\n', '\n', '\v', '\f', '\r', '\u0085', '\u2029'].map((terminator) => [
      `G${terminator}H`,
      'G\nH',
    ]),
  ])('keeps guidance %j as %j', (guidance, expected) => {
    const command = new Command('get', { extensions: [skillCommand({ guidance })] }).action(
      () => {},
    );
    expect(leafReference(command)).toBe(
      `# p8 get\n\n## Usage\n\n\`\`\`text\np8 get [options]\n\`\`\`\n\n## Guidance\n\n${expected}\n`,
    );
  });

  it('says a Command needs a terminal, between its aliases and its deprecation', () => {
    const command = new Command('get', { deprecated: 'Use open.', description: 'Edit a note.' })
      .visibleAlias('e')
      .needsTerminal()
      .action(() => {});
    const graph = new Application('p8').command(command).inspect();
    const [index, file] = commandReferences(graph, { commands: [['get']], guidance: true });
    expect(file?.content).toBe(
      `# p8 get\n\nAlias: e\n\nNeeds a terminal: stdin and stderr, outside CI.\n\nDeprecated: Use open.\n\nEdit a note.\n\n## Usage\n\n\`\`\`text\np8 get [options]\n\`\`\`\n`,
    );
    expect(index?.content).toContain(
      '- [p8 get](p8-get.md): Edit a note. (alias: e, needs a terminal, deprecated)\n',
    );
  });

  it('escapes right cells and failure meanings, and pads an example with two backticks', () => {
    const command = new Command('get', {
      extensions: [
        manifestCommand({
          examples: [{ command: '``x``', note: 'Read <path> *x*' }],
          failures: [{ failure: FatalError, meaning: 'Read <path> *now*' }],
        }),
      ],
    })
      .argument('path', { description: 'Read <path> *x*', type: 'string' })
      .option('file', { description: 'Read <path> *x*', type: 'string' })
      .action(() => {});
    expect(leafReference(command)).toBe(
      [
        '# p8 get',
        '',
        '## Usage',
        '',
        '```text',
        'p8 get [path] [options]',
        '```',
        '',
        '## Arguments',
        '',
        '- `path`: Read \\<path> \\*x\\*',
        '',
        '## Options',
        '',
        '- `--file <file>`: Read \\<path> \\*x\\*',
        '',
        '## Examples',
        '',
        '- ``` p8 ``x`` ```: Read \\<path> \\*x\\*',
        '',
        '## Failures',
        '',
        '- `fatal` (exit 1): Read \\<path> \\*now\\*',
        '',
      ].join('\n'),
    );
  });

  it.each(['_get', 'get_'])('escapes the Command name %s in its heading and index link', (name) => {
    const graph = new Application('p8').command(new Command(name).action(() => {})).inspect();
    const escaped = name === '_get' ? String.raw`\_get` : String.raw`get\_`;
    const references = commandReferences(graph, { commands: [[name]], guidance: false });
    expect(references[0]?.content).toBe(
      `---\napplication: "p8"\nversion: "0.0.0"\n---\n\n# p8 commands\n\n- [p8 ${escaped}](p8-${name}.md)\n`,
    );
    expect(references[1]?.content).toBe(
      `# p8 ${escaped}\n\n## Usage\n\n\`\`\`text\np8 ${name} [options]\n\`\`\`\n`,
    );
  });

  it('keeps Arguments before optional Input, escaping its paragraph without prefixing Usage', () => {
    const command = new Command('get')
      .argument('path', { type: 'string' })
      .stdin({ description: '- The text.' })
      .action(() => {});
    expect(leafReference(command)).toBe(
      [
        '# p8 get',
        '',
        '## Usage',
        '',
        '```text',
        'p8 get [path] [options]',
        '```',
        '',
        '## Arguments',
        '',
        '- `path`',
        '',
        '## Input',
        '',
        String.raw`\- The text.`,
        '',
        'Optional. Reads piped or redirected stdin. Terminal input is not accepted.',
        '',
        String.raw`Example: \<producer> | p8 get`,
        '',
      ].join('\n'),
    );
  });

  it('counts no hidden child in an action Usage form or the Arguments rows', () => {
    const command = new Command('get')
      .argument('path', { type: 'string' })
      .command(new Command('secret', { hidden: true }).action(() => {}))
      .action(() => {});
    expect(leafReference(command)).toBe(
      [
        '# p8 get',
        '',
        '## Usage',
        '',
        '```text',
        'p8 get [path] [options]',
        '```',
        '',
        '## Arguments',
        '',
        '- `path`',
        '',
      ].join('\n'),
    );
  });

  it('separates two option-group sentences with exactly one blank line', () => {
    const command = new Command('get')
      .option('a', { type: 'boolean' })
      .option('b', { type: 'boolean' })
      .option('c', { type: 'boolean' })
      .option('d', { type: 'boolean' })
      .exclusive('a', 'b')
      .requiredTogether('c', 'd')
      .action(() => {});
    expect(leafReference(command)).toBe(
      [
        '# p8 get',
        '',
        '## Usage',
        '',
        '```text',
        'p8 get [options]',
        '```',
        '',
        '## Options',
        '',
        '- `--a`',
        '- `--b`',
        '- `--c`',
        '- `--d`',
        '',
        'Use at most one of --a and --b.',
        '',
        'Use --c and --d together.',
        '',
      ].join('\n'),
    );
  });
});
