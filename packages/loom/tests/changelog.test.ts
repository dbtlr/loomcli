// Acceptance plan: see packages/loom/tests/build.test.ts.

/*
 * Acceptance plan for the package changelog (docs/toolchain/changelog.md).
 *
 * The package changelog is proven by in-process runs against real fixture git repositories:
 *
 * - The bump table. Each row of the table cuts its next version from fixtures holding those kinds,
 *   and a package at a version in another form, such as `v1.2.0`, fails the cut.
 * - Ordering. Fragments added in three commits render in landing order within each group, breaking
 *   entries first, and a fragment edited in a later commit keeps its first position.
 * - `check`. A breaking fragment without its migration labels, a bare `feature.md`, and a fragment
 *   in a subdirectory each fail `check` with exit 1 and their names.
 * - `write`. A cut prepends the section, sets `version` with the rest of `package.json`
 *   byte-identical, deletes the consumed fragments, and leaves `.changes/README.md`. A shallow
 *   clone fails and changes no file. `--dry-run` prints the section and the version and leaves
 *   every file byte-identical.
 * - `--target`. A target at or above the fragment minimum cuts, one below it or not above the
 *   current version fails naming the minimum, and a malformed one fails, each changing no file.
 * - A prerelease cut. `1.4.0` with a `## v1.4.0` section cuts `1.5.0-rc.1` and `1.5.0-rc.2` with
 *   the changelog and fragments untouched, a lower prerelease fails, and a plain `write` finalizes
 *   `1.5.0`. A breaking fragment landed after the candidate fails the finalizing cut naming the
 *   new minimum. A stable version without its section cannot cut a prerelease, and `0.0.0` can.
 * - `sharedVersion`. Every listed manifest is set in the one replacement; a missing, versionless,
 *   unparsable, or differently versioned file, and a malformed value, fail naming the key and
 *   change no file, `--dry-run` included.
 * - `notes`. A stable version prints its section's body, a prerelease prints the pending
 *   fragments, and a version that is not cut, a prerelease other than the current one, and an
 *   argument that is not a version fail.
 */

import fs, {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import { commit, git, migration, put, removeRoots, repository, temporaryRoot } from './fixture.js';
import { run as runLoom } from './run.js';

// Mock the named exports through the test runner; Bun does not synchronize builtin ESM exports.
vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

async function run(cwd: string, ...args: string[]) {
  return await runLoom(['changelog', ...args], { cwd });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(writeFileSync).mockReset();
  vi.mocked(renameSync).mockReset();
  removeRoots();
});

// A package directory with the fragment guide and the supplied files, outside any repository.
function directory(files: Record<string, string> = {}) {
  const root = temporaryRoot('loom-changelog-');
  put(root, 'package.json', '{"name":"notes","version":"1.0.0"}\n');
  put(root, '.changes/README.md', '# Guide\n');
  for (const [path, body] of Object.entries(files)) {
    put(root, path, body);
  }
  return root;
}

// A repository whose root is a package at the supplied version, with its files committed.
function packageRepository(version: string, files: Record<string, string> = {}) {
  return repository({
    files: {
      '.changes/README.md': '# Guide\n',
      'package.json': `${JSON.stringify({ name: 'notes', version }, null, 2)}\n`,
      ...files,
    },
    prefix: 'loom-changelog-',
  }).root;
}

// Every file under the root except Git's own, so a test can prove a command wrote nothing.
function snapshot(root: string) {
  const files = new Map<string, string>();
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git') {
          visit(absolute);
        }
      } else {
        files.set(relative(root, absolute), readFileSync(absolute).toString('base64'));
      }
    }
  };
  visit(root);
  return files;
}

function breaking(change: string) {
  return migration.replace('Remove the old call.', change);
}

test('check validates the fragments of the nearest package from its src directory', async () => {
  const root = directory({
    '.changes/feature.tags.md': '- Add tags.\n',
    '.changes/output.md': '- Fix output.\n',
    'src/main.ts': 'export {};\n',
  });
  await expect(run(join(root, 'src'), 'check')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Checked 2 fragments.\n',
  });
});

test('check at a monorepo root validates the root fragments alone', async () => {
  const root = directory({
    '.changes/root.md': '- Fix the root.\n',
    'packages/one/.changes/breaking.md': '- Invalid name.\n',
    'packages/one/package.json': '{"name":"one","version":"1.0.0"}\n',
    'packages/two/.changes/feature.md': '- Invalid name.\n',
    'packages/two/package.json': '{"name":"two","version":"1.0.0"}\n',
  });
  await expect(run(root, 'check')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Checked 1 fragment.\n',
  });
});

test("check in a member package reads its own .changes and never the monorepo root's configuration file", async () => {
  const root = directory({
    'elsewhere/feature.md': '- Bare kind.\n',
    'loom.config.json': '{ "paths": { "changes": "elsewhere" } }\n',
    'packages/one/.changes/fix.md': '- Fix output.\n',
    'packages/one/package.json': '{"name":"one","version":"1.0.0"}\n',
  });
  await expect(run(join(root, 'packages/one'), 'check')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Checked 1 fragment.\n',
  });
});

test('check resolves paths.changes against the package directory, from a subdirectory or with --config', async () => {
  const root = directory({
    'notes/changes/fix.md': '- Fix output.\n',
    'other/loom.json': '{ "paths": { "changes": "notes/changes" } }\n',
    'src/main.ts': 'export {};\n',
  });
  const checked = { status: 0, stderr: '', stdout: 'Checked 1 fragment.\n' };
  await expect(run(join(root, 'src'), '--config', '../other/loom.json', 'check')).resolves.toEqual(
    checked,
  );
  put(root, 'loom.config.json', '{ "paths": { "changes": "notes/changes" } }\n');
  await expect(run(join(root, 'src'), 'check')).resolves.toEqual(checked);
});

test('check outside any package fails and says to run it inside a package directory', async () => {
  const root = temporaryRoot('loom-changelog-');
  const result = await run(root, 'check');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Run loom inside a package directory.');
});

test('check accepts an empty fragment set and a missing .changes directory', async () => {
  const root = directory();
  const runResult = await run(root, 'check');
  expect(runResult.stdout).toBe('Checked 0 fragments.\n');
  rmSync(join(root, '.changes'), { recursive: true });
  await expect(run(root, 'check')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Checked 0 fragments.\n',
  });
});

