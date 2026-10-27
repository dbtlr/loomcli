/*
 * Acceptance plan for loom init (docs/toolchain/init.md).
 *
 * `loom init` is proven when process runs of the packed `loom` bin produce these results under Node
 * and Bun:
 *
 * - A new application. In an empty directory, init writes `package.json`, the scaffold files, the
 *   fragment guide, and the skill, and prints the warning that `install.sh` was not written,
 *   because the new `package.json` names no repository. After the package manager installs, `tsc
 *   --noEmit` and the assembly test pass, `loom build --target node` builds, and the bundle runs
 *   under Node and Bun. The packed run installs the scaffold from the packed tarballs for the
 *   defaults and for `--linter eslint --test-runner vitest`, requires `tsc` to report TypeScript 7,
 *   requires `bun run check` to exit 0, and requires each linter run to name `@loomcli/undescribed`
 *   once an option lacks a description.
 * - An existing package. In a package with its own `src/application.ts`, `scripts.build`,
 *   `tsconfig.json`, and `devDependencies.typescript`, init writes the missing pieces and leaves
 *   all four byte-identical. `--only changes` writes `.changes/README.md` alone, and `--only
 *   tsconfig` writes `tsconfig.json` alone.
 * - Managed files. Re-running init on an unedited managed file re-renders it. An edited one draws
 *   one warning and stays byte-identical, and `--force` re-renders it. A file whose header was
 *   deleted stays byte-identical under `--force` and draws no warning.
 * - The installer script. In a package whose `repository` reads as `me/notes`, init writes
 *   `install.sh` with the shell header, the application's name, and `me/notes`, and the file is
 *   executable. After `repository` changes to `me/jot`, init re-renders an unedited script with
 *   `me/jot`. An edited script draws the drift warning from init. `--only install` writes the
 *   script alone. With no `repository`, and with a `repository` on another host such as
 *   `gitlab:me/notes`, init writes no `install.sh`, prints the warning that names `repository`, and
 *   exits 0.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { drive } from '../../../scripts/test-terminal.js';
import { changelogSkill } from '../src/content/changelog-skill.js';
import { fragmentGuide } from '../src/content/fragment-guide.js';
import { installerScript } from '../src/content/installer-script.js';
import { eslintConfig, oxlintConfig, typescriptConfig } from '../src/content/scaffold.js';
import { renderManaged } from '../src/helpers/managed.js';
import { toolRanges } from '../src/helpers/tooling.js';
import { put, removeRoots, temporaryRoot } from './fixture.js';
import {
  cli,
  execute,
  fixturePackage,
  inPackage,
  linkInstalled,
  loom,
  runtimes,
  snapshot,
} from './package.js';

afterEach(() => {
  removeRoots();
});

/** How long a test that checks or builds the scaffold may take. */
const slow = 180_000;

/**
 * The version of the loom under test, which a scaffold pins its Loom dependencies to, and the
 * TypeScript range it declares, which a scaffold pins its compiler to.
 */
const { peerDependencies: ranges, version } = z
  .object({ peerDependencies: z.object({ typescript: z.string() }), version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));
const { typescript } = ranges;

const guidePath = '.changes/README.md';
const testPath = 'src/application.test.ts';
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

/** The warning init prints when it writes no installer script. */
const noRepository =
  'warning: install.sh was not written because package.json names no GitHub repository. Set repository to a GitHub address such as owner/name, then run loom init again.\n';

const warning = (path: string) =>
  `warning: ${path} differs from what loom init wrote. Run loom init --force to restore it, or delete its header to keep your edits.\n`;

test('in an empty directory init writes package.json, the scaffold files, the test, the lint configuration, the fragment guide, and the skill, one line each, and warns that install.sh was not written', () => {
  const directory = emptyNotes();
  expect(loom(directory, ['init'])).toEqual({
    status: 0,
    stderr: noRepository,
    stdout: [
      'Wrote package.json.',
      'Added bin to package.json.',
      'Added scripts.build to package.json.',
      'Added scripts.check to package.json.',
      'Added dependencies.@loomcli/core to package.json.',
      'Added devDependencies.@loomcli/loom to package.json.',
      'Added devDependencies.typescript to package.json.',
      'Added devDependencies.@loomcli/testing to package.json.',
      'Added devDependencies.@loomcli/eslint-plugin to package.json.',
      'Added devDependencies.oxlint to package.json.',
      'Added devDependencies.@types/bun to package.json.',
      'Wrote src/application.ts.',
      'Wrote src/main.ts.',
      'Wrote tsconfig.json.',
      `Wrote ${testPath}.`,
      'Wrote .oxlintrc.json.',
      `Wrote ${guidePath}.`,
      `Wrote ${skillPath}.`,
      '',
    ].join('\n'),
  });
  expect(read(directory, guidePath)).toBe(renderManaged(fragmentGuide));
  expect(read(directory, skillPath)).toBe(renderManaged(changelogSkill));
  expect(existsSync(join(directory, 'install.sh'))).toBe(false);
});

