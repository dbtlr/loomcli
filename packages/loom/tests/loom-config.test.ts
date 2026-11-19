/*
 * Acceptance plan for the configuration file (docs/toolchain/build.md#the-configuration-file), as
 * `loom init` and `loom changelog check` read it. Each case runs in-process on a mock process,
 * under ADR-0103; `build.test.ts` and `changelog.test.ts` prove what `loom build` and `loom
 * changelog write` do with the paths, and this file proves that every command fails on a wrong
 * file.
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
 *   included. A broken file above it fails the scaffold, and `--no-config` scaffolds past it.
 * - The bin reads the file under `strict: true` (ADR-0158): a file that does not parse, and a value
 *   the schema rejects, fail the command with code 2 instead of running on conventions, and a
 *   takeover such as `--help` reads no file. An unknown key stays ignored.
 * - The bin passes no TOML or YAML reader (ADR-0196): `--config` naming a `.toml`, `.yaml`, or
 *   `.yml` file fails with code 2, naming its format, and a file of any other name reads as JSON.
 */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { mockProcess } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

import { loom } from '../src/application.js';
import { authoringSkill } from '../src/content/authoring-skill.js';
import { changelogSkill } from '../src/content/changelog-skill.js';
import { fragmentGuide } from '../src/content/fragment-guide.js';
import { installerScript } from '../src/content/installer-script.js';
import { loomVersion } from '../src/helpers/loom-version.js';
import { renderManaged } from '../src/helpers/managed.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';

afterEach(() => {
  removeRoots();
});

/** One `loom` run in the directory, off a terminal. */
async function runLoom(cwd: string, argv: string[], ceiling = cwd) {
  const mock = mockProcess({ argv, ceiling, cwd });
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
    stdout: [
      'Wrote notes/changes/README.md.',
      'Wrote .agents/skills/loom-changelog/SKILL.md.',
      // The authoring skill names the conventions whatever the configuration holds.
      ...authoringSkill(loomVersion).map(({ path }) => `Wrote .agents/skills/loom/${path}.`),
      '',
    ].join('\n'),
  });
  const changelog = { changelog: 'docs/CHANGELOG.md', changes: 'notes/changes' };
  const guide = read(directory, 'notes/changes/README.md');
  expect(guide).toBe(renderManaged(fragmentGuide(changelog)));
  expect(guide).toContain('`notes/changes/`');
  expect(guide).toContain('`docs/CHANGELOG.md`');
  expect(guide).not.toContain('.changes');
  expect(read(directory, '.agents/skills/loom/SKILL.md')).not.toContain('notes/changes');
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

/**
 * The failure of the command `words` for a `loom.config.json` whose text ends early, at line 2,
 * column 1, with the help plugin's usage hint. `shown` is the file as its label shows it.
 */
function brokenFailure(words: string, shown = 'loom.config.json') {
  return {
    status: 2,
    stderr: `loom: Configuration file ${shown} is not valid JSON at line 2, column 1. Correct its syntax, or remove it.\nRun "loom ${words} --help" to see the usage.\n`,
    stdout: '',
  };
}

test('a broken file above a new application fails the scaffold, and --no-config scaffolds past it', async () => {
  const directory = temporaryRoot('loom-config-');
  put(directory, 'package.json', '{ "name": "workspace" }\n');
  put(directory, 'loom.config.json', '{ "paths": \n');
  const fresh = join(directory, 'jot');
  mkdirSync(fresh);
  await expect(runLoom(fresh, ['init', '--only', 'changes'], directory)).resolves.toEqual(
    brokenFailure('init', join(directory, 'loom.config.json')),
  );
  const ignored = await runLoom(fresh, ['init', '--only', 'changes', '--no-config'], directory);
  expect(ignored.status).toBe(0);
  expect(ignored.stdout).toContain('Wrote .changes/README.md.\n');
});

