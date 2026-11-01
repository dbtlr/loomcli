/*
 * Acceptance plan for the skills folder loom build carries (docs/toolchain/build.md#the-skills-folder).
 *
 * `loom build` runs in-process on a mock process, with real Bun builds and the real read of the
 * application module under Bun. Only a process proves that an artifact reads what the build
 * carried, so each carried form runs once as its own process with a private home:
 *
 * - Carrying. A distributed `node` bundle, `bun` bundle, and compiled binary of a fixture whose
 *   skills folder holds an executable script and a linked file each install the skill, with the
 *   pinned modes and the linked file's bytes, after the source folder is moved away. A bundle's copy
 *   sits in `dist/loom-skills/`, and a rebuild replaces it whole, so a skill the source dropped
 *   leaves it, while a file the build does not write stays. A development build names the source
 *   folder, so an edit after the build installs as it now stands, and it writes no copy. A relative
 *   `folder` resolves against the application module's directory.
 * - Judging. A module that throws while it loads, a missing folder, a skill with no SKILL.md, two
 *   folders, and a registry of an unknown format each fail the build before it bundles, writing no
 *   output, for a bundle and for a compile target.
 * - The output. `--out` that would put `loom-skills/` inside the skills folder, or make it the
 *   folder, fails before it builds and leaves the folder byte for byte.
 * - Reading nothing. A bundle whose application module is its entry, which the build does not
 *   load, warns that it carried no folder when it holds the skills plugin, and succeeds. A package
 *   whose application installs no skills plugin builds with no warning.
 * - The configuration file. A `paths.skills` key is not read.
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import { childEnvironment } from '../../../scripts/test-process.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import { execute, fixturePackage, loom, snapshot } from './package.js';

afterEach(() => {
  removeRoots();
});

/** How long a test that compiles a binary may take. */
const slow = 180_000;

/** The application module of a fixture whose skills plugin takes the folder expression. */
function application(folder: string): string {
  return `import { Application } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';

export const notes = new Application('notes', {
  description: 'Keep notes.',
  plugins: [skills({ folder: ${folder} })],
});
`;
}

/** The entry, which runs the application. */
const entry = `#!/usr/bin/env node
import { notes } from './application.js';

await notes.run();
`;

/** The folder expression the fixture's application module names by default. */
const urlFolder = "new URL('../skills/', import.meta.url)";

/**
 * A package whose application names its skills folder, `skills/`, which holds `notes` with a
 * reference, an executable script, and a link to a file outside the folder.
 */
function notesPackage(files: Record<string, string> = {}, folder = urlFolder): string {
  const root = fixturePackage(
    {
      'package.json': `${JSON.stringify({ bin: { notes: 'dist/main.js' }, name: '@acme/notes', type: 'module', version: '1.0.0' })}\n`,
      'shared/glossary.md': 'glossary\n',
      'skills/README.md': 'The skills.\n',
      'skills/notes/SKILL.md': '# Notes\n',
      'skills/notes/references/commands.md': 'commands\n',
      'skills/notes/scripts/run.sh': '#!/bin/sh\n',
      'src/application.ts': application(folder),
      'src/main.ts': entry,
      ...files,
    },
    ['core', 'plugins'],
  );
  chmodSync(join(root, 'skills/notes/scripts/run.sh'), 0o755);
  symlinkSync(join(root, 'shared/glossary.md'), join(root, 'skills/notes/references/glossary.md'));
  return root;
}

/** Every entry under a path with its kind, permission bits, and content, without following a link. */
function tree(path: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (current: string, key: string) => {
    const stats = lstatSync(current);
    if (stats.isDirectory()) {
      entries[key] = 'directory';
      for (const name of readdirSync(current)) {
        walk(join(current, name), `${key}/${name}`);
      }
    } else {
      const kind = stats.isSymbolicLink() ? 'link' : 'file';
      entries[key] = `${kind} ${(stats.mode & 0o777).toString(8)} ${readFileSync(current, 'utf8')}`;
    }
  };
  walk(path, '.');
  return entries;
}

