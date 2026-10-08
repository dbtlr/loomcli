import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { commit, git, migration, put, removeRoots, repository, temporaryRoot } from './fixture.js';

const cli = new URL('../dist/main.js', import.meta.url);
function run(cwd: string, ...args: string[]) {
  return invoke(cli, ['changelog', ...args], { cwd });
}
afterEach(() => {
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

test('check validates the fragments of the nearest package from its src directory', () => {
  const root = directory({
    '.changes/feature.tags.md': '- Add tags.\n',
    '.changes/output.md': '- Fix output.\n',
    'src/main.ts': 'export {};\n',
  });
  expect(run(join(root, 'src'), 'check')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'Checked 2 fragments.\n',
  });
});

test('check at a monorepo root validates the root fragments alone', () => {
  const root = directory({
    '.changes/root.md': '- Fix the root.\n',
    'packages/one/.changes/breaking.md': '- Invalid name.\n',
    'packages/one/package.json': '{"name":"one","version":"1.0.0"}\n',
    'packages/two/.changes/feature.md': '- Invalid name.\n',
    'packages/two/package.json': '{"name":"two","version":"1.0.0"}\n',
  });
  expect(run(root, 'check')).toEqual({ status: 0, stderr: '', stdout: 'Checked 1 fragment.\n' });
});

test('check outside any package fails and says to run it inside a package directory', () => {
  const root = temporaryRoot('loom-changelog-');
  const result = run(root, 'check');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Run loom inside a package directory.');
});

test('check accepts an empty fragment set and a missing .changes directory', () => {
  const root = directory();
  expect(run(root, 'check').stdout).toBe('Checked 0 fragments.\n');
  rmSync(join(root, '.changes'), { recursive: true });
  expect(run(root, 'check')).toEqual({ status: 0, stderr: '', stdout: 'Checked 0 fragments.\n' });
});

test('check accepts nested Markdown and a breaking migration and ignores only the guide', () => {
  const root = directory({
    '.changes/breaking.call.md': migration,
    '.changes/new.md':
      '- Add input.\n\n  Example:\n\n  ```ts\n  call();\n  ```\n\n  - Nested detail.\n',
  });
  expect(run(root, 'check')).toEqual({ status: 0, stderr: '', stdout: 'Checked 2 fragments.\n' });
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
])('check rejects invalid fragment %s with no file edits', (name, body) => {
  const root = directory({ [`.changes/${name}`]: body });
  const result = run(root, 'check');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`.changes/${name}:`);
  expect(readFileSync(join(root, '.changes', name), 'utf8')).toBe(body);
});

test('check names every invalid fragment in one run', () => {
  const root = directory({
    '.changes/breaking.call.md': '- Remove the old call.\n',
    '.changes/feature.md': '- Add tags.\n',
    '.changes/nested/fix.md': '- Fix output.\n',
    '.changes/valid.md': '- Fix input.\n',
  });
  const result = run(root, 'check');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('.changes/breaking.call.md:');
  expect(result.stderr).toContain('.changes/feature.md:');
  expect(result.stderr).toContain('.changes/nested:');
  expect(result.stderr).not.toContain('.changes/valid.md');
});

test.each(['directory', 'README.md'])('check refuses a directory named %s', (name) => {
  const root = directory();
  rmSync(join(root, '.changes/README.md'));
  mkdirSync(join(root, '.changes', name));
  expect(run(root, 'check')).toEqual({
    status: 1,
    stderr: `.changes/${name}: expected a fragment file. Keep fragments directly in .changes/.\n`,
    stdout: '',
  });
});

test('check rejects write options through Loom before reading files', () => {
  const result = run(directory(), 'check', '--date', '2026-10-07');
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
])('write cuts %s with %j to %s', (current, names, expected) => {
  const root = packageRepository(current);
  for (const name of names) {
    put(root, `.changes/${name}`, name.startsWith('breaking.') ? migration : '- Change.\n');
  }
  commit(root);
  const result = run(root, 'write', '--dry-run', '--date', '2026-10-07');
  expect(result.status).toBe(0);
  expect(result.stdout.startsWith(`## v${expected} - 2026-10-07\n\n`)).toBe(true);
  expect(result.stdout.endsWith(`Next version: ${expected}\n`)).toBe(true);
});