test("a new package.json is named for the directory, pins Loom at the running loom's version, and pins the ranges loom declares", () => {
  const directory = emptyNotes();
  loom(directory, ['init']);
  expect(JSON.parse(read(directory, 'package.json'))).toEqual({
    bin: { notes: 'dist/main.js' },
    dependencies: { '@loomcli/core': version },
    devDependencies: {
      '@loomcli/eslint-plugin': version,
      '@loomcli/loom': version,
      '@loomcli/testing': version,
      '@types/bun': toolRanges['@types/bun'],
      oxlint: toolRanges.oxlint,
      typescript,
    },
    name: 'notes',
    scripts: { build: 'loom build --target node', check: 'tsc --noEmit && oxlint src && bun test' },
    type: 'module',
    version: '0.0.0',
  });
});

test(
  'a new scaffold, once installed, passes its own assembly test under bun test, builds, and its bundle keeps the shebang and runs under Node and Bun',
  () => {
    const directory = emptyNotes();
    loom(directory, ['init']);
    linkInstalled(directory, ['core', 'testing', 'types', 'typescript']);
    expect(inPackage(directory, 'bun', ['test']).status).toBe(0);
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

test('a second run over an unedited scaffold writes nothing and prints only the missing-repository warning', () => {
  const directory = emptyNotes();
  loom(directory, ['init']);
  const before = snapshot(directory);
  expect(loom(directory, ['init'])).toEqual({ status: 0, stderr: noRepository, stdout: '' });
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
    stderr: noRepository,
    stdout: [
      'Added bin to package.json.',
      'Added scripts.check to package.json.',
      'Added dependencies.@loomcli/core to package.json.',
      'Added devDependencies.@loomcli/loom to package.json.',
      'Added devDependencies.@loomcli/testing to package.json.',
      'Added devDependencies.@loomcli/eslint-plugin to package.json.',
      'Added devDependencies.oxlint to package.json.',
      'Added devDependencies.@types/bun to package.json.',
      'Wrote src/main.ts.',
      `Wrote ${testPath}.`,
      'Wrote .oxlintrc.json.',
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
    '\n    "scripts": {\n        "build": "tsc",\n        "check": "tsc --noEmit && oxlint src && bun test"',
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

test('init from a subdirectory prints the drift warning of a managed file in the package directory', () => {
  const root = ownPackage({ [guidePath]: `${renderManaged(fragmentGuide)}An edit.\n` });
  const init = loom(join(root, 'src'), ['init', '--only', 'changes']);
  expect(init.stderr).toBe(warning(guidePath));
});

test('--force never overwrites a scaffold file or key', () => {
  const root = ownPackage({ 'src/main.ts': 'export {};\n' });
  loom(root, ['init']);
  const before = snapshot(root);
  expect(loom(root, ['init', '--force'])).toEqual({ status: 0, stderr: noRepository, stdout: '' });
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

test('a managed file whose header was deleted stays byte-identical under --force and draws no warning', () => {
  const released = `${fragmentGuide}An edit of my own.\n`;
  const root = ownPackage({ [guidePath]: released });
  expect(loom(root, ['init', '--only', 'changes', '--force'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '',
  });
  expect(read(root, guidePath)).toBe(released);
});

test('--only with a piece init does not know is an option error that names the pieces', () => {
  const result = loom(emptyNotes(), ['init', '--only', 'nonsense']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain(
    'Use application, entry, tsconfig, test, lint, package, changes, skill, or install.',
  );
});

test(
  'managed files a Markdown formatter rewrote stay managed: init writes nothing and warns nothing',
  (context) => {
    const directory = emptyNotes();
    loom(directory, ['init']);
    const formatted = spawnSync('npx', ['-y', 'prettier@3', '--write', guidePath, skillPath], {
      cwd: directory,
      encoding: 'utf8',
      timeout: slow,
    });
    if (formatted.error !== undefined || formatted.status !== 0) {
      // Prettier comes from the registry through npx, so a machine without network skips this test.
      context.skip();
    }
    expect(loom(directory, ['init'])).toEqual({ status: 0, stderr: noRepository, stdout: '' });
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
      'warning: src/main.ts was not written because src/application.ts could not be loaded: @loomcli/core does not resolve from the package, so install it before init reads src/application.ts. Install the package and run loom init again, or write the entry by hand.\n',
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
      'Added devDependencies.@loomcli/testing to package.json.',
      'Added devDependencies.@loomcli/eslint-plugin to package.json.',
      'Added devDependencies.oxlint to package.json.',
      'Added devDependencies.@types/bun to package.json.',
      '',
    ].join('\n'),
  );
  expect(existsSync(join(directory, 'package.json'))).toBe(true);
  expect(read(root, 'package.json')).toBe(outer);
});

/** A package named `notes` whose `repository` is the supplied address, linking core. */
function repositoryPackage(repository?: unknown) {
  return fixturePackage({
    'package.json': `${JSON.stringify({ name: 'notes', repository, type: 'module' }, undefined, 2)}\n`,
    'src/application.ts': ownApplication,
  });
}

/** Whether a file's mode is 755. */
function isExecutable(path: string) {
  return (statSync(path).mode & 0o777) === 0o755;
}

test('--only install writes install.sh alone, executable, with the shell header, the name, and the repository', () => {
  const root = repositoryPackage('me/notes');
  const before = snapshot(root);
  expect(loom(root, ['init', '--only', 'install'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'Wrote install.sh.\n',
  });
  const script = read(root, 'install.sh');
  expect(script).toBe(renderManaged(installerScript('notes', 'me/notes')));
  expect(script).toMatch(/^#!\/bin\/sh\n# Managed by loom init\. sha256:[\da-f]{64}\n/u);
  expect(script).toContain("app='notes'");
  expect(script).toContain("repository='me/notes'");
  expect(isExecutable(join(root, 'install.sh'))).toBe(true);
  const after = snapshot(root);
  after.delete('install.sh');
  expect(after).toEqual(before);
});

test('a full init in a package with a GitHub repository writes install.sh after the skill', () => {
  const root = repositoryPackage('git+https://github.com/me/notes.git');
  const { stdout } = loom(root, ['init']);
  expect(stdout.endsWith(`Wrote ${skillPath}.\nWrote install.sh.\n`)).toBe(true);
});

test('after repository changes, init re-renders an unedited install.sh with the new repository and keeps it executable', () => {
  const root = repositoryPackage('me/notes');
  loom(root, ['init', '--only', 'install']);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'notes', repository: 'me/jot', type: 'module' })}\n`,
  );
  expect(loom(root, ['init', '--only', 'install'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'Wrote install.sh.\n',
  });
  expect(read(root, 'install.sh')).toBe(renderManaged(installerScript('notes', 'me/jot')));
  expect(isExecutable(join(root, 'install.sh'))).toBe(true);
});

test('an edited install.sh draws the drift warning from init, and --force re-renders it executable', () => {
  const root = repositoryPackage('me/notes');
  const edited = `${renderManaged(installerScript('notes', 'me/notes'))}# An edit.\n`;
  put(root, 'install.sh', edited);
  expect(loom(root, ['init', '--only', 'install'])).toEqual({
    status: 0,
    stderr: warning('install.sh'),
    stdout: '',
  });
  expect(read(root, 'install.sh')).toBe(edited);
  expect(loom(root, ['init', '--only', 'install', '--force']).stdout).toBe('Wrote install.sh.\n');
  expect(read(root, 'install.sh')).toBe(renderManaged(installerScript('notes', 'me/notes')));
  expect(isExecutable(join(root, 'install.sh'))).toBe(true);
});

test.each([
  ['no repository', undefined],
  ['a repository on another host', 'gitlab:me/notes'],
  ['a GitLab URL', 'https://gitlab.com/me/notes.git'],
  ['a repository that cannot be read', 'https://example.com/'],
])(
  'with %s, init writes no install.sh, prints the warning that names repository, and exits 0',
  (_case, repository) => {
    const root = repositoryPackage(repository);
    expect(loom(root, ['init', '--only', 'install'])).toEqual({
      status: 0,
      stderr: noRepository,
      stdout: '',
    });
    expect(existsSync(join(root, 'install.sh'))).toBe(false);
  },
);

test('an install.sh whose #! line was edited keeps its header and draws the drift warning from init', () => {
  const root = repositoryPackage('me/notes');
  const edited = renderManaged(installerScript('notes', 'me/notes')).replace(
    /^#!\/bin\/sh\n/u,
    '#!/usr/bin/env sh\n',
  );
  put(root, 'install.sh', edited);
  expect(loom(root, ['init', '--only', 'install'])).toEqual({
    status: 0,
    stderr: warning('install.sh'),
    stdout: '',
  });
  expect(read(root, 'install.sh')).toBe(edited);
});

/** The `check` script, test import, and lint file a linter and test runner pair writes. */
const toolingCases = [
  {
    check: 'tsc --noEmit && oxlint src && bun test',
    flags: ['--linter', 'oxlint', '--test-runner', 'bun'],
    lintFile: '.oxlintrc.json',
    lintText: oxlintConfig,
    testImport: "import { test } from 'bun:test';",
  },
  {
    check: 'tsc --noEmit && oxlint src && vitest run',
    flags: ['--linter', 'oxlint', '--test-runner', 'vitest'],
    lintFile: '.oxlintrc.json',
    lintText: oxlintConfig,
    testImport: "import { test } from 'vitest';",
  },
  {
    check: 'tsc --noEmit && eslint . && bun test',
    flags: ['--linter', 'eslint', '--test-runner', 'bun'],
    lintFile: 'eslint.config.js',
    lintText: eslintConfig,
    testImport: "import { test } from 'bun:test';",
  },
  {
    check: 'tsc --noEmit && eslint . && vitest run',
    flags: ['--linter', 'eslint', '--test-runner', 'vitest'],
    lintFile: 'eslint.config.js',
    lintText: eslintConfig,
    testImport: "import { test } from 'vitest';",
  },
];

test.each(toolingCases)(
  'init $flags writes the lint file, the test, and the check script of that pair',
  ({ check, flags, lintFile, lintText, testImport }) => {
    const directory = emptyNotes();
    expect(loom(directory, ['init', ...flags]).status).toBe(0);
    expect(read(directory, lintFile)).toBe(lintText);
    const text = read(directory, testPath);
    expect(text).toContain(`${testImport}\n`);
    expect(text).toContain("import { notes } from './application.js';");
    expect(text).toContain('assertAssembles(notes);');
    expect(JSON.parse(read(directory, 'package.json')).scripts.check).toBe(check);
  },
);

test('the oxlint file holds the configuration @loomcli/eslint-plugin ships, and the ESLint file loads it with the TypeScript parser', () => {
  expect(JSON.parse(oxlintConfig)).toEqual({
    jsPlugins: ['@loomcli/eslint-plugin'],
    rules: {
      '@loomcli/discarded-declaration': 'error',
      '@loomcli/host-bypass': 'error',
      '@loomcli/name-shape': 'error',
      '@loomcli/undescribed': 'error',
    },
  });
  expect(eslintConfig).toContain("import loom from '@loomcli/eslint-plugin';");
  expect(eslintConfig).toContain('parser: tseslint.parser');
  expect(eslintConfig).toContain('...loom.configs.recommended');
});

test('the test file opens its test with the comment that says to keep it', () => {
  const directory = emptyNotes();
  loom(directory, ['init']);
  expect(read(directory, testPath)).toBe(`/// <reference types="bun" />
import { test } from 'bun:test';
import { assertAssembles } from '@loomcli/testing';

import { notes } from './application.js';

// Keep this test. It is the check that the whole application assembles, so a fault only the
// assembled application reveals fails CI rather than the operator's first run.
test('the application assembles', () => {
  assertAssembles(notes);
});
`);
});

test('a test for an application exported as default imports it by the entry identifier', () => {
  const root = ownPackage({ 'src/application.ts': authored('export default application;') });
  expect(loom(root, ['init', '--only', 'test']).stdout).toBe(`Wrote ${testPath}.\n`);
  expect(read(root, testPath)).toContain("import probe from './application.js';");
  expect(read(root, testPath)).toContain('assertAssembles(probe);');
});

test('an unnamed option value is an option error that names the choices', () => {
  const linter = loom(emptyNotes(), ['init', '--linter', 'biome']);
  expect(linter.status).toBe(2);
  expect(linter.stderr).toContain('Use oxlint or eslint.');
  const runner = loom(emptyNotes(), ['init', '--test-runner', 'jest']);
  expect(runner.status).toBe(2);
  expect(runner.stderr).toContain('Use bun or vitest.');
});

test.each([
  ['eslint.config.js'],
  ['eslint.config.mjs'],
  ['eslint.config.cjs'],
  ['eslint.config.ts'],
  ['eslint.config.mts'],
  ['eslint.config.cts'],
])('a package with %s uses ESLint and writes no lint file', (config) => {
  const root = ownPackage({ [config]: 'export default [];\n' });
  const result = loom(root, ['init']);
  expect(result.stdout).not.toContain('Wrote .oxlintrc.json.');
  expect(result.stdout).not.toContain('Wrote eslint.config.js.');
  expect(read(root, config)).toBe('export default [];\n');
  const manifest = JSON.parse(read(root, 'package.json'));
  expect(manifest.scripts.check).toBe('tsc --noEmit && eslint . && bun test');
  expect(manifest.devDependencies).toMatchObject({
    eslint: toolRanges.eslint,
    'typescript-eslint': toolRanges['typescript-eslint'],
  });
  expect(manifest.devDependencies).not.toHaveProperty('oxlint');
});

test('a package with .oxlintrc.json uses oxlint and keeps the file', () => {
  const root = ownPackage({ '.oxlintrc.json': '{}\n' });
  loom(root, ['init']);
  expect(read(root, '.oxlintrc.json')).toBe('{}\n');
  expect(JSON.parse(read(root, 'package.json')).scripts.check).toBe(
    'tsc --noEmit && oxlint src && bun test',
  );
  expect(existsSync(join(root, 'eslint.config.js'))).toBe(false);
});

test.each(['.oxlintrc.jsonc', 'oxlint.config.ts', 'oxlint.config.mts'])(
  'a package with %s uses oxlint and init writes no second oxlint file, which oxlint refuses to run beside',
  (config) => {
    const root = ownPackage({ [config]: '{}\n' });
    const result = loom(root, ['init']);
    expect(result.stdout).not.toContain('.oxlintrc.json');
    expect(existsSync(join(root, '.oxlintrc.json'))).toBe(false);
    expect(existsSync(join(root, 'eslint.config.js'))).toBe(false);
    expect(loom(root, ['init', '--only', 'lint'])).toEqual({ status: 0, stderr: '', stdout: '' });
    expect(JSON.parse(read(root, 'package.json')).scripts.check).toBe(
      'tsc --noEmit && oxlint src && bun test',
    );
  },
);

test('a package that declares @types/bun uses Bun', () => {
  const manifest = `${JSON.stringify({ devDependencies: { '@types/bun': '^1.0.0' }, name: 'probe', type: 'module' }, undefined, 2)}\n`;
  const root = ownPackage({ 'package.json': manifest });
  loom(root, ['init']);
  const { devDependencies, scripts } = JSON.parse(read(root, 'package.json'));
  expect(scripts.check).toBe('tsc --noEmit && oxlint src && bun test');
  expect(devDependencies).not.toHaveProperty('vitest');
});

test('a --test-runner the operator supplies wins over a vitest dependency the package holds', () => {
  const manifest = `${JSON.stringify({ devDependencies: { vitest: '^5.0.0' }, name: 'probe', type: 'module' }, undefined, 2)}\n`;
  const root = ownPackage({ 'package.json': manifest });
  loom(root, ['init', '--test-runner', 'bun']);
  expect(JSON.parse(read(root, 'package.json')).scripts.check).toBe(
    'tsc --noEmit && oxlint src && bun test',
  );
  expect(read(root, testPath)).toContain("import { test } from 'bun:test';");
});

test.each(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])(
  'a package that declares vitest under %s uses vitest',
  (group) => {
    const manifest = `${JSON.stringify({ [group]: { vitest: '^5.0.0' }, name: 'probe', type: 'module' }, undefined, 2)}\n`;
    const root = ownPackage({ 'package.json': manifest });
    loom(root, ['init']);
    expect(JSON.parse(read(root, 'package.json')).scripts.check).toBe(
      'tsc --noEmit && oxlint src && vitest run',
    );
    expect(read(root, testPath)).toContain("import { test } from 'vitest';");
  },
);

test('a flag the operator supplies wins over the lint configuration the package holds', () => {
  const root = ownPackage({ '.oxlintrc.json': '{}\n' });
  loom(root, ['init', '--linter', 'eslint']);
  expect(read(root, 'eslint.config.js')).toBe(eslintConfig);
  expect(JSON.parse(read(root, 'package.json')).scripts.check).toBe(
    'tsc --noEmit && eslint . && bun test',
  );
});

test('--only test writes the test alone and --only lint writes the lint file alone', () => {
  const root = ownPackage();
  const before = snapshot(root);
  expect(loom(root, ['init', '--only', 'test'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `Wrote ${testPath}.\n`,
  });
  expect(loom(root, ['init', '--only', 'lint'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'Wrote .oxlintrc.json.\n',
  });
  const after = snapshot(root);
  after.delete(testPath);
  after.delete('.oxlintrc.json');
  expect(after).toEqual(before);
});

test('a re-run never overwrites the test or the lint file', () => {
  const root = ownPackage({ [testPath]: 'export {};\n', '.oxlintrc.json': '{}\n' });
  loom(root, ['init']);
  const before = snapshot(root);
  expect(loom(root, ['init', '--force'])).toEqual({ status: 0, stderr: noRepository, stdout: '' });
  expect(snapshot(root)).toEqual(before);
  expect(read(root, testPath)).toBe('export {};\n');
  expect(read(root, '.oxlintrc.json')).toBe('{}\n');
});

test('a test for an application that cannot be loaded draws the warning and no file', () => {
  const root = fixturePackage(
    {
      'package.json': ownManifest,
      'src/application.ts': authored('export const cli = application;'),
    },
    [],
  );
  expect(loom(root, ['init', '--only', 'test'])).toEqual({
    status: 0,
    stderr: `warning: ${testPath} was not written because src/application.ts could not be loaded: @loomcli/core does not resolve from the package, so install it before init reads src/application.ts. Install the package and run loom init again, or write the test by hand.\n`,
    stdout: '',
  });
  expect(existsSync(join(root, testPath))).toBe(false);
});

/** `loom init` on a real terminal in the directory, with the extra arguments. */
function atTerminal(directory: string, args: string[] = []) {
  return drive(
    [process.env.LOOM_TEST_RUNTIME ?? 'node', cli, 'init', ...args],
    { NO_COLOR: '1' },
    { cwd: directory },
  );
}

/** The last line init prints in a package with no repository. */
const lastWrite = `Wrote ${skillPath}.`;

/** The key presses that move a select's highlight from its first choice to its second, and pick it. */
const secondChoice = String.raw`\x1b[B\r`;

test('at a terminal init asks for the linter and the test runner, and writes what the answers pick', async () => {
  const directory = emptyNotes();
  const tty = atTerminal(directory);
  try {
    await tty.expect('Which linter should the scaffold use?');
    tty.send(secondChoice);
    await tty.expect('Which test runner should the scaffold use?');
    tty.send(secondChoice);
    await tty.expect(lastWrite);
  } finally {
    await tty.close();
  }
  expect(read(directory, 'eslint.config.js')).toBe(eslintConfig);
  expect(JSON.parse(read(directory, 'package.json')).scripts.check).toBe(
    'tsc --noEmit && eslint . && vitest run',
  );
});

test('at a terminal a package with an ESLint configuration is asked for the test runner alone', async () => {
  const root = ownPackage({ 'eslint.config.js': 'export default [];\n' });
  const tty = atTerminal(root);
  try {
    const asked = await tty.expect('Which test runner should the scaffold use?');
    expect(asked).not.toContain('Which linter');
    tty.send(String.raw`\r`);
    await tty.expect(lastWrite);
  } finally {
    await tty.close();
  }
  expect(JSON.parse(read(root, 'package.json')).scripts.check).toBe(
    'tsc --noEmit && eslint . && bun test',
  );
});

test('at a terminal supplied flags, --no-input, and an init that writes nothing they decide ask no question', async () => {
  for (const { args, last } of [
    { args: ['--linter', 'eslint', '--test-runner', 'vitest'], last: lastWrite },
    { args: ['--no-input'], last: lastWrite },
    { args: ['--only', 'changes'], last: `Wrote ${guidePath}.` },
  ]) {
    const root = ownPackage();
    const tty = atTerminal(root, args);
    try {
      await expect(tty.expect(last)).resolves.not.toContain('Which');
    } finally {
      await tty.close();
    }
  }
});

test('at a terminal a re-run of a Bun scaffold asks no question', async () => {
  const directory = emptyNotes();
  expect(loom(directory, ['init']).status).toBe(0);
  const tty = atTerminal(directory);
  try {
    await expect(tty.expect('warning: install.sh was not written')).resolves.not.toContain('Which');
  } finally {
    await tty.close();
  }
  expect(JSON.parse(read(directory, 'package.json')).devDependencies).not.toHaveProperty('vitest');
});

test('at a terminal the runner question is not asked when the test file exists and no other piece depends on the runner', async () => {
  const root = ownPackage({ [testPath]: 'export {};\n' });
  const tty = atTerminal(root, ['--only', 'test', '--only', 'changes']);
  try {
    await expect(tty.expect(`Wrote ${guidePath}.`)).resolves.not.toContain('Which');
  } finally {
    await tty.close();
  }
});

test('at a terminal the runner question is asked when the test file is missing', async () => {
  const root = ownPackage();
  const tty = atTerminal(root, ['--only', 'test']);
  try {
    await tty.expect('Which test runner should the scaffold use?');
    tty.send(secondChoice);
    await tty.expect(`Wrote ${testPath}.`);
  } finally {
    await tty.close();
  }
  expect(read(root, testPath)).toContain("import { test } from 'vitest';");
});

test('an ESLint scaffold aliases typescript to the TypeScript 6 package and adds the compiler as @typescript/native', () => {
  const directory = emptyNotes();
  loom(directory, ['init', '--linter', 'eslint', '--test-runner', 'vitest']);
  expect(JSON.parse(read(directory, 'package.json')).devDependencies).toEqual({
    '@loomcli/eslint-plugin': version,
    '@loomcli/loom': version,
    '@loomcli/testing': version,
    '@typescript/native': `npm:typescript@${typescript}`,
    eslint: toolRanges.eslint,
    typescript: `npm:@typescript/typescript6@${toolRanges['@typescript/typescript6']}`,
    'typescript-eslint': toolRanges['typescript-eslint'],
    vitest: toolRanges.vitest,
  });
});

test('an ESLint scaffold in a package that pins its own typescript keeps that key and adds no second compiler', () => {
  const root = ownPackage({ 'package.json': ownTypedManifest });
  loom(root, ['init', '--linter', 'eslint']);
  const { devDependencies } = JSON.parse(read(root, 'package.json'));
  expect(devDependencies.typescript).toBe('~5.9.0');
  expect(devDependencies).not.toHaveProperty('@typescript/native');
});

/** The warning init prints for ESLint over a plain `typescript` key. */
const plainTypescriptWarning = (range: string) =>
  `warning: package.json declares typescript as ${range}, and typescript-eslint supports TypeScript below 6.1, so eslint . fails on TypeScript 7. Set typescript to npm:@typescript/typescript6@${toolRanges['@typescript/typescript6']} and add @typescript/native as npm:typescript@${range}, which keeps tsc on your compiler. See https://github.com/dbtlr/loomcli/blob/main/docs/libs/eslint-plugin.md.\n`;

test('ESLint over a plain typescript key draws one warning that names the alias and the guide', () => {
  const root = ownPackage({ 'package.json': ownTypedManifest });
  expect(loom(root, ['init', '--linter', 'eslint']).stderr).toBe(
    `${plainTypescriptWarning('~5.9.0')}${noRepository}`,
  );
});

test('ESLint over the typescript alias, and oxlint over a plain typescript key, draw no such warning', () => {
  const aliased = `${JSON.stringify(
    {
      devDependencies: { typescript: 'npm:@typescript/typescript6@^6.0.2' },
      name: 'probe',
      scripts: { build: 'tsc' },
      type: 'module',
    },
    undefined,
    2,
  )}\n`;
  expect(loom(ownPackage({ 'package.json': aliased }), ['init', '--linter', 'eslint']).stderr).toBe(
    noRepository,
  );
  expect(
    loom(ownPackage({ 'package.json': ownTypedManifest }), ['init', '--linter', 'oxlint']).stderr,
  ).toBe(noRepository);
});

test('a new ESLint scaffold draws no typescript warning', () => {
  expect(loom(emptyNotes(), ['init', '--linter', 'eslint']).stderr).toBe(noRepository);
});
