import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { changelogSkill } from '../src/content/changelog-skill.js';
import { fragmentGuide } from '../src/content/fragment-guide.js';
import { typescriptConfig } from '../src/content/scaffold.js';
import { renderManaged } from '../src/helpers/managed.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import { execute, fixturePackage, linkInstalled, loom, runtimes, snapshot } from './package.js';

afterEach(() => {
  removeRoots();
});

/** How long a test that checks or builds the scaffold may take. */
const slow = 180_000;

/**
 * The version of the loom under test, which a scaffold pins its Loom dependencies to, and the
 * TypeScript range it declares, which a scaffold pins its compiler to.
 */
const {
  peerDependencies: { typescript },
  version,
} = z
  .object({ peerDependencies: z.object({ typescript: z.string() }), version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));

const guidePath = '.changes/README.md';
const skillPath = '.agents/skills/loom-changelog/SKILL.md';

/** An empty directory with the supplied name, where init scaffolds a new application. */
function emptyDirectory(name: string) {
  const directory = join(temporaryRoot('loom-init-'), name);
  mkdirSync(directory);
  return directory;
}

/** An empty directory named `notes`. */
function emptyNotes() {
  return emptyDirectory('notes');
}

/** The text of a file under a directory. */
function read(directory: string, path: string) {
  return readFileSync(join(directory, path), 'utf8');
}

/** A package of its own: a manifest with a build script and an application module. */
const ownManifest = `${JSON.stringify({ name: 'probe', scripts: { build: 'tsc' }, type: 'module' }, undefined, 4)}\n`;

const ownApplication = `import { Application } from '@loomcli/core';

export const probe = new Application('probe', { description: 'Probe init.' }).action(() => {});
`;

/** A package of its own that also pins a compiler of its own. */
const ownTypedManifest = `${JSON.stringify(
  {
    devDependencies: { typescript: '~5.9.0' },
    name: 'probe',
    scripts: { build: 'tsc' },
    type: 'module',
  },
  undefined,
  4,
)}\n`;

/** A compiler configuration of the package's own. */
const ownTypescriptConfig = '{ "compilerOptions": { "strict": false } }\n';

/** An existing package that holds its own manifest and application module, linking core. */
function ownPackage(files: Record<string, string> = {}) {
  return fixturePackage({
    'package.json': ownManifest,
    'src/application.ts': ownApplication,
    ...files,
  });
}

const warning = (path: string) =>
  `warning: ${path} differs from what loom init wrote. Run loom init --force to restore it, or delete its header to keep your edits.\n`;

test('in an empty directory init writes package.json, the scaffold files, and both managed files, one line each', () => {
  const directory = emptyNotes();
  expect(loom(directory, ['init'])).toEqual({
    status: 0,
    stderr: '',
    stdout: [
      'Wrote package.json.',
      'Added bin to package.json.',
      'Added scripts.build to package.json.',
      'Added scripts.check to package.json.',
      'Added dependencies.@loomcli/core to package.json.',
      'Added devDependencies.@loomcli/loom to package.json.',
      'Added devDependencies.typescript to package.json.',
      'Wrote src/application.ts.',
      'Wrote src/main.ts.',
      'Wrote tsconfig.json.',
      `Wrote ${guidePath}.`,
      `Wrote ${skillPath}.`,
      '',
    ].join('\n'),
  });
  expect(read(directory, guidePath)).toBe(renderManaged(fragmentGuide));
  expect(read(directory, skillPath)).toBe(renderManaged(changelogSkill));
});

test("a new package.json is named for the directory, pins Loom at the running loom's version, and pins the TypeScript range loom declares", () => {
  const directory = emptyNotes();
  loom(directory, ['init']);
  expect(JSON.parse(read(directory, 'package.json'))).toEqual({
    bin: { notes: 'dist/main.js' },
    dependencies: { '@loomcli/core': version },
    devDependencies: { '@loomcli/loom': version, typescript },
    name: 'notes',
    scripts: { build: 'loom build --target node', check: 'loom check' },
    type: 'module',
    version: '0.0.0',
  });
});