/** The installed `notes` skill, every file written with the mode its executable bit names. */
const installedNotes = {
  '.': 'directory',
  './SKILL.md': 'file 644 # Notes\n',
  './references': 'directory',
  './references/commands.md': 'file 644 commands\n',
  './references/glossary.md': 'file 644 glossary\n',
  './scripts': 'directory',
  './scripts/run.sh': 'file 755 #!/bin/sh\n',
};

/** The compile target Bun names for the host this test runs on. */
function hostTarget(): string {
  const report = execute('bun', [
    '-e',
    'process.stdout.write(process.report.getReport().header.glibcVersionRuntime ?? "")',
  ]);
  const musl = process.platform === 'linux' && report.stdout === '' ? '-musl' : '';
  return `bun-${process.platform}-${process.arch}${musl}`;
}

/**
 * Runs `notes skills install --agent claude` from an artifact as its own process, under a runtime
 * or as a binary, with a private home, and answers the run and the folder it installed.
 */
function installFrom(file: string, runtime: string | undefined) {
  const home = temporaryRoot('loom-skills-home-');
  const result = execute(file, ['skills', 'install', '--agent', 'claude'], {
    env: childEnvironment({ HOME: home, XDG_STATE_HOME: join(home, 'state') }),
    ...(runtime === undefined ? {} : { runtime }),
  });
  return { folder: join(home, '.claude/skills/notes'), result };
}

/** What a build that failed before it bundled leaves: no output directory. */
async function failedBuild(root: string, args: string[]) {
  const result = await loom(root, ['build', ...args]);
  expect(result.stdout).toBe('');
  expect(result.status).toBe(1);
  expect(existsSync(join(root, 'dist'))).toBe(false);
  return result.stderr;
}

const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';

test.each([
  { artifact: 'dist/main.js', name: 'a node bundle', runtime, target: 'node' },
  { artifact: 'dist/main.js', name: 'a bun bundle', runtime: 'bun', target: 'bun' },
  { artifact: 'dist/notes', name: 'a compiled binary', runtime: undefined, target: hostTarget() },
])(
  '$name installs the skills it carries after the source folder is gone',
  async ({ artifact, runtime: by, target }) => {
    const root = notesPackage();
    const built = await loom(root, ['build', '--target', target]);
    expect(built.stderr).toBe('');
    expect(built.status).toBe(0);
    renameSync(join(root, 'skills'), join(root, 'skills.away'));
    rmSync(join(root, 'shared'), { force: true, recursive: true });
    const { folder, result } = installFrom(join(root, artifact), by);
    expect(result.stderr).toContain(`Installed notes for claude in ${folder}.`);
    expect(result.status).toBe(0);
    expect(tree(folder)).toEqual(installedNotes);
  },
  slow,
);

test("a distributed bundle's copy sits in dist/loom-skills and a rebuild replaces it whole", async () => {
  const root = notesPackage({ 'skills/review/SKILL.md': '# Review\n' });
  const first = await loom(root, ['build', '--target', 'node']);
  expect(first.status).toBe(0);
  expect(readdirSync(join(root, 'dist/loom-skills')).toSorted()).toEqual(['notes', 'review']);
  expect(tree(join(root, 'dist/loom-skills/notes'))['./references/glossary.md']).toMatch(
    /^file \d+ glossary\n$/u,
  );
  put(root, 'dist/notes.txt', 'Not the build’s.\n');
  rmSync(join(root, 'skills/review'), { recursive: true });
  const second = await loom(root, ['build', '--target', 'node']);
  expect(second.status).toBe(0);
  expect(readdirSync(join(root, 'dist/loom-skills'))).toEqual(['notes']);
  expect(readFileSync(join(root, 'dist/notes.txt'), 'utf8')).toBe('Not the build’s.\n');
});