test('a file that does not parse fails changelog check and write, where they read the conventional folder', async () => {
  const directory = configuredPackage({}, { '.changes/fix.md': '- Fix output.\n' });
  put(directory, 'loom.config.json', '{ "paths": \n');
  await expect(runLoom(directory, ['changelog', 'check'])).resolves.toEqual(
    brokenFailure('changelog check'),
  );
  await expect(runLoom(directory, ['changelog', 'write', '--dry-run'])).resolves.toEqual(
    brokenFailure('changelog write'),
  );
  const help = await runLoom(directory, ['build', '--help']);
  expect(help.status).toBe(0);
  await expect(runLoom(directory, ['changelog', 'check', '--no-config'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Checked 1 fragment.\n',
  });
});

/** The failure of the command `words` for an empty `paths.changes`, with the usage hint. */
function rejectedChanges(words: string) {
  return {
    status: 2,
    stderr: `loom: Configuration value paths.changes in loom.config.json: Invalid length: Expected >=1 but received 0. Correct the value, or remove it.\nRun "loom ${words} --help" to see the usage.\n`,
    stdout: '',
  };
}

test('a path the schema rejects fails every command that reads the file with code 2', async () => {
  const directory = configuredPackage(
    { paths: { changes: '', source: 'lib' } },
    { '.changes/fix.md': '- Fix output.\n' },
  );
  await expect(runLoom(directory, ['changelog', 'check'])).resolves.toEqual(
    rejectedChanges('changelog check'),
  );
  await expect(runLoom(directory, ['init', '--only', 'application'])).resolves.toEqual(
    rejectedChanges('init'),
  );
  await expect(runLoom(directory, ['changelog', 'write', '--dry-run'])).resolves.toEqual(
    rejectedChanges('changelog write'),
  );
  await expect(runLoom(directory, ['changelog', 'notes', '1.0.0'])).resolves.toEqual(
    rejectedChanges('changelog notes'),
  );
  await expect(runLoom(directory, ['build', '--target', 'node'])).resolves.toEqual(
    rejectedChanges('build'),
  );
});

test('a cut over a wrong file changes nothing: the changelog, package.json, and the fragments stay', async () => {
  for (const config of ['{ "paths": \n', `${JSON.stringify({ paths: { changes: '' } })}\n`]) {
    const directory = configuredPackage(
      {},
      { '.changes/fix.md': '- Fix output.\n', 'CHANGELOG.md': '# Changelog\n' },
    );
    put(directory, 'loom.config.json', config);
    const manifest = read(directory, 'package.json');
    const result = await runLoom(directory, ['changelog', 'write']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(read(directory, 'CHANGELOG.md')).toBe('# Changelog\n');
    expect(read(directory, 'package.json')).toBe(manifest);
    expect(read(directory, '.changes/fix.md')).toBe('- Fix output.\n');
  }
});

test('an unknown key stays ignored, because the schema publishes no JSON Schema', async () => {
  const directory = configuredPackage(
    { pathz: { changes: 'notes' } },
    { '.changes/fix.md': '- Fix output.\n' },
  );
  await expect(runLoom(directory, ['changelog', 'check'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Checked 1 fragment.\n',
  });
});

test('--config naming a TOML or YAML file fails, because the bin reads JSON alone, and any other name reads as JSON', async () => {
  const directory = configuredPackage(
    {},
    {
      '.changes/fix.md': '- Fix output.\n',
      'loom.toml': '[paths]\n',
      'loom.yml': 'paths: {}\n',
      'other.conf': '{ "paths": {} }\n',
    },
  );
  const unread: readonly (readonly [string, string])[] = [
    ['loom.toml', 'TOML'],
    ['loom.yml', 'YAML'],
  ];
  for (const [file, format] of unread) {
    await expect(runLoom(directory, ['changelog', 'check', '--config', file])).resolves.toEqual({
      status: 2,
      stderr: `loom: Option "--config": File "${file}" is ${format}, which this application does not read. Supply a JSON file.\nRun "loom changelog check --help" to see the usage.\n`,
      stdout: '',
    });
  }
  await expect(
    runLoom(directory, ['changelog', 'check', '--config', 'other.conf']),
  ).resolves.toEqual({ status: 0, stderr: '', stdout: 'Checked 1 fragment.\n' });
});