test('check accepts nested Markdown and a breaking migration and ignores only the guide', async () => {
  const root = directory({
    '.changes/breaking.call.md': migration,
    '.changes/new.md':
      '- Add input.\n\n  Example:\n\n  ```ts\n  call();\n  ```\n\n  - Nested detail.\n',
  });
  await expect(run(root, 'check')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Checked 2 fragments.\n',
  });
});

test.each([
  ['breaking.md', '- Change.\n'],
  ['breaking..md', '- Change.\n'],
  ['feature.md', '- Change.\n'],
  ['feature..md', '- Change.\n'],
  ['change.txt', '- Change.\n'],
  ['change.MD', '- Change.\n'],
  ['ordinary.md', '---\ndescription: wrong\n---\n- Add.\n'],
  ['ordinary.md', '# Changes\n\n- Add.\n'],
  ['ordinary.md', '-\n'],
  ['ordinary.md', '1. Add.\n'],
  ['ordinary.md', migration],
  ['feature.call.md', migration],
  ['breaking.call.md', '- Remove the old call.\n'],
  ['breaking.call.md', migration.replace('**Why.**', '**Reason.**')],
  ['breaking.call.md', `${migration.replace('### Migration', '```md\n### Migration')}\n\`\`\`\n`],
  [
    'breaking.call.md',
    migration.replace('**Why.** Remove ambiguity.', '> **Why.** Remove ambiguity.'),
  ],
  ['breaking.call.md', `${migration}\n### Migration\n`],
])('check rejects invalid fragment %s with no file edits', async (name, body) => {
  const root = directory({ [`.changes/${name}`]: body });
  const result = await run(root, 'check');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`.changes/${name}:`);
  expect(readFileSync(join(root, '.changes', name), 'utf8')).toBe(body);
});

test('check names every invalid fragment in one run', async () => {
  const root = directory({
    '.changes/breaking.call.md': '- Remove the old call.\n',
    '.changes/feature.md': '- Add tags.\n',
    '.changes/nested/fix.md': '- Fix output.\n',
    '.changes/valid.md': '- Fix input.\n',
  });
  const result = await run(root, 'check');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('.changes/breaking.call.md:');
  expect(result.stderr).toContain('.changes/feature.md:');
  expect(result.stderr).toContain('.changes/nested:');
  expect(result.stderr).not.toContain('.changes/valid.md');
});

test.each(['directory', 'README.md'])('check refuses a directory named %s', async (name) => {
  const root = directory();
  rmSync(join(root, '.changes/README.md'));
  mkdirSync(join(root, '.changes', name));
  await expect(run(root, 'check')).resolves.toEqual({
    status: 1,
    stderr: `.changes/${name}: expected a fragment file. Keep fragments directly in .changes/.\n`,
    stdout: '',
  });
});

test('check rejects write options through Loom before reading files', async () => {
  const result = await run(directory(), 'check', '--date', '2026-10-07');
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--date');
});

test.each([
  ['0.0.0', ['breaking.call.md'], '0.1.0'],
  ['0.0.0', ['fix.md'], '0.1.0'],
  ['0.4.7', ['breaking.call.md', 'feature.tags.md', 'fix.md'], '0.5.0'],
  ['0.4.7', ['feature.tags.md', 'fix.md'], '0.4.8'],
  ['0.4.7', ['fix.md'], '0.4.8'],
  ['1.4.7', ['breaking.call.md', 'feature.tags.md', 'fix.md'], '2.0.0'],
  ['1.4.7', ['feature.tags.md', 'fix.md'], '1.5.0'],
  ['1.4.7', ['fix.md'], '1.4.8'],
])('write cuts %s with %j to %s', async (current, names, expected) => {
  const root = packageRepository(current);
  for (const name of names) {
    put(root, `.changes/${name}`, name.startsWith('breaking.') ? migration : '- Change.\n');
  }
  commit(root);
  const result = await run(root, 'write', '--dry-run', '--date', '2026-10-07');
  expect(result.status).toBe(0);
  expect(result.stdout.startsWith(`## v${expected} - 2026-10-07\n\n`)).toBe(true);
  expect(result.stdout.endsWith(`Next version: ${expected}\n`)).toBe(true);
});

test.each(['1.2', 'v1.2.0', '01.2.0', '1.2.0+build'])(
  'write refuses version %s, which is not MAJOR.MINOR.PATCH with an optional prerelease part',
  async (version) => {
    const root = packageRepository(version, { '.changes/fix.md': '- Fix output.\n' });
    const result = await run(root, 'write', '--date', '2026-10-07');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(version);
    expect(git(root, ['status', '--porcelain'])).toBe('');
  },
);

test.each(['0.0.0', '1.4.7'])('write refuses an empty fragment set at %s', async (version) => {
  const root = packageRepository(version);
  const result = await run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No fragments');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('write renders each group in landing order, breaking first, and keeps a corrected fragment in place', async () => {
  const root = packageRepository('1.4.7');
  put(root, '.changes/zeta.md', '- Fix zeta.\n');
  put(root, '.changes/feature.beta.md', '- Add beta.\n');
  commit(root, '2026-01-02T12:00:00Z');
  put(root, '.changes/breaking.yank.md', breaking('Remove yank.'));
  put(root, '.changes/alpha.md', '- Fix alpha.\n');
  put(root, '.changes/feature.gamma.md', '- Add gamma.\n');
  commit(root, '2026-01-03T12:00:00Z');
  put(root, '.changes/breaking.axe.md', breaking('Remove axe.'));
  put(root, '.changes/feature.alpha.md', '- Add alpha.\n');
  commit(root, '2026-01-04T12:00:00Z');
  put(root, '.changes/zeta.md', '- Fix zeta, corrected.\n');
  commit(root, '2026-01-05T12:00:00Z');
  const migrationSection = migration.slice(migration.indexOf('### Migration'));
  await expect(run(root, 'write', '--dry-run', '--date', '2026-10-07')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: [
      '## v2.0.0 - 2026-10-07\n\n',
      '### Breaking Changes\n\n',
      `- Remove yank.\n\n${migrationSection}\n`,
      `- Remove axe.\n\n${migrationSection}\n`,
      '### Features\n\n',
      '- Add beta.\n\n',
      '- Add gamma.\n\n',
      '- Add alpha.\n\n',
      '### Fixes\n\n',
      '- Fix zeta, corrected.\n\n',
      '- Fix alpha.\n\n',
      'Next version: 2.0.0\n',
    ].join(''),
  });
});