test('a folder that holds no skill beside a listed one carries an empty copy', async () => {
  const listed = `import { Application } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';

export const notes = new Application('notes', {
  description: 'Keep notes.',
  plugins: [
    skills({
      folder: new URL('../skills/', import.meta.url),
      skills: [{ files: () => [{ content: '# Listed\\n', path: 'SKILL.md' }], name: 'listed' }],
    }),
  ],
});
`;
  const root = notesPackage({ 'src/application.ts': listed });
  put(root, 'dist/loom-skills/stale/SKILL.md', '# Stale\n');
  rmSync(join(root, 'skills/notes'), { recursive: true });
  const built = await loom(root, ['build', '--target', 'node']);
  expect(built.stderr).toBe('');
  expect(built.status).toBe(0);
  expect(readdirSync(join(root, 'dist/loom-skills'))).toEqual([]);
});

test('a development build names the source folder, so an edit after the build installs', async () => {
  const root = notesPackage();
  const built = await loom(root, ['build', '--target', 'node', '--build', 'development']);
  expect(built.status).toBe(0);
  expect(existsSync(join(root, 'dist/loom-skills'))).toBe(false);
  put(root, 'skills/notes/SKILL.md', '# Notes, edited\n');
  const { folder, result } = installFrom(join(root, 'dist/main.js'), runtime);
  expect(result.status).toBe(0);
  expect(readFileSync(join(folder, 'SKILL.md'), 'utf8')).toBe('# Notes, edited\n');
});

test("a relative folder resolves against the application module's directory", async () => {
  const root = notesPackage({}, "'../skills'");
  const built = await loom(root, ['build', '--target', 'node']);
  expect(built.stderr).toBe('');
  expect(built.status).toBe(0);
  expect(readdirSync(join(root, 'dist/loom-skills'))).toEqual(['notes']);
});

test('a paths.skills key in loom.config.json is not read', async () => {
  const root = notesPackage({
    'elsewhere/other/SKILL.md': '# Other\n',
    'loom.config.json': '{ "paths": { "skills": "elsewhere" } }\n',
  });
  const built = await loom(root, ['build', '--target', 'node']);
  expect(built.status).toBe(0);
  expect(readdirSync(join(root, 'dist/loom-skills'))).toEqual(['notes']);
});

test('a module that throws while it loads fails the build with the load failure', async () => {
  const root = notesPackage({
    'src/application.ts': `${application(urlFolder)}\nthrow new Error('The module broke.');\n`,
  });
  const stderr = await failedBuild(root, ['--target', 'node']);
  expect(stderr).toContain('@loomcli/loom/application-load-failed');
  expect(stderr).toContain('src/application.ts threw while it loaded: Error: The module broke.');
});

test.each([
  ['a bundle', ['--target', 'node']],
  ['a compile target', ['--target', hostTarget()]],
])(
  'a skill with no SKILL.md fails %s before it bundles, naming the folder',
  async (_name, args) => {
    const root = notesPackage();
    rmSync(join(root, 'skills/notes/SKILL.md'));
    const stderr = await failedBuild(root, args);
    expect(stderr).toContain('@loomcli/plugins/skills/files');
    expect(stderr).toContain('Skill "notes" lists no SKILL.md.');
    expect(stderr).toContain(
      `loom build judged the skills folder ${join(root, 'skills')} and built nothing.`,
    );
  },
);

test('a missing folder fails the build before it bundles', async () => {
  const root = notesPackage();
  rmSync(join(root, 'skills'), { recursive: true });
  const stderr = await failedBuild(root, ['--target', 'node']);
  expect(stderr).toContain(
    `Plugin "@loomcli/plugins/skills" setting "folder" names ${join(root, 'skills')}, which is not a folder.`,
  );
});

