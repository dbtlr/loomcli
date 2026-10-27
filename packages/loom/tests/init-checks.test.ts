/*
 * `loom init` checks `package.json` before it asks a question or writes a file
 * (docs/toolchain/init.md, Where). Each case runs in-process on a mock process, under ADR-0103.
 *
 * - A directory that is neither empty nor inside a package: at a terminal init asks to create a
 *   `package.json` there and scaffolds as it does in an empty directory; declined, or off a
 *   terminal, it fails and names the command that creates one.
 * - A `package.json` that is not valid JSON, or not a JSON object, fails with its path, where the
 *   JSON breaks, and the fix, and nothing is written. `loom build` and `loom changelog` read it
 *   through the same reader and fail with the same sentence.
 * - A package that names no application fails before anything is written when a piece it asks
 *   for needs the name, and a piece that does not need it is still written.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mockProcess } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

import { loom } from '../src/application.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import { snapshot } from './package.js';

afterEach(() => {
  removeRoots();
});

/** A directory with the supplied name that holds one file and has no `package.json` above it. */
function looseDirectory(name = 'notes') {
  const directory = join(temporaryRoot('loom-init-'), name);
  mkdirSync(directory);
  put(directory, 'notes.txt', 'hello\n');
  return directory;
}

/** A package directory whose `package.json` holds the supplied text. */
function packageWith(manifest: string) {
  const directory = temporaryRoot('loom-init-');
  put(directory, 'package.json', manifest);
  return directory;
}

/** One `loom` run in the directory, off a terminal unless keys are supplied. */
async function runLoom(cwd: string, argv: string[], keys?: string[]) {
  const mock =
    keys === undefined
      ? mockProcess({ argv, cwd })
      : mockProcess({ argv, cwd, terminal: { columns: 80, keys, rows: 24 } });
  const status = await loom.run({ process: mock });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** The sentence init fails with when the directory has no `package.json` and none is created. */
function missingManifest(directory: string) {
  return `${directory} is not empty and no package.json is at or above it, so create one with npm init -y, or your package manager's equivalent, and run loom init again.`;
}

const question = 'No package.json is here or above it. Create one in this directory?';

test('off a terminal init creates no package.json and names the command that creates one', async () => {
  const directory = looseDirectory();
  const before = snapshot(directory);
  const result = await runLoom(directory, ['init']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(missingManifest(directory));
  expect(snapshot(directory)).toEqual(before);
});

test('at a terminal under --no-input init asks nothing and fails as it does off a terminal', async () => {
  const directory = looseDirectory();
  const before = snapshot(directory);
  const result = await runLoom(directory, ['init', '--no-input'], []);
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain(question);
  expect(result.stderr).toContain(missingManifest(directory));
  expect(snapshot(directory)).toEqual(before);
});

test('at a terminal init asks to create a package.json, and an accepted answer scaffolds the directory', async () => {
  const directory = looseDirectory();
  const result = await runLoom(directory, ['init'], ['y\r', '\r', '\r']);
  expect(result.status).toBe(0);
  expect(result.stderr).toContain(question);
  expect(result.stdout).toContain('Wrote package.json.\n');
  expect(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))).toMatchObject({
    name: 'notes',
    type: 'module',
    version: '0.0.0',
  });
  expect(readFileSync(join(directory, 'src/application.ts'), 'utf8')).toContain("'notes'");
  expect(readFileSync(join(directory, 'notes.txt'), 'utf8')).toBe('hello\n');
});

test('at a terminal a declined answer writes nothing and fails with the sentence off a terminal', async () => {
  const directory = looseDirectory();
  const before = snapshot(directory);
  const result = await runLoom(directory, ['init'], ['n\r']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(missingManifest(directory));
  expect(snapshot(directory)).toEqual(before);
});

test('at a terminal a directory whose name is no package name fails before init asks', async () => {
  const directory = looseDirectory('My Notes');
  const before = snapshot(directory);
  const result = await runLoom(directory, ['init'], []);
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain(question);
  expect(result.stderr).toContain(
    'The directory name "My Notes" is not a valid package name, so rename the directory or write a package.json with the name to use.',
  );
  expect(snapshot(directory)).toEqual(before);
});

/** A `package.json` with a trailing comma on its second line. */
const trailingComma = '{\n  "name": "notes",\n}\n';

/** The sentence a `package.json` with a trailing comma fails with. */
function invalidManifest(directory: string) {
  return `${join(directory, 'package.json')} is not valid JSON: line 3, column 1 needs a property name in double quotes, so fix it there and run loom again.`;
}

test.each([
  ['init', ['init']],
  ['init with a piece that needs no package.json field', ['init', '--only', 'changes']],
])(
  '%s fails on an invalid package.json with its path, line, and column, and writes nothing',
  async (_case, argv) => {
    const directory = packageWith(trailingComma);
    const before = snapshot(directory);
    const result = await runLoom(directory, argv);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(invalidManifest(directory));
    expect(snapshot(directory)).toEqual(before);
  },
);

test('init in a directory below an invalid package.json names the file above it', async () => {
  const root = packageWith(trailingComma);
  const directory = join(root, 'src');
  put(root, 'src/notes.ts', 'export {};\n');
  const result = await runLoom(directory, ['init']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(invalidManifest(root));
});

test('init fails on a package.json that holds no object, and writes nothing', async () => {
  const directory = packageWith('["notes"]\n');
  const before = snapshot(directory);
  const result = await runLoom(directory, ['init']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    `${join(directory, 'package.json')} is not a JSON object, so write its fields between { and } and run loom again.`,
  );
  expect(snapshot(directory)).toEqual(before);
});

test.each([
  ['build', ['build', '--facts']],
  ['changelog write', ['changelog', 'write', '--dry-run']],
])('loom %s reads package.json through the same reader', async (_case, argv) => {
  const directory = packageWith(trailingComma);
  const result = await runLoom(directory, argv);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(invalidManifest(directory));
});

/** The sentence a package that names no application fails with. */
const nameless =
  'package.json names no application in bin or name, so set its name field and run loom init again.';

test.each([
  ['every piece', ['init']],
  [
    'a piece written before one that needs the name',
    ['init', '--only', 'changes', '--only', 'install'],
  ],
])('a package that names no application fails before %s is written', async (_case, argv) => {
  const directory = packageWith('{ "version": "1.0.0", "repository": "me/notes" }\n');
  const before = snapshot(directory);
  const result = await runLoom(directory, argv);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(nameless);
  expect(snapshot(directory)).toEqual(before);
});

test('a package that names no application still gets a piece that needs no name', async () => {
  const directory = packageWith('{ "version": "1.0.0" }\n');
  const result = await runLoom(directory, ['init', '--only', 'changes']);
  expect(result).toEqual({ status: 0, stderr: '', stdout: 'Wrote .changes/README.md.\n' });
});