test('write cuts a member package: section prepended, only the version changed, fragments consumed', async () => {
  const manifest = [
    '{',
    '    "name": "@scope/notes",',
    '    "scripts": { "version": "echo  keep" },',
    '    "version":   "1.4.7",',
    '    "bin": {"notes": "dist/main.js"}',
    '}',
  ].join('\n');
  const changelog =
    '---\ndescription: Releases.\n---\n\n# Changelog\n\nIntroduction.\n\n## v1.4.7 - 2026-01-01\n\n### Fixes\n\n- Old entry.\n';
  const root = repository({
    files: {
      'package.json': '{"name":"workspace","private":true}\n',
      'packages/notes/.changes/README.md': '# Guide\n',
      'packages/notes/.changes/feature.tags.md': '- Add tags.\n',
      'packages/notes/CHANGELOG.md': changelog,
      'packages/notes/package.json': manifest,
    },
    prefix: 'loom-changelog-',
  }).root;
  const notes = join(root, 'packages/notes');
  put(notes, 'scratch.txt', 'untracked work\n');
  const previewed = await run(notes, 'write', '--dry-run', '--date', '2026-10-07');
  const section = '## v1.5.0 - 2026-10-07\n\n### Features\n\n- Add tags.\n\n';
  expect(previewed).toEqual({ status: 0, stderr: '', stdout: `${section}Next version: 1.5.0\n` });
  await expect(run(notes, 'write', '--date', '2026-10-07')).resolves.toEqual(previewed);
  expect(readFileSync(join(notes, 'CHANGELOG.md'), 'utf8')).toBe(
    changelog.replace('## v1.4.7', `${section}## v1.4.7`),
  );
  expect(readFileSync(join(notes, 'package.json'), 'utf8')).toBe(
    manifest.replace('"1.4.7"', '"1.5.0"'),
  );
  expect(readdirSync(join(notes, '.changes'))).toEqual(['README.md']);
  expect(readdirSync(notes).toSorted()).toEqual([
    '.changes',
    'CHANGELOG.md',
    'package.json',
    'scratch.txt',
  ]);
});

test("write cuts from the folder and into the changelog loom.config.json names, at a monorepo's root", async () => {
  const changelog = '# Changelog\n\n## v1.4.7 - 2026-01-01\n\n### Fixes\n\n- Old entry.\n';
  const root = repository({
    files: {
      '.changes/feature.tags.md': '- Add tags.\n',
      'CHANGELOG.md': changelog,
      'package.json': '{"name":"workspace","private":true}\n',
      'packages/notes/.changes/fix.md': '- Not this package.\n',
      'packages/notes/loom.config.json':
        '{ "paths": { "changes": "../../.changes", "changelog": "../../CHANGELOG.md" } }\n',
      'packages/notes/package.json': '{"name":"notes","version":"1.4.7"}\n',
    },
    prefix: 'loom-changelog-',
  }).root;
  const notes = join(root, 'packages/notes');
  const section = '## v1.5.0 - 2026-10-07\n\n### Features\n\n- Add tags.\n\n';
  await expect(run(notes, 'write', '--date', '2026-10-07')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${section}Next version: 1.5.0\n`,
  });
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    changelog.replace('## v1.4.7', `${section}## v1.4.7`),
  );
  expect(readFileSync(join(notes, 'package.json'), 'utf8')).toBe(
    '{"name":"notes","version":"1.5.0"}\n',
  );
  expect(readdirSync(join(root, '.changes'))).toEqual([]);
  expect(readdirSync(join(notes, '.changes'))).toEqual(['fix.md']);
  expect(readdirSync(notes).toSorted()).toEqual(['.changes', 'loom.config.json', 'package.json']);
});

test('write creates CHANGELOG.md with a title when it is missing', async () => {
  const root = packageRepository('0.0.0', { '.changes/fix.md': '- Fix output.\n' });
  const runResult = await run(root, 'write', '--date', '2026-10-07');
  expect(runResult.status).toBe(0);
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    '# Changelog\n\n## v0.1.0 - 2026-10-07\n\n### Fixes\n\n- Fix output.\n',
  );
  expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
    `${JSON.stringify({ name: 'notes', version: '0.1.0' }, null, 2)}\n`,
  );
});

test('write creates the folder of the changelog loom.config.json names when it is missing', async () => {
  const root = packageRepository('0.0.0', {
    '.changes/fix.md': '- Fix output.\n',
    'loom.config.json': '{ "paths": { "changelog": "docs/CHANGELOG.md" } }\n',
  });
  const runResult = await run(root, 'write', '--date', '2026-10-07');
  expect(runResult.status).toBe(0);
  expect(readFileSync(join(root, 'docs/CHANGELOG.md'), 'utf8')).toBe(
    '# Changelog\n\n## v0.1.0 - 2026-10-07\n\n### Fixes\n\n- Fix output.\n',
  );
});

test('write --dry-run leaves every file byte-identical', async () => {
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': '# Changelog\n',
  });
  const before = snapshot(root);
  const runResult = await run(root, 'write', '--dry-run', '--date', '2026-10-07');
  expect(runResult.status).toBe(0);
  expect(snapshot(root)).toEqual(before);
});

test('write in a shallow clone fails and changes no file', async () => {
  const source = packageRepository('1.4.7');
  put(source, '.changes/zeta.md', '- First.\n');
  commit(source, '2026-01-02T12:00:00Z');
  put(source, '.changes/alpha.md', '- Second.\n');
  commit(source, '2026-01-03T12:00:00Z');
  const root = join(temporaryRoot('loom-changelog-'), 'shallow');
  git(source, ['clone', '--depth', '1', '--no-local', source, root]);
  const before = snapshot(root);
  const result = await run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('full git history');
  expect(result.stderr).toContain('git fetch --unshallow');
  expect(snapshot(root)).toEqual(before);
});

test('write refuses a fragment no commit added and changes no file', async () => {
  const root = packageRepository('1.4.7', { '.changes/fix.md': '- Fix output.\n' });
  put(root, '.changes/feature.tags.md', '- Add tags.\n');
  const before = snapshot(root);
  const result = await run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('.changes/feature.tags.md');
  expect(snapshot(root)).toEqual(before);
});

test('write copies a narrative named relative to the working directory above the entries', async () => {
  const root = packageRepository('1.4.7', { '.changes/fix.md': '- Fix output.\n' });
  put(root, 'src/narrative.md', 'This release fixes **output**.\n');
  const runResult = await run(
    join(root, 'src'),
    'write',
    '--dry-run',
    '--date',
    '2026-10-07',
    '--narrative',
    'narrative.md',
  );
  expect(runResult.stdout).toBe(
    '## v1.4.8 - 2026-10-07\n\nThis release fixes **output**.\n\n### Fixes\n\n- Fix output.\n\nNext version: 1.4.8\n',
  );
});

