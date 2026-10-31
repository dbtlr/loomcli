/*
 * Acceptance plan for the configuration file (docs/toolchain/build.md#the-configuration-file), as
 * `loom init` and `loom changelog check` read it. Each case runs in-process on a mock process,
 * under ADR-0103; `build.test.ts` and `changelog.test.ts` prove `loom build` and `loom changelog
 * write`.
 *
 * - `paths.source` moves the application module, the entry, and the test, and the scaffold's
 *   `tsconfig.json` `include`, the linter's file globs, and the `check` script's lint target name
 *   it. `paths.application` and `paths.entry` place their modules, and the entry and the test
 *   import the application module by its relative path.
 * - `paths.out` names the entry's bundle in the scaffold's `bin`.
 * - `paths.changes` and `paths.changelog` move the fragment guide, and its text and the skill's name
 *   the configured folder and changelog. `changelog check` reads the configured folder.
 * - `paths.installer` renders `install.sh` at a monorepo's root and checks its drift there.
 * - A new application uses conventions whatever the configuration holds, a file `--config` names
 *   included, and a broken file above it still draws its warning.
 * - A value the schema rejects is dropped and its convention applies.
 */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { mockProcess } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

import { loom } from '../src/application.js';
import { changelogSkill } from '../src/content/changelog-skill.js';
import { fragmentGuide } from '../src/content/fragment-guide.js';
import { installerScript } from '../src/content/installer-script.js';
import { renderManaged } from '../src/helpers/managed.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';

afterEach(() => {
  removeRoots();
});

/** One `loom` run in the directory, off a terminal. */
async function runLoom(cwd: string, argv: string[]) {
  const mock = mockProcess({ argv, cwd });
  const status = await loom.run({ process: mock });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** A package named `notes` that holds the supplied configuration file and files. */
function configuredPackage(config: unknown, files: Record<string, string> = {}) {
  const directory = temporaryRoot('loom-config-');
  put(directory, 'package.json', `${JSON.stringify({ name: 'notes', version: '1.0.0' })}\n`);
  put(directory, 'loom.config.json', `${JSON.stringify(config)}\n`);
  for (const [path, body] of Object.entries(files)) {
    put(directory, path, body);
  }
  return directory;
}

/** The text of a file under a directory. */
function read(directory: string, path: string) {
  return readFileSync(join(directory, path), 'utf8');
}

test('paths.source moves the scaffold files, and tsconfig.json, the check script, and the lint globs name it', async () => {
  const directory = configuredPackage({ paths: { source: 'lib' } });
  const oxlint = await runLoom(directory, [
    'init',
    '--only',
    'application',
    '--only',
    'entry',
    '--only',
    'test',
    '--only',
    'tsconfig',
    '--only',
    'package',
  ]);
  expect(oxlint.status).toBe(0);
  expect(oxlint.stdout).toContain('Wrote lib/application.ts.\nWrote lib/main.ts.\n');
  expect(oxlint.stdout).toContain('Wrote lib/application.test.ts.\n');
  expect(read(directory, 'lib/main.ts')).toContain("import { notes } from './application.js';");
  expect(read(directory, 'lib/application.test.ts')).toContain(
    "import { notes } from './application.js';",
  );
  expect(JSON.parse(read(directory, 'tsconfig.json')).include).toEqual(['lib']);
  expect(JSON.parse(read(directory, 'package.json')).scripts.check).toBe(
    'tsc --noEmit && oxlint lib && bun test',
  );
  const eslint = await runLoom(directory, ['init', '--only', 'lint', '--linter', 'eslint']);
  expect(eslint.status).toBe(0);
  expect(read(directory, 'eslint.config.js')).toContain("files: ['lib/**/*.ts']");
  expect(read(directory, 'eslint.config.js')).not.toContain('src/');
});

test('paths.application and paths.entry place their modules, which the entry and the test import by relative path', async () => {
  const directory = configuredPackage({
    paths: { application: 'lib/app/notes.ts', entry: 'bin/cli.ts' },
  });
  const result = await runLoom(directory, [
    'init',
    '--only',
    'application',
    '--only',
    'entry',
    '--only',
    'test',
  ]);
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: 'Wrote lib/app/notes.ts.\nWrote bin/cli.ts.\nWrote src/application.test.ts.\n',
  });
  expect(read(directory, 'bin/cli.ts')).toContain("import { notes } from '../lib/app/notes.js';");
  expect(read(directory, 'src/application.test.ts')).toContain(
    "import { notes } from '../lib/app/notes.js';",
  );
});

test("paths.out names the entry's bundle in the scaffold's bin", async () => {
  const directory = configuredPackage({ paths: { entry: 'src/cli.ts', out: 'build' } });
  const result = await runLoom(directory, ['init', '--only', 'package']);
  expect(result.status).toBe(0);
  expect(JSON.parse(read(directory, 'package.json')).bin).toEqual({ notes: 'build/cli.js' });
});