test('two skills() calls that each name a folder fail the build and name both', async () => {
  const root = notesPackage({
    'src/application.ts': `${application(urlFolder)}
export const other = skills({ folder: new URL('../shared/', import.meta.url) });
`,
  });
  const stderr = await failedBuild(root, ['--target', 'node']);
  expect(stderr).toContain(
    `src/application.ts calls skills() with two folders, ${join(root, 'skills')} and ${join(root, 'shared')}, and a build carries one, so name one folder.`,
  );
});

test('a registry of a format this loom does not know fails the build', async () => {
  const root = fixturePackage({
    'node_modules/@loomcli/plugins/package.json': `${JSON.stringify({ exports: { './skills': './skills.js' }, name: '@loomcli/plugins', type: 'module' })}\n`,
    'node_modules/@loomcli/plugins/skills.js': `export function skills() {
  const key = Symbol.for('@loomcli/plugins/skills/registry');
  globalThis[key] = [...(globalThis[key] ?? []), { format: 1 }];
}
`,
    'package.json': `${JSON.stringify({ name: 'notes', type: 'module' })}\n`,
    'src/application.ts': `import { skills } from '@loomcli/plugins/skills';\n\nskills();\n`,
    'src/main.ts': "import './application.js';\n",
  });
  const stderr = await failedBuild(root, ['--target', 'node']);
  expect(stderr).toContain(
    'This @loomcli/loom cannot read the skills() calls the installed @loomcli/plugins recorded, so install @loomcli/plugins and @loomcli/loom at one version, and build again.',
  );
});

test.each([
  { carried: 'skills/loom-skills', folder: 'skills', out: 'skills', relation: 'is inside' },
  { carried: 'dist/loom-skills', folder: 'dist/loom-skills', out: 'dist', relation: 'is' },
  { carried: 'out/loom-skills', folder: 'out/loom-skills/inner', out: 'out', relation: 'holds' },
])(
  '--out $out, whose loom-skills/ $relation the skills folder $folder, fails before it builds',
  async ({ carried, folder, out, relation }) => {
    const root = notesPackage({}, `new URL('../${folder}/', import.meta.url)`);
    if (folder !== 'skills') {
      put(root, `${folder}/.keep`, '');
      rmSync(join(root, folder), { recursive: true });
      renameSync(join(root, 'skills'), join(root, folder));
    }
    const before = snapshot(join(root, folder));
    const result = await loom(root, ['build', '--target', 'node', '--out', out]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `${carried}, where the bundle carries the skills, ${relation} the skills folder ${folder}, and loom build never writes into the source tree, so name another directory with --out.`,
    );
    expect(snapshot(join(root, folder))).toEqual(before);
  },
);

test.each([
  ['has no application module', []],
  ['names its entry as the application module', ['--application', 'src/main.ts']],
])('a bundle that %s warns that it carried no skills folder', async (_name, args) => {
  const root = fixturePackage(
    {
      'package.json': `${JSON.stringify({ bin: { notes: 'dist/main.js' }, name: '@acme/notes', type: 'module' })}\n`,
      'src/main.ts': `${application(urlFolder)}\nawait notes.run();\n`,
    },
    ['core', 'plugins'],
  );
  const result = await loom(root, ['build', '--target', 'node', ...args]);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('Built dist for node.\n');
  expect(result.stderr).toContain(
    'notes carries the skills plugin, but loom build could not load the application module, so it carried no skills folder. Export the Application from the module paths.application names, src/application.ts by convention, if skills() names a folder.',
  );
});

test('a package whose application installs no skills plugin builds with no warning', async () => {
  const root = fixturePackage(
    {
      'package.json': `${JSON.stringify({ name: 'plain', type: 'module' })}\n`,
      'src/application.ts': `import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';

export const plain = new Application('plain', { plugins: [help()] });
`,
      'src/main.ts': "import { plain } from './application.js';\n\nawait plain.run();\n",
    },
    ['core', 'plugins'],
  );
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