test(
  'a new scaffold, once installed, checks clean with its type pass, builds, and its bundle keeps the shebang and runs under Node and Bun',
  () => {
    const directory = emptyNotes();
    loom(directory, ['init']);
    linkInstalled(directory, ['core', 'typescript']);
    expect(loom(directory, ['check'])).toEqual({ status: 0, stderr: '', stdout: '' });
    expect(loom(directory, ['build', '--target', 'node']).status).toBe(0);
    const bundle = join(directory, 'dist/main.js');
    expect(readFileSync(bundle, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    for (const runtime of runtimes) {
      expect(execute(bundle, [], { runtime })).toEqual({
        status: 0,
        stderr: '',
        stdout: 'notes is ready. Replace this action with your own.\n',
      });
    }
  },
  slow,
);

test('a second run over an unedited scaffold writes nothing and prints nothing', () => {
  const directory = emptyNotes();
  loom(directory, ['init']);
  const before = snapshot(directory);
  expect(loom(directory, ['init'])).toEqual({ status: 0, stderr: '', stdout: '' });
  expect(snapshot(directory)).toEqual(before);
});

test('in an existing package init writes the missing pieces and leaves its application module, build script, tsconfig.json, and compiler byte-identical', () => {
  const root = ownPackage({
    'package.json': ownTypedManifest,
    'tsconfig.json': ownTypescriptConfig,
  });
  const result = loom(root, ['init']);
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: [
      'Added bin to package.json.',
      'Added scripts.check to package.json.',
      'Added dependencies.@loomcli/core to package.json.',
      'Added devDependencies.@loomcli/loom to package.json.',
      'Wrote src/main.ts.',
      `Wrote ${guidePath}.`,
      `Wrote ${skillPath}.`,
      '',
    ].join('\n'),
  });
  expect(read(root, 'src/application.ts')).toBe(ownApplication);
  expect(read(root, 'tsconfig.json')).toBe(ownTypescriptConfig);
  const manifest = read(root, 'package.json');
  expect(JSON.parse(manifest).scripts.build).toBe('tsc');
  expect(manifest).toContain(
    '\n    "scripts": {\n        "build": "tsc",\n        "check": "loom check"',
  );
  expect(manifest).toContain('\n    "devDependencies": {\n        "typescript": "~5.9.0",\n');
  expect(read(root, 'src/main.ts')).toContain("import { probe } from './application.js';");
});