test.each(['1.2.0-next.1', '1.2', 'v1.2.0', '01.2.0'])(
  'write refuses version %s, which is not MAJOR.MINOR.PATCH',
  (version) => {
    const root = packageRepository(version, { '.changes/fix.md': '- Fix output.\n' });
    const result = run(root, 'write', '--date', '2026-10-07');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(version);
    expect(git(root, ['status', '--porcelain'])).toBe('');
  },
);

test.each(['0.0.0', '1.4.7'])('write refuses an empty fragment set at %s', (version) => {
  const root = packageRepository(version);
  const result = run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No fragments');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('write renders each group in landing order, breaking first, and keeps a corrected fragment in place', () => {
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
  expect(run(root, 'write', '--dry-run', '--date', '2026-10-07')).toEqual({
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

test('write cuts a member package: section prepended, only the version changed, fragments consumed', () => {
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
  const previewed = run(notes, 'write', '--dry-run', '--date', '2026-10-07');
  const section = '## v1.5.0 - 2026-10-07\n\n### Features\n\n- Add tags.\n\n';
  expect(previewed).toEqual({ status: 0, stderr: '', stdout: `${section}Next version: 1.5.0\n` });
  expect(run(notes, 'write', '--date', '2026-10-07')).toEqual(previewed);
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

test('write creates CHANGELOG.md with a title when it is missing', () => {
  const root = packageRepository('0.0.0', { '.changes/fix.md': '- Fix output.\n' });
  expect(run(root, 'write', '--date', '2026-10-07').status).toBe(0);
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    '# Changelog\n\n## v0.1.0 - 2026-10-07\n\n### Fixes\n\n- Fix output.\n',
  );
  expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
    `${JSON.stringify({ name: 'notes', version: '0.1.0' }, null, 2)}\n`,
  );
});

test('write --dry-run leaves every file byte-identical', () => {
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': '# Changelog\n',
  });
  const before = snapshot(root);
  expect(run(root, 'write', '--dry-run', '--date', '2026-10-07').status).toBe(0);
  expect(snapshot(root)).toEqual(before);
});

test('write in a shallow clone fails and changes no file', () => {
  const source = packageRepository('1.4.7');
  put(source, '.changes/zeta.md', '- First.\n');
  commit(source, '2026-01-02T12:00:00Z');
  put(source, '.changes/alpha.md', '- Second.\n');
  commit(source, '2026-01-03T12:00:00Z');
  const root = join(temporaryRoot('loom-changelog-'), 'shallow');
  git(source, ['clone', '--depth', '1', '--no-local', source, root]);
  const before = snapshot(root);
  const result = run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('full git history');
  expect(result.stderr).toContain('git fetch --unshallow');
  expect(snapshot(root)).toEqual(before);
});

test('write refuses a fragment no commit added and changes no file', () => {
  const root = packageRepository('1.4.7', { '.changes/fix.md': '- Fix output.\n' });
  put(root, '.changes/feature.tags.md', '- Add tags.\n');
  const before = snapshot(root);
  const result = run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('.changes/feature.tags.md');
  expect(snapshot(root)).toEqual(before);
});

test('write copies a narrative named relative to the working directory above the entries', () => {
  const root = packageRepository('1.4.7', { '.changes/fix.md': '- Fix output.\n' });
  put(root, 'src/narrative.md', 'This release fixes **output**.\n');
  expect(
    run(
      join(root, 'src'),
      'write',
      '--dry-run',
      '--date',
      '2026-10-07',
      '--narrative',
      'narrative.md',
    ).stdout,
  ).toBe(
    '## v1.4.8 - 2026-10-07\n\nThis release fixes **output**.\n\n### Fixes\n\n- Fix output.\n\nNext version: 1.4.8\n',
  );
});

test.each([
  ['an empty narrative', ''],
  ['a level-two heading', '## Highlights\n\nProse.\n'],
  ['a level-one heading', '# Release\n'],
])('write refuses %s', (_label, narrative) => {
  const root = packageRepository('1.4.7', { '.changes/fix.md': '- Fix output.\n' });
  writeFileSync(join(root, 'narrative.md'), narrative);
  const before = snapshot(root);
  const result = run(root, 'write', '--date', '2026-10-07', '--narrative', 'narrative.md');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Narrative');
  expect(snapshot(root)).toEqual(before);
});

test('write refuses an invalid calendar date and dates the cut today by default', () => {
  const root = packageRepository('1.4.7', { '.changes/fix.md': '- Fix output.\n' });
  const invalid = run(root, 'write', '--date', '2026-02-30');
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toContain('calendar date');
  const before = new Date().toISOString().slice(0, 10);
  const heading = run(root, 'write', '--dry-run').stdout.split('\n')[0];
  const after = new Date().toISOString().slice(0, 10);
  expect([`## v1.4.8 - ${before}`, `## v1.4.8 - ${after}`]).toContain(heading);
});

test('write refuses an invalid fragment and names it without edits', () => {
  const root = packageRepository('1.4.7', { '.changes/feature.md': '- Add tags.\n' });
  const before = snapshot(root);
  const result = run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('.changes/feature.md:');
  expect(snapshot(root)).toEqual(before);
});

test.each([['check'], ['write', '--dry-run']])(
  '%s rejects unused passthrough',
  (...mode: string[]) => {
    const root = packageRepository('1.4.7', { '.changes/fix.md': '- Fix output.\n' });
    const result = run(root, ...mode, '--', '--date', '2026-10-07');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Arguments after -- are not supported.');
  },
);

test('write outside a git repository says to run it inside one with the fragments committed', () => {
  const root = directory({ '.changes/fix.md': '- Fix output.\n' });
  const before = snapshot(root);
  const result = run(root, 'write', '--date', '2026-10-07');
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
])('write orders fragments by their adding commits under %s', (_label, dates) => {
  const root = packageRepository('1.4.7');
  for (const [index, name] of ['charlie', 'bravo', 'alpha'].entries()) {
    put(root, `.changes/${name}.md`, `- Fix ${name}.\n`);
    commit(root, dates[index]);
  }
  expect(run(root, 'write', '--dry-run', '--date', '2026-10-07').stdout).toBe(
    '## v1.4.8 - 2026-10-07\n\n### Fixes\n\n- Fix charlie.\n\n- Fix bravo.\n\n- Fix alpha.\n\nNext version: 1.4.8\n',
  );
});

test('write ignores history settings that change what git log prints', () => {
  const root = packageRepository('1.4.7');
  put(root, '.changes/old.md', '- Fix renamed.\n');
  commit(root, '2026-01-02T12:00:00Z');
  put(root, '.changes/middle.md', '- Fix middle.\n');
  commit(root, '2026-01-03T12:00:00Z');
  git(root, ['mv', '.changes/old.md', '.changes/renamed.md']);
  commit(root, '2026-01-04T12:00:00Z');
  git(root, ['config', 'log.showSignature', 'true']);
  git(root, ['config', 'log.follow', 'true']);
  expect(run(root, 'write', '--dry-run', '--date', '2026-10-07')).toEqual({
    status: 0,
    stderr: '',
    stdout:
      '## v1.4.8 - 2026-10-07\n\n### Fixes\n\n- Fix middle.\n\n- Fix renamed.\n\nNext version: 1.4.8\n',
  });
});

test('a byte order mark is not fragment or narrative content', () => {
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '﻿- Fix output.\n',
    'narrative.md': '﻿This release fixes output.\n',
  });
  expect(run(root, 'check').stdout).toBe('Checked 1 fragment.\n');
  expect(
    run(root, 'write', '--dry-run', '--date', '2026-10-07', '--narrative', 'narrative.md').stdout,
  ).toBe(
    '## v1.4.8 - 2026-10-07\n\nThis release fixes output.\n\n### Fixes\n\n- Fix output.\n\nNext version: 1.4.8\n',
  );
});