test.each([
  ['an empty narrative', ''],
  ['a level-two heading', '## Highlights\n\nProse.\n'],
  ['a level-one heading', '# Release\n'],
])('write refuses %s', async (_label, narrative) => {
  const root = packageRepository('1.4.7', { '.changes/fix.md': '- Fix output.\n' });
  writeFileSync(join(root, 'narrative.md'), narrative);
  const before = snapshot(root);
  const result = await run(root, 'write', '--date', '2026-10-07', '--narrative', 'narrative.md');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Narrative');
  expect(snapshot(root)).toEqual(before);
});

test('write refuses an invalid calendar date and dates the cut today by default', async () => {
  const root = packageRepository('1.4.7', { '.changes/fix.md': '- Fix output.\n' });
  const invalid = await run(root, 'write', '--date', '2026-02-30');
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toContain('calendar date');
  const before = new Date().toISOString().slice(0, 10);
  const runResult = await run(root, 'write', '--dry-run');
  const heading = runResult.stdout.split('\n')[0];
  const after = new Date().toISOString().slice(0, 10);
  expect([`## v1.4.8 - ${before}`, `## v1.4.8 - ${after}`]).toContain(heading);
});

test('write refuses an invalid fragment and names it without edits', async () => {
  const root = packageRepository('1.4.7', { '.changes/feature.md': '- Add tags.\n' });
  const before = snapshot(root);
  const result = await run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('.changes/feature.md:');
  expect(snapshot(root)).toEqual(before);
});

test.each([['check'], ['write', '--dry-run']])(
  '%s rejects unused passthrough',
  async (...mode: string[]) => {
    const root = packageRepository('1.4.7', { '.changes/fix.md': '- Fix output.\n' });
    const result = await run(root, ...mode, '--', '--date', '2026-10-07');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Arguments after -- are not supported.');
  },
);

test('write outside a git repository says to run it inside one with the fragments committed', async () => {
  const root = directory({ '.changes/fix.md': '- Fix output.\n' });
  const before = snapshot(root);
  const result = await run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('orders fragments by the commits that added them');
  expect(result.stderr).toContain('inside a git repository');
  expect(result.stderr).not.toContain('fatal:');
  expect(snapshot(root)).toEqual(before);
});

test.each([
  ['one committer date', ['2026-01-02T12:00:00Z', '2026-01-02T12:00:00Z', '2026-01-02T12:00:00Z']],
  [
    'dates that run backward',
    ['2026-01-05T12:00:00Z', '2026-01-03T12:00:00Z', '2026-01-04T12:00:00Z'],
  ],
])('write orders fragments by their adding commits under %s', async (_label, dates) => {
  const root = packageRepository('1.4.7');
  for (const [index, name] of ['charlie', 'bravo', 'alpha'].entries()) {
    put(root, `.changes/${name}.md`, `- Fix ${name}.\n`);
    commit(root, dates[index]);
  }
  const runResult = await run(root, 'write', '--dry-run', '--date', '2026-10-07');
  expect(runResult.stdout).toBe(
    '## v1.4.8 - 2026-10-07\n\n### Fixes\n\n- Fix charlie.\n\n- Fix bravo.\n\n- Fix alpha.\n\nNext version: 1.4.8\n',
  );
});

test('write ignores history settings that change what git log prints', async () => {
  const root = packageRepository('1.4.7');
  put(root, '.changes/old.md', '- Fix renamed.\n');
  commit(root, '2026-01-02T12:00:00Z');
  put(root, '.changes/middle.md', '- Fix middle.\n');
  commit(root, '2026-01-03T12:00:00Z');
  git(root, ['mv', '.changes/old.md', '.changes/renamed.md']);
  commit(root, '2026-01-04T12:00:00Z');
  git(root, ['config', 'log.showSignature', 'true']);
  git(root, ['config', 'log.follow', 'true']);
  await expect(run(root, 'write', '--dry-run', '--date', '2026-10-07')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout:
      '## v1.4.8 - 2026-10-07\n\n### Fixes\n\n- Fix middle.\n\n- Fix renamed.\n\nNext version: 1.4.8\n',
  });
});

test('a byte order mark is not fragment or narrative content', async () => {
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '﻿- Fix output.\n',
    'narrative.md': '﻿This release fixes output.\n',
  });
  const runResult = await run(root, 'check');
  expect(runResult.stdout).toBe('Checked 1 fragment.\n');
  const runResult2 = await run(
    root,
    'write',
    '--dry-run',
    '--date',
    '2026-10-07',
    '--narrative',
    'narrative.md',
  );
  expect(runResult2.stdout).toBe(
    '## v1.4.8 - 2026-10-07\n\nThis release fixes output.\n\n### Fixes\n\n- Fix output.\n\nNext version: 1.4.8\n',
  );
});

test('write keeps the byte order marks of CHANGELOG.md and package.json', async () => {
  const changelog =
    '﻿---\ndescription: Releases.\n---\n\n# Changelog\n\n## v1.4.7 - 2026-01-01\n\n### Fixes\n\n- Old entry.\n';
  const manifest = '﻿{\n  "name": "notes",\n  "version": "1.4.7"\n}\n';
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': changelog,
  });
  put(root, 'package.json', manifest);
  commit(root);
  const runResult = await run(root, 'write', '--date', '2026-10-07');
  expect(runResult.status).toBe(0);
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    changelog.replace(
      '## v1.4.7',
      '## v1.4.8 - 2026-10-07\n\n### Fixes\n\n- Fix output.\n\n## v1.4.7',
    ),
  );
  expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(manifest.replace('1.4.7', '1.4.8'));
});

test.each([
  ['no level-one title', 'Releases.\n', 'CHANGELOG.md needs a level-one title'],
  [
    'an Unreleased section',
    '# Changelog\n\n## Unreleased\n\n- Pending.\n',
    'CHANGELOG.md has an Unreleased section',
  ],
  [
    'a bracketed Unreleased section',
    '# Changelog\n\n## [Unreleased]\n\n- Pending.\n',
    'CHANGELOG.md has an Unreleased section',
  ],
  [
    'a section for the next version',
    '# Changelog\n\n## v1.4.8 - 2026-01-01\n\n- Earlier.\n',
    'CHANGELOG.md already has a v1.4.8 section',
  ],
])(
  'write refuses a CHANGELOG.md with %s and says what to do',
  async (_label, changelog, sentence) => {
    const root = packageRepository('1.4.7', {
      '.changes/fix.md': '- Fix output.\n',
      'CHANGELOG.md': changelog,
    });
    const before = snapshot(root);
    const result = await run(root, 'write', '--date', '2026-10-07');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(sentence);
    expect(result.stderr.split('\n').filter(Boolean)).toHaveLength(1);
    expect(result.stderr).toMatch(/, so .+\.\n$/u);
    expect(snapshot(root)).toEqual(before);
  },
);