test('paths.changes and paths.changelog move the fragment guide, whose text and the skill name them', async () => {
  const directory = configuredPackage({
    paths: { changelog: 'docs/CHANGELOG.md', changes: 'notes/changes' },
  });
  const result = await runLoom(directory, ['init', '--only', 'changes', '--only', 'skill']);
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: 'Wrote notes/changes/README.md.\nWrote .agents/skills/loom-changelog/SKILL.md.\n',
  });
  const changelog = { changelog: 'docs/CHANGELOG.md', changes: 'notes/changes' };
  const guide = read(directory, 'notes/changes/README.md');
  expect(guide).toBe(renderManaged(fragmentGuide(changelog)));
  expect(guide).toContain('`notes/changes/`');
  expect(guide).toContain('`docs/CHANGELOG.md`');
  expect(guide).not.toContain('.changes');
  const skill = read(directory, '.agents/skills/loom-changelog/SKILL.md');
  expect(skill).toBe(renderManaged(changelogSkill(changelog)));
  expect(skill).toContain('`notes/changes/README.md`');
  expect(skill).not.toContain('.changes');
});

test('changelog check reads the folder paths.changes names and names an invalid fragment there', async () => {
  const directory = configuredPackage(
    { paths: { changes: 'notes/changes' } },
    { '.changes/feature.md': '- Not read.\n', 'notes/changes/fix.md': '- Fix output.\n' },
  );
  await expect(runLoom(directory, ['changelog', 'check'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Checked 1 fragment.\n',
  });
  put(directory, 'notes/changes/feature.md', '- Bare kind.\n');
  const invalid = await runLoom(directory, ['changelog', 'check']);
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toContain(
    'notes/changes/feature.md: expected <slug>.md, feature.<slug>.md, or breaking.<slug>.md.',
  );
});

test("paths.installer renders install.sh at a monorepo's root and checks its drift there", async () => {
  const root = temporaryRoot('loom-config-');
  put(root, 'package.json', '{ "name": "workspace", "private": true }\n');
  const cli = join(root, 'packages/cli');
  put(cli, 'package.json', '{ "name": "notes", "repository": "me/notes" }\n');
  put(cli, 'loom.config.json', '{ "paths": { "installer": "../../install.sh" } }\n');
  await expect(runLoom(cli, ['init', '--only', 'install'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Wrote ../../install.sh.\n',
  });
  const script = renderManaged(installerScript('notes', 'me/notes'));
  expect(read(root, 'install.sh')).toBe(script);
  expect(statSync(join(root, 'install.sh')).mode & 0o777).toBe(0o755);
  put(root, 'install.sh', `${script}# An edit.\n`);
  await expect(runLoom(cli, ['init', '--only', 'install'])).resolves.toEqual({
    status: 0,
    stderr:
      'warning: ../../install.sh differs from what loom init wrote. Run loom init --force to restore it, or delete its header to keep your edits.\n',
    stdout: '',
  });
});

test('a new application below a configured package uses every convention, a file --config names included', async () => {
  const directory = configuredPackage({ paths: { changes: 'notes', source: 'lib' } });
  put(directory, 'other.json', '{ "paths": { "source": "app" } }\n');
  for (const [name, options] of [
    ['jot', []],
    ['memo', ['--config', '../other.json']],
  ] as const) {
    const fresh = join(directory, name);
    mkdirSync(fresh);
    const result = await runLoom(fresh, ['init', ...options]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Wrote src/application.ts.\nWrote src/main.ts.\n');
    expect(result.stdout).toContain('Wrote .changes/README.md.\n');
    expect(JSON.parse(read(fresh, 'tsconfig.json')).include).toEqual(['src']);
  }
});

test('a broken file above a new application still draws its warning', async () => {
  const directory = temporaryRoot('loom-config-');
  put(directory, 'package.json', '{ "name": "workspace" }\n');
  put(directory, 'loom.config.json', '{ "paths": \n');
  const fresh = join(directory, 'jot');
  mkdirSync(fresh);
  const result = await runLoom(fresh, ['init', '--only', 'changes']);
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('is not valid JSON');
  expect(result.stdout).toContain('Wrote .changes/README.md.\n');
});

test('a path the schema rejects is dropped, its convention applies, and -v names it', async () => {
  const directory = configuredPackage(
    { paths: { changes: '', source: 'lib' } },
    { '.changes/fix.md': '- Fix output.\n' },
  );
  const result = await runLoom(directory, ['-v', 'changelog', 'check']);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('Checked 1 fragment.\n');
  expect(result.stderr).toContain('Ignored paths.changes in loom.config.json');
  // The valid key beside the rejected one survives.
  const written = await runLoom(directory, ['init', '--only', 'application']);
  expect(written.stdout).toBe('Wrote lib/application.ts.\n');
});