test('write keeps the byte order marks of CHANGELOG.md and package.json', () => {
  const changelog =
    '﻿---\ndescription: Releases.\n---\n\n# Changelog\n\n## v1.4.7 - 2026-01-01\n\n### Fixes\n\n- Old entry.\n';
  const manifest = '﻿{\n  "name": "notes",\n  "version": "1.4.7"\n}\n';
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': changelog,
  });
  put(root, 'package.json', manifest);
  commit(root);
  expect(run(root, 'write', '--date', '2026-10-07').status).toBe(0);
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
])('write refuses a CHANGELOG.md with %s and says what to do', (_label, changelog, sentence) => {
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': changelog,
  });
  const before = snapshot(root);
  const result = run(root, 'write', '--date', '2026-10-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(sentence);
  expect(result.stderr.split('\n').filter(Boolean)).toHaveLength(1);
  expect(result.stderr).toMatch(/, so .+\.\n$/u);
  expect(snapshot(root)).toEqual(before);
});

// Node synchronizes patched builtin exports; the normal CLI cases use the selected runtime.
test.each([
  ['staging', 'write'],
  ['replacement', 'rename'],
])('write that fails during %s changes no file', (_label, mode) => {
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': '# Changelog\n',
  });
  const preload = join(temporaryRoot('loom-changelog-preload-'), 'fail.mjs');
  put(
    dirname(preload),
    'fail.mjs',
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const { renameSync, writeFileSync } = fs;
fs.writeFileSync = function (path, ...args) {
  if (process.env.FAIL_MODE === 'write' && String(path).endsWith('package.json')) {
    throw new Error('induced staging failure');
  }
  return writeFileSync(path, ...args);
};
let failed = false;
fs.renameSync = function (from, to) {
  if (!failed && process.env.FAIL_MODE === 'rename' && String(to) === process.env.FAIL_TARGET) {
    failed = true;
    throw new Error('induced replacement failure');
  }
  return renameSync(from, to);
};
syncBuiltinESMExports();
`,
  );
  const before = snapshot(root);
  const result = spawnSync(
    'node',
    [
      '--import',
      pathToFileURL(preload).href,
      fileURLToPath(cli),
      'changelog',
      'write',
      '--date',
      '2026-10-07',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FAIL_MODE: mode, FAIL_TARGET: join(root, 'package.json') },
      timeout: 10_000,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('induced');
  expect(snapshot(root)).toEqual(before);
});

test('write into a CHANGELOG.md that holds only its title ends the file with one newline', () => {
  const root = packageRepository('1.4.7', {
    '.changes/fix.md': '- Fix output.\n',
    'CHANGELOG.md': '# Changelog\n\nEvery release of notes.\n',
  });
  expect(run(root, 'write', '--date', '2026-10-07').status).toBe(0);
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

test('check ignores hidden entries in .changes/', () => {
  const root = directory({ ...hiddenEntries, '.changes/fix.md': '- Fix output.\n' });
  expect(run(root, 'check')).toEqual({ status: 0, stderr: '', stdout: 'Checked 1 fragment.\n' });
});

test('check still rejects a backup file, which is not hidden', () => {
  const root = directory({ '.changes/fix.md~': '- Fix output.\n' });
  expect(run(root, 'check').stderr).toContain('.changes/fix.md~:');
});

test('write neither renders nor deletes hidden entries', () => {
  const root = packageRepository('1.4.7', {
    ...hiddenEntries,
    '.changes/fix.md': '- Fix output.\n',
  });
  const result = run(root, 'write', '--date', '2026-10-07');
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: '## v1.4.8 - 2026-10-07\n\n### Fixes\n\n- Fix output.\n\nNext version: 1.4.8\n',
  });
  expect(readdirSync(join(root, '.changes')).toSorted()).toEqual(
    ['.#notes.md', '.DS_Store', '.hidden', '.notes.md', '.notes.md.swp', 'README.md'].toSorted(),
  );
});