test('--only tsconfig writes tsconfig.json alone', () => {
  const root = ownPackage();
  const before = snapshot(root);
  expect(loom(root, ['init', '--only', 'tsconfig'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'Wrote tsconfig.json.\n',
  });
  const after = snapshot(root);
  expect(after.get('tsconfig.json')).toBe(Buffer.from(typescriptConfig).toString('base64'));
  after.delete('tsconfig.json');
  expect(after).toEqual(before);
});

test('--only changes writes .changes/README.md alone', () => {
  const root = ownPackage();
  const before = snapshot(root);
  expect(loom(root, ['init', '--only', 'changes'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `Wrote ${guidePath}.\n`,
  });
  const after = snapshot(root);
  after.delete(guidePath);
  expect(after).toEqual(before);
});

test('--only repeats, and each piece it names is written', () => {
  const root = ownPackage();
  expect(loom(root, ['init', '--only', 'skill', '--only', 'entry']).stdout).toBe(
    `Wrote src/main.ts.\nWrote ${skillPath}.\n`,
  );
});

test('init in a subdirectory acts on the package directory and names paths relative to it', () => {
  const root = ownPackage();
  expect(loom(join(root, 'src'), ['init', '--only', 'changes']).stdout).toBe(
    `Wrote ${guidePath}.\n`,
  );
  expect(existsSync(join(root, guidePath))).toBe(true);
});

test('init from a subdirectory prints the same drift warning loom check prints there', () => {
  const root = ownPackage({ [guidePath]: `${renderManaged(fragmentGuide)}An edit.\n` });
  const source = join(root, 'src');
  const init = loom(source, ['init', '--only', 'changes']);
  expect(init.stderr).toBe(warning(guidePath));
  const check = loom(source, ['check']);
  expect(check.stderr.split('\n')).toContain(warning(guidePath).trimEnd());
});

test('--force never overwrites a scaffold file or key', () => {
  const root = ownPackage({ 'src/main.ts': 'export {};\n' });
  loom(root, ['init']);
  const before = snapshot(root);
  expect(loom(root, ['init', '--force'])).toEqual({ status: 0, stderr: '', stdout: '' });
  expect(snapshot(root)).toEqual(before);
  expect(read(root, 'src/main.ts')).toBe('export {};\n');
});

test('an unedited managed file from an older loom is re-rendered with the current template', () => {
  const stale = renderManaged('\n# Change fragments\n\nAn older guide.\n');
  const root = ownPackage({ [guidePath]: stale });
  expect(loom(root, ['init', '--only', 'changes'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `Wrote ${guidePath}.\n`,
  });
  expect(read(root, guidePath)).toBe(renderManaged(fragmentGuide));
});

test('an edited managed file draws exactly one warning and stays byte-identical', () => {
  const edited = `${renderManaged(changelogSkill)}An edit.\n`;
  const root = ownPackage({ [skillPath]: edited });
  expect(loom(root, ['init', '--only', 'skill'])).toEqual({
    status: 0,
    stderr: warning(skillPath),
    stdout: '',
  });
  expect(read(root, skillPath)).toBe(edited);
});

test('--force re-renders an edited managed file', () => {
  const root = ownPackage({ [guidePath]: `${renderManaged(fragmentGuide)}An edit.\n` });
  expect(loom(root, ['init', '--only', 'changes', '--force'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `Wrote ${guidePath}.\n`,
  });
  expect(read(root, guidePath)).toBe(renderManaged(fragmentGuide));
});

test('a managed file whose header was deleted stays byte-identical under --force, and loom check raises no warning for it', () => {
  const released = `${fragmentGuide}An edit of my own.\n`;
  const root = ownPackage({ [guidePath]: released });
  expect(loom(root, ['init', '--only', 'changes', '--force'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '',
  });
  expect(read(root, guidePath)).toBe(released);
  const check = loom(root, ['check']);
  expect(check.status).toBe(0);
  expect(check.stderr).not.toContain('warning:');
});

test('a directory that is neither empty nor inside a package fails with exit 1 and says both', () => {
  const directory = temporaryRoot('loom-init-');
  put(directory, 'notes.txt', 'hello\n');
  const result = loom(directory, ['init']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(
    'is not empty and no package.json is at or above it, so run loom init in an empty directory or inside a package directory.',
  );
  expect(snapshot(directory)).toEqual(
    new Map([['notes.txt', Buffer.from('hello\n').toString('base64')]]),
  );
});

test('--only with a piece init does not know is an option error that names the pieces', () => {
  const result = loom(emptyNotes(), ['init', '--only', 'nonsense']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('Use application, entry, tsconfig, package, changes, or skill.');
});

test(
  'managed files a Markdown formatter rewrote stay managed: init prints nothing and check warns nothing',
  (context) => {
    const directory = emptyNotes();
    loom(directory, ['init']);
    linkInstalled(directory, ['core']);
    const formatted = spawnSync('npx', ['-y', 'prettier@3', '--write', guidePath, skillPath], {
      cwd: directory,
      encoding: 'utf8',
      timeout: slow,
    });
    if (formatted.error !== undefined || formatted.status !== 0) {
      // Prettier comes from the registry through npx, so a machine without network skips this test.
      context.skip();
    }
    expect(loom(directory, ['init'])).toEqual({ status: 0, stderr: '', stdout: '' });
    const check = loom(directory, ['check']);
    expect(check.status).toBe(0);
    expect(check.stderr).not.toContain('warning:');
  },
  slow,
);

/** An application module that exports its Application under the supplied export statement. */
function authored(exported: string) {
  return `import { Application } from '@loomcli/core';

const application = new Application('probe', { description: 'Probe the entry.' }).action(
  ({ out }) => out.print('authored'),
);

${exported}
`;
}

test.each([
  [
    'a name of its own',
    'export const cli = application;',
    "import { cli } from './application.js';",
  ],
  ['a default export', 'export default application;', "import probe from './application.js';"],
])(
  'an authored application module exported under %s gets an entry that imports it and builds',
  (_case, exported, imported) => {
    const root = ownPackage({ 'src/application.ts': authored(exported) });
    expect(loom(root, ['init', '--only', 'entry'])).toEqual({
      status: 0,
      stderr: '',
      stdout: 'Wrote src/main.ts.\n',
    });
    expect(read(root, 'src/main.ts')).toContain(imported);
    expect(loom(root, ['build', '--target', 'node']).status).toBe(0);
    expect(execute(join(root, 'dist/main.js'), [], { runtime: 'node' }).stdout).toBe('authored\n');
  },
  slow,
);

test('an authored application module that exports no Application draws a warning and no entry', () => {
  const root = ownPackage({ 'src/application.ts': 'export const value = 1;\n' });
  expect(loom(root, ['init', '--only', 'entry'])).toEqual({
    status: 0,
    stderr:
      'warning: src/main.ts was not written because src/application.ts exports no Application loom can read. Write the entry by hand.\n',
    stdout: '',
  });
  expect(existsSync(join(root, 'src/main.ts'))).toBe(false);
});

test('an authored application module that cannot be loaded draws the load warning naming why and no entry', () => {
  const root = fixturePackage(
    {
      'package.json': ownManifest,
      'src/application.ts': authored('export const cli = application;'),
    },
    [],
  );
  expect(loom(root, ['init', '--only', 'entry'])).toEqual({
    status: 0,
    stderr:
      'warning: src/main.ts was not written because src/application.ts could not be loaded: @loomcli/core does not resolve from the package, so install it before checking src/application.ts. Install the package and run loom init again, or write the entry by hand.\n',
    stdout: '',
  });
  expect(existsSync(join(root, 'src/main.ts'))).toBe(false);
});

test.each(['My Notes', 'notes cli'])(
  'an empty directory named %j is refused before anything is written',
  (name) => {
    const directory = emptyDirectory(name);
    const result = loom(directory, ['init']);
    expect(result).toEqual({
      status: 1,
      stderr: expect.stringContaining(
        `The directory name "${name}" is not a valid package name, so rename the directory or write a package.json with the name to use.`,
      ),
      stdout: '',
    });
    expect(readdirSync(directory)).toEqual([]);
  },
);

test.each(['notes.cli', 'notes2'])('an empty directory named %j scaffolds', (name) => {
  const directory = emptyDirectory(name);
  expect(loom(directory, ['init']).status).toBe(0);
  expect(JSON.parse(read(directory, 'package.json'))).toMatchObject({ name });
});

test('a write that fails names the file after the lines of what was already written', () => {
  const root = ownPackage({ '.agents': 'a file where a directory belongs\n' });
  const result = loom(root, ['init', '--only', 'changes', '--only', 'skill']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe(`Wrote ${guidePath}.\n`);
  expect(result.stderr).toContain(`Cannot write ${skillPath}: `);
});

test('--only skill in an empty directory writes package.json and the skill alone', () => {
  const directory = emptyNotes();
  expect(loom(directory, ['init', '--only', 'skill'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `Wrote package.json.\nWrote ${skillPath}.\n`,
  });
  expect([...snapshot(directory).keys()].toSorted()).toEqual([skillPath, 'package.json']);
});

test('an empty directory inside a package scaffolds there and leaves the outer package.json byte-identical', () => {
  const root = ownPackage();
  const outer = read(root, 'package.json');
  const directory = join(root, 'tools', 'notes');
  mkdirSync(directory, { recursive: true });
  expect(loom(directory, ['init', '--only', 'package']).stdout).toBe(
    [
      'Wrote package.json.',
      'Added bin to package.json.',
      'Added scripts.build to package.json.',
      'Added scripts.check to package.json.',
      'Added dependencies.@loomcli/core to package.json.',
      'Added devDependencies.@loomcli/loom to package.json.',
      'Added devDependencies.typescript to package.json.',
      '',
    ].join('\n'),
  );
  expect(existsSync(join(directory, 'package.json'))).toBe(true);
  expect(read(root, 'package.json')).toBe(outer);
});
