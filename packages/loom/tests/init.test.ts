import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { renderManaged } from '../src/helpers/managed.js';
import { changelogSkill } from '../src/templates/changelog-skill.js';
import { fragmentGuide } from '../src/templates/fragment-guide.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import { execute, fixturePackage, linkInstalled, loom, runtimes, snapshot } from './package.js';

afterEach(() => {
  removeRoots();
});

/** How long a test that checks or builds the scaffold may take. */
const slow = 180_000;

/** The version of the loom under test, which a scaffold pins its Loom dependencies to. */
const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));

const guidePath = '.changes/README.md';
const skillPath = '.agents/skills/loom-changelog/SKILL.md';

/** An empty directory named `notes`, where init scaffolds a new application. */
function emptyNotes() {
  const directory = join(temporaryRoot('loom-init-'), 'notes');
  mkdirSync(directory);
  return directory;
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

test('in an empty directory init writes package.json, both scaffold files, and both managed files, one line each', () => {
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
      'Wrote src/application.ts.',
      'Wrote src/main.ts.',
      `Wrote ${guidePath}.`,
      `Wrote ${skillPath}.`,
      '',
    ].join('\n'),
  });
  expect(read(directory, guidePath)).toBe(renderManaged(fragmentGuide));
  expect(read(directory, skillPath)).toBe(renderManaged(changelogSkill));
});

test("a new package.json is named for the directory and pins Loom at the running loom's version", () => {
  const directory = emptyNotes();
  loom(directory, ['init']);
  expect(JSON.parse(read(directory, 'package.json'))).toEqual({
    bin: { notes: 'dist/main.js' },
    dependencies: { '@loomcli/core': version },
    devDependencies: { '@loomcli/loom': version },
    name: 'notes',
    scripts: { build: 'loom build --target node', check: 'loom check' },
    type: 'module',
    version: '0.0.0',
  });
});

test(
  'a new scaffold, once installed, checks clean, builds, and its bundle keeps the shebang and runs under Node and Bun',
  () => {
    const directory = emptyNotes();
    loom(directory, ['init']);
    linkInstalled(directory, ['core']);
    const check = loom(directory, ['check']);
    expect(check.status).toBe(0);
    expect(check.stdout).toBe('');
    expect(check.stderr).not.toContain('warning:');
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

test('in an existing package init writes the missing pieces and leaves its application module and build script byte-identical', () => {
  const root = ownPackage();
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
  const manifest = read(root, 'package.json');
  expect(JSON.parse(manifest).scripts.build).toBe('tsc');
  expect(manifest).toContain(
    '\n    "scripts": {\n        "build": "tsc",\n        "check": "loom check"',
  );
  expect(read(root, 'src/main.ts')).toContain("import { probe } from './application.js';");
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
  expect(result.stderr).toContain('Use application, entry, package, changes, or skill.');
});