test.each([
  ['staging', 'write'],
  ['replacement', 'rename'],
])('write that fails during %s changes no file', async (_label, mode) => {
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': '# Changelog\n',
  });
  const before = snapshot(root);
  const { writeFileSync: write, renameSync: rename } = fs;
  let failed = false;
  vi.mocked(writeFileSync).mockImplementation((path, ...args) => {
    if (mode === 'write' && String(path).endsWith('package.json')) {
      throw new Error('induced staging failure');
    }
    return write(path, ...args);
  });
  vi.mocked(renameSync).mockImplementation((from, to) => {
    if (!failed && mode === 'rename' && String(to) === join(root, 'package.json')) {
      failed = true;
      throw new Error('induced replacement failure');
    }
    return rename(from, to);
  });
  const result = await run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('induced');
  expect(snapshot(root)).toEqual(before);
});

test('write into a CHANGELOG.md that holds only its title ends the file with one newline', async () => {
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': '# Changelog\n\nEvery release of notes.\n',
  });
  const runResult = await run(root, 'write', '--date', '2026-10-07');
  expect(runResult.status).toBe(0);
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    '# Changelog\n\nEvery release of notes.\n\n## v1.4.8 - 2026-10-07\n\n### Fixes\n\n- Fix output.\n',
  );
});

// Hidden entries an editor or the operating system leaves behind.
const hiddenEntries = {
  '.changes/.#notes.md': '- Lock file.\n',
  '.changes/.DS_Store': '\u0000\u0001binary',
  '.changes/.hidden/fix.md': '- Fix hidden.\n',
  '.changes/.notes.md': '- Hidden fix.\n',
  '.changes/.notes.md.swp': '\u0000swap',
};

test('check ignores hidden entries in .changes/', async () => {
  const root = directory({ ...hiddenEntries, '.changes/fix.md': '- Fix output.\n' });
  await expect(run(root, 'check')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Checked 1 fragment.\n',
  });
});

test('check still rejects a backup file, which is not hidden', async () => {
  const root = directory({ '.changes/fix.md~': '- Fix output.\n' });
  const runResult = await run(root, 'check');
  expect(runResult.stderr).toContain('.changes/fix.md~:');
});

test('write neither renders nor deletes hidden entries', async () => {
  const root = packageRepository('1.4.7', {
    ...hiddenEntries,
    '.changes/fix.md': '- Fix output.\n',
  });
  const result = await run(root, 'write', '--date', '2026-10-07');
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: '## v1.4.8 - 2026-10-07\n\n### Fixes\n\n- Fix output.\n\nNext version: 1.4.8\n',
  });
  expect(readdirSync(join(root, '.changes')).toSorted()).toEqual(
    ['.#notes.md', '.DS_Store', '.hidden', '.notes.md', '.notes.md.swp', 'README.md'].toSorted(),
  );
});

// A changelog that records the supplied release versions, newest first.
function changelogOf(...versions: string[]) {
  const sections = versions.map(
    (version) => `## v${version} - 2026-01-01\n\n### Fixes\n\n- Old.\n`,
  );
  return `# Changelog\n\n${sections.join('\n')}`;
}

function versionOf(root: string, path = 'package.json') {
  const parsed: unknown = JSON.parse(readFileSync(join(root, path), 'utf8'));
  return typeof parsed === 'object' && parsed !== null && 'version' in parsed
    ? parsed.version
    : undefined;
}

test.each([
  ['1.4.0', 'feature.tags.md', '1.5.0', '1.5.0'],
  ['1.4.0', 'feature.tags.md', '1.7.2', '1.7.2'],
  ['1.4.0', 'fix.md', '1.4.1', '1.4.1'],
  ['1.4.0', 'fix.md', '3.0.0', '3.0.0'],
  ['0.9.4', 'fix.md', '0.11.0', '0.11.0'],
  ['0.9.4', 'fix.md', '0.9.5', '0.9.5'],
  ['0.9.4', 'breaking.call.md', '0.11.0', '0.11.0'],
])(
  'write --target cuts %s with %s to %s, a version at or above the fragment minimum',
  async (current, fragment, target, expected) => {
    const root = packageRepository(current, {
      [`.changes/${fragment}`]: fragment.startsWith('breaking.') ? migration : '- Change.\n',
    });
    const result = await run(root, 'write', '--target', target, '--date', '2026-10-07');
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith(`## v${expected} - 2026-10-07\n\n`)).toBe(true);
    expect(result.stdout.endsWith(`Next version: ${expected}\n`)).toBe(true);
    expect(versionOf(root)).toBe(expected);
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain(`## v${expected} -`);
    expect(readdirSync(join(root, '.changes'))).toEqual(['README.md']);
  },
);

test.each([
  ['1.4.0', 'feature.tags.md', '1.4.9', '1.5.0'],
  ['1.4.0', 'breaking.call.md', '1.9.0', '2.0.0'],
  ['0.9.4', 'breaking.call.md', '0.9.5', '0.10.0'],
  ['0.9.4', 'fix.md', '0.9.4-rc.1', '0.9.5'],
])(
  'write --target refuses %s with %s and target %s below the minimum and names %s',
  async (current, fragment, target, minimum) => {
    const root = packageRepository(current, {
      [`.changes/${fragment}`]: fragment.startsWith('breaking.') ? migration : '- Change.\n',
    });
    const before = snapshot(root);
    const result = await run(root, 'write', '--target', target, '--date', '2026-10-07');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`at least ${minimum}`);
    expect(snapshot(root)).toEqual(before);
  },
);

test.each(['0.11.0', '0.10.0', '0.2.0'])(
  'write --target %s refuses a version that does not rank above 0.11.0',
  async (target) => {
    const root = packageRepository('0.11.0', { '.changes/fix.md': '- Fix output.\n' });
    const before = snapshot(root);
    const result = await run(root, 'write', '--target', target);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('above the current version 0.11.0');
    expect(result.stderr).toContain('0.11.1');
    expect(snapshot(root)).toEqual(before);
  },
);

test.each(['v1.2.0', '01.2.0', '1.2.0+b', '1.2', '1.2.0-', '1.2.0-01', '1.2.0-rc..1', 'latest'])(
  'write --target refuses the malformed version %s, names the minimum, and changes no file',
  async (target) => {
    const root = packageRepository('1.1.0', { '.changes/fix.md': '- Fix output.\n' });
    const before = snapshot(root);
    const result = await run(root, 'write', '--target', target);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(JSON.stringify(target));
    expect(result.stderr).toContain('1.1.1');
    expect(snapshot(root)).toEqual(before);
  },
);

test('write --target --dry-run applies the floor and writes nothing', async () => {
  const root = packageRepository('1.4.0', { '.changes/feature.tags.md': '- Add tags.\n' });
  const before = snapshot(root);
  const refused = await run(root, 'write', '--target', '1.4.5', '--dry-run');
  expect(refused.status).toBe(1);
  const chosen = await run(root, 'write', '--target', '1.9.0', '--dry-run', '--date', '2026-10-07');
  expect(chosen).toEqual({
    status: 0,
    stderr: '',
    stdout: '## v1.9.0 - 2026-10-07\n\n### Features\n\n- Add tags.\n\nNext version: 1.9.0\n',
  });
  expect(snapshot(root)).toEqual(before);
});

test('a prerelease sequence sets the version while the changelog and fragments stay, and a plain write finalizes', async () => {
  const changelog = changelogOf('1.4.0');
  const root = packageRepository('1.4.0', {
    '.changes/fix.md': '- Fix output.\n',
    '.changes/zeta.md': '- Fix zeta.\n',
    'CHANGELOG.md': changelog,
  });
  const before = snapshot(root);
  const first = await run(root, 'write', '--target', '1.5.0-rc.1');
  expect(first).toEqual({
    status: 0,
    stderr: '',
    stdout: 'Next version: 1.5.0-rc.1\n2 fragments stay pending for 1.5.0.\n',
  });
  expect(versionOf(root)).toBe('1.5.0-rc.1');
  const after = snapshot(root);
  const changed = [...after].filter(([path, body]) => before.get(path) !== body);
  expect(changed.map(([path]) => path)).toEqual(['package.json']);
  expect(after.size).toBe(before.size);

  const lower = await run(root, 'write', '--target', '1.5.0-beta.1');
  expect(lower.status).toBe(1);
  expect(lower.stderr).toContain('above the current version 1.5.0-rc.1');
  expect(versionOf(root)).toBe('1.5.0-rc.1');

  const second = await run(root, 'write', '--target', '1.5.0-rc.2');
  expect(second.stdout).toBe('Next version: 1.5.0-rc.2\n2 fragments stay pending for 1.5.0.\n');
  expect(versionOf(root)).toBe('1.5.0-rc.2');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(changelog);
  expect(readdirSync(join(root, '.changes')).toSorted()).toEqual([
    'README.md',
    'fix.md',
    'zeta.md',
  ]);

  const final = await run(root, 'write', '--date', '2026-10-07');
  expect(final.status).toBe(0);
  expect(final.stdout).toBe(
    '## v1.5.0 - 2026-10-07\n\n### Fixes\n\n- Fix output.\n\n- Fix zeta.\n\nNext version: 1.5.0\n',
  );
  expect(versionOf(root)).toBe('1.5.0');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    changelog.replace('## v1.4.0', `${final.stdout.replace('Next version: 1.5.0\n', '')}## v1.4.0`),
  );
  expect(readdirSync(join(root, '.changes'))).toEqual(['README.md']);
});

test('a prerelease cut singular count reads one fragment stays pending', async () => {
  const root = packageRepository('1.4.0', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': changelogOf('1.4.0'),
  });
  await expect(run(root, 'write', '--target', '1.4.1-rc.1', '--dry-run')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'Next version: 1.4.1-rc.1\n1 fragment stays pending for 1.4.1.\n',
  });
});

test('a prerelease cut --dry-run prints the version and the pending count and writes nothing', async () => {
  const root = packageRepository('1.4.0', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': changelogOf('1.4.0'),
  });
  const before = snapshot(root);
  const result = await run(root, 'write', '--target', '1.5.0-rc.1', '--dry-run');
  expect(result.stdout).toBe('Next version: 1.5.0-rc.1\n1 fragment stays pending for 1.5.0.\n');
  expect(snapshot(root)).toEqual(before);
});

test('finalizing fails when a breaking fragment landed after the candidate, and names 2.0.0', async () => {
  const root = packageRepository('1.5.0-rc.1', {
    '.changes/feature.tags.md': '- Add tags.\n',
    'CHANGELOG.md': changelogOf('1.4.0'),
  });
  put(root, '.changes/breaking.call.md', migration);
  commit(root);
  const before = snapshot(root);
  const result = await run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('2.0.0');
  expect(result.stderr).toContain('--target');
  expect(snapshot(root)).toEqual(before);
  const chosen = await run(root, 'write', '--target', '2.0.0', '--date', '2026-10-07');
  expect(chosen.status).toBe(0);
  expect(chosen.stdout.startsWith('## v2.0.0 - 2026-10-07\n\n### Breaking Changes\n\n')).toBe(true);
  expect(versionOf(root)).toBe('2.0.0');
});

test('finalizing reads the last release from the highest release heading and ignores other level-two headings', async () => {
  const changelog = [
    '# Changelog',
    '',
    '## Migration notes',
    '',
    'Prose.',
    '',
    '## v1.3.0 - 2026-01-01',
    '',
    '- Old.',
    '',
    '## v1.4.0 - 2026-02-01',
    '',
    '- Newer.',
    '',
    '## Version 9.0.0',
    '',
  ].join('\n');
  const root = packageRepository('1.4.1-rc.1', {
    '.changes/feature.tags.md': '- Add tags.\n',
    'CHANGELOG.md': changelog,
  });
  const result = await run(root, 'write');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('1.5.0');
  expect(result.stderr).not.toContain('9.0.0');
});

test('a prerelease cut from a stable version without its release section fails and changes no file', async () => {
  const root = packageRepository('1.4.0', { '.changes/fix.md': '- Fix output.\n' });
  const before = snapshot(root);
  const missing = await run(root, 'write', '--target', '1.5.0-rc.1');
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain('v1.4.0');
  expect(snapshot(root)).toEqual(before);
  put(root, 'CHANGELOG.md', changelogOf('1.3.0'));
  commit(root);
  const other = await run(root, 'write', '--target', '1.5.0-rc.1');
  expect(other.status).toBe(1);
  expect(other.stderr).toContain('v1.4.0');
  expect(versionOf(root)).toBe('1.4.0');
});

test('a prerelease cut from 0.0.0 needs no section, creates no changelog, and the plain write cuts 0.1.0 and creates it', async () => {
  const root = packageRepository('0.0.0', { '.changes/fix.md': '- Fix output.\n' });
  const first = await run(root, 'write', '--target', '0.1.0-rc.1');
  expect(first.stdout).toBe('Next version: 0.1.0-rc.1\n1 fragment stays pending for 0.1.0.\n');
  expect(versionOf(root)).toBe('0.1.0-rc.1');
  expect(readdirSync(root)).not.toContain('CHANGELOG.md');
  expect(readdirSync(join(root, '.changes')).toSorted()).toEqual(['README.md', 'fix.md']);
  const final = await run(root, 'write', '--date', '2026-10-07');
  expect(final.status).toBe(0);
  expect(versionOf(root)).toBe('0.1.0');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    '# Changelog\n\n## v0.1.0 - 2026-10-07\n\n### Fixes\n\n- Fix output.\n',
  );
});

test('a prerelease cut needs a pending fragment, validates --date and --narrative, and shapes no section with them', async () => {
  const empty = packageRepository('0.0.0');
  const none = await run(empty, 'write', '--target', '0.1.0-rc.1');
  expect(none.status).toBe(1);
  expect(none.stderr).toContain('No fragments');
  expect(versionOf(empty)).toBe('0.0.0');

  const root = packageRepository('0.0.0', {
    '.changes/fix.md': '- Fix output.\n',
    'heading.md': '## Highlights\n',
    'narrative.md': 'Prose about the candidate.\n',
  });
  const before = snapshot(root);
  const date = await run(root, 'write', '--target', '0.1.0-rc.1', '--date', '2026-02-30');
  expect(date.status).toBe(1);
  expect(date.stderr).toContain('calendar date');
  const heading = await run(root, 'write', '--target', '0.1.0-rc.1', '--narrative', 'heading.md');
  expect(heading.status).toBe(1);
  expect(heading.stderr).toContain('Narrative');
  expect(snapshot(root)).toEqual(before);
  const accepted = await run(
    root,
    'write',
    '--target',
    '0.1.0-rc.1',
    '--narrative',
    'narrative.md',
  );
  expect(accepted.stdout).toBe('Next version: 0.1.0-rc.1\n1 fragment stays pending for 0.1.0.\n');
  expect(readdirSync(root)).not.toContain('CHANGELOG.md');
  expect(readFileSync(join(root, 'narrative.md'), 'utf8')).toBe('Prose about the candidate.\n');
});

function manifestOf(name: string, version: string | undefined) {
  return `${JSON.stringify({ name, ...(version === undefined ? {} : { version }) }, null, 2)}\n`;
}

// A monorepo whose collector package lists the supplied shared version value.
function sharedRepository(sharedVersion: unknown, files: Record<string, string> = {}) {
  const root = repository({
    files: {
      'package.json': '{"name":"workspace","private":true}\n',
      'packages/collector/.changes/fix.md': '- Fix output.\n',
      'packages/collector/loom.config.json': `${JSON.stringify({ sharedVersion })}\n`,
      'packages/collector/package.json': manifestOf('collector', '1.4.0'),
      'packages/dashboard/package.json': manifestOf('dashboard', '1.4.0'),
      'packages/hub/package.json': manifestOf('hub', '1.4.0'),
      'packages/stale/package.json': manifestOf('stale', '1.3.0'),
      'packages/versionless/package.json': manifestOf('versionless', undefined),
      ...files,
    },
    prefix: 'loom-changelog-',
  }).root;
  return { collector: join(root, 'packages/collector'), root };
}

test('a cut sets version in every sharedVersion manifest, counts the package and repeats once, and keeps every other byte', async () => {
  const hub =
    '﻿{\n    "scripts": { "version": "echo  keep" },\n  "version":   "1.4.0",\n "name":"hub"}';
  const { collector, root } = sharedRepository(
    [
      '../hub/package.json',
      '../dashboard/package.json',
      'package.json',
      './package.json',
      '../hub/../hub/package.json',
    ],
    { 'packages/hub/package.json': hub },
  );
  const result = await run(collector, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(0);
  expect(versionOf(root, 'packages/collector/package.json')).toBe('1.4.1');
  expect(versionOf(root, 'packages/dashboard/package.json')).toBe('1.4.1');
  expect(readFileSync(join(root, 'packages/hub/package.json'), 'utf8')).toBe(
    hub.replace('"1.4.0"', '"1.4.1"'),
  );
  expect(versionOf(root, 'packages/stale/package.json')).toBe('1.3.0');
  expect(readdirSync(join(collector, '.changes'))).toEqual([]);
});

test('a prerelease cut sets the sharedVersion manifests too', async () => {
  const { collector, root } = sharedRepository(['../hub/package.json'], {
    'packages/collector/CHANGELOG.md': changelogOf('1.4.0'),
  });
  const result = await run(collector, 'write', '--target', '1.5.0-rc.1');
  expect(result.status).toBe(0);
  expect(versionOf(root, 'packages/hub/package.json')).toBe('1.5.0-rc.1');
  expect(versionOf(root, 'packages/dashboard/package.json')).toBe('1.4.0');
});

test.each([
  ['a missing file', '../absent/package.json'],
  ['a file without a version', '../versionless/package.json'],
  ['a file at another version', '../stale/package.json'],
  ['a directory', '../hub'],
])('a cut refuses a sharedVersion entry that is %s and changes no file', async (_label, entry) => {
  const { collector, root } = sharedRepository(['../hub/package.json', entry]);
  const before = snapshot(root);
  for (const flags of [[], ['--dry-run'], ['--target', '1.6.0'], ['--target', '1.6.0-rc.1']]) {
    const result = await run(collector, 'write', ...flags);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('sharedVersion');
    expect(result.stderr).toContain(entry);
    expect(snapshot(root)).toEqual(before);
  }
});

test('a cut refuses a sharedVersion file that is not JSON and changes no file', async () => {
  const { collector, root } = sharedRepository(['../hub/package.json'], {
    'packages/hub/package.json': '{ "version": \n',
  });
  const before = snapshot(root);
  const result = await run(collector, 'write');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('sharedVersion');
  expect(result.stderr).toContain('../hub/package.json');
  expect(snapshot(root)).toEqual(before);
});

test.each([
  ['a string', '../hub/package.json'],
  ['an object', { file: '../hub/package.json' }],
  ['a number', 3],
  ['a list with an empty string', ['../hub/package.json', '']],
  ['a list with a number', ['../hub/package.json', 3]],
])(
  'a cut fails when sharedVersion is %s, naming the key, rather than dropping it',
  async (_label, value) => {
    const { collector, root } = sharedRepository(value);
    const before = snapshot(root);
    for (const flags of [[], ['--dry-run']]) {
      const result = await run(collector, 'write', ...flags);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('sharedVersion');
      expect(snapshot(root)).toEqual(before);
    }
  },
);

test('write --dry-run with sharedVersion prints the cut and writes nothing', async () => {
  const { collector, root } = sharedRepository(['../hub/package.json']);
  const before = snapshot(root);
  const result = await run(collector, 'write', '--dry-run', '--date', '2026-10-07');
  expect(result.stdout).toBe(
    '## v1.4.1 - 2026-10-07\n\n### Fixes\n\n- Fix output.\n\nNext version: 1.4.1\n',
  );
  expect(snapshot(root)).toEqual(before);
});

test('a failure while replacing a sharedVersion manifest restores every file', async () => {
  const { collector, root } = sharedRepository([
    '../hub/package.json',
    '../dashboard/package.json',
  ]);
  const before = snapshot(root);
  const { renameSync: rename } = fs;
  let failed = false;
  vi.mocked(renameSync).mockImplementation((from, to) => {
    if (!failed && String(to) === join(root, 'packages/dashboard/package.json')) {
      failed = true;
      throw new Error('induced replacement failure');
    }
    return rename(from, to);
  });
  const result = await run(collector, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('induced');
  expect(snapshot(root)).toEqual(before);
});

// A package whose changelog records 1.5.0 and 1.4.0, and whose current version is the supplied one.
function releasedRepository(version: string, files: Record<string, string> = {}) {
  const changelog = [
    '---',
    'description: Releases.',
    '---',
    '',
    '# Changelog',
    '',
    '## v1.5.0 - 2026-10-07',
    '',
    'This release adds tags.',
    '',
    '### Features',
    '',
    '- Add tags.',
    '',
    '## Compatibility',
    '',
    'Node 22 and later.',
    '',
    '## v1.4.0 - 2026-09-01',
    '',
    '### Fixes',
    '',
    '- Fix output.',
    '',
  ].join('\n');
  return packageRepository(version, { 'CHANGELOG.md': changelog, ...files });
}

test('notes prints the body of a stable version up to the next release section and changes nothing', async () => {
  const root = releasedRepository('1.5.0');
  const before = snapshot(root);
  await expect(run(root, 'notes', '1.5.0')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout:
      'This release adds tags.\n\n### Features\n\n- Add tags.\n\n## Compatibility\n\nNode 22 and later.\n',
  });
  await expect(run(root, 'notes', '1.4.0')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '### Fixes\n\n- Fix output.\n',
  });
  expect(snapshot(root)).toEqual(before);
});

test.each(['1.6.0', '1.4.1', '2.0.0-rc.1'])(
  'notes fails for the version %s, which has no changelog section',
  async (version) => {
    const root = releasedRepository('1.5.0');
    const result = await run(root, 'notes', version);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(version);
  },
);

test('notes with no changelog file fails for a stable version', async () => {
  const root = packageRepository('1.5.0', { '.changes/fix.md': '- Fix output.\n' });
  const result = await run(root, 'notes', '1.5.0');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('1.5.0');
});

test('notes for the current prerelease prints the pending fragments as write renders them, without heading or narrative', async () => {
  const root = releasedRepository('1.6.0-rc.1', {
    '.changes/feature.tags.md': '- Add tags.\n',
    '.changes/fix.md': '- Fix output.\n',
  });
  put(root, '.changes/breaking.call.md', migration);
  commit(root);
  const before = snapshot(root);
  const migrationSection = migration.slice(migration.indexOf('### Migration'));
  await expect(run(root, 'notes', '1.6.0-rc.1')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: [
      '### Breaking Changes\n\n',
      `- Remove the old call.\n\n${migrationSection}\n`,
      '### Features\n\n- Add tags.\n\n',
      '### Fixes\n\n- Fix output.\n\n',
    ].join(''),
  });
  expect(snapshot(root)).toEqual(before);
});

test('notes fails for a prerelease other than the current version and when no fragment is pending', async () => {
  const root = releasedRepository('1.6.0-rc.1', { '.changes/fix.md': '- Fix output.\n' });
  const other = await run(root, 'notes', '1.6.0-rc.2');
  expect(other.status).toBe(1);
  expect(other.stderr).toContain('1.6.0-rc.1');
  const stable = await run(root, 'notes', '1.6.0');
  expect(stable.status).toBe(1);
  const empty = releasedRepository('1.6.0-rc.1');
  const none = await run(empty, 'notes', '1.6.0-rc.1');
  expect(none.status).toBe(1);
  expect(none.stderr).toContain('fragment');
});

test('notes for a prerelease needs full git history', async () => {
  const source = releasedRepository('1.6.0-rc.1', { '.changes/fix.md': '- Fix output.\n' });
  put(source, '.changes/other.md', '- Fix other.\n');
  commit(source);
  const root = join(temporaryRoot('loom-changelog-'), 'shallow');
  git(source, ['clone', '--depth', '1', '--no-local', source, root]);
  const result = await run(root, 'notes', '1.6.0-rc.1');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('git fetch --unshallow');
});

test.each(['v1.5.0', '01.5.0', '1.5.0+b', '1.5', 'latest'])(
  'notes refuses the argument %s, which is not a version in the target form',
  async (argument) => {
    const root = releasedRepository('1.5.0');
    const result = await run(root, 'notes', argument);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Argument "version"');
  },
);

test('notes requires its version argument', async () => {
  const result = await run(releasedRepository('1.5.0'), 'notes');
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('version');
});

test('notes reads the folder and the changelog loom.config.json names', async () => {
  const root = repository({
    files: {
      '.changes/fix.md': '- Fix output.\n',
      'CHANGELOG.md': changelogOf('1.5.0'),
      'package.json': '{"name":"workspace","private":true}\n',
      'packages/notes/loom.config.json':
        '{ "paths": { "changes": "../../.changes", "changelog": "../../CHANGELOG.md" } }\n',
      'packages/notes/package.json': '{"name":"notes","version":"1.6.0-rc.1"}\n',
    },
    prefix: 'loom-changelog-',
  }).root;
  const notes = join(root, 'packages/notes');
  await expect(run(notes, 'notes', '1.6.0-rc.1')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '### Fixes\n\n- Fix output.\n\n',
  });
  await expect(run(notes, 'notes', '1.5.0')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '### Fixes\n\n- Old.\n',
  });
});
