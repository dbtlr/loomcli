import fs, {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import {
  commit,
  git,
  migration,
  put,
  removeRoots,
  repository as fixtureRepository,
  temporaryRoot,
} from './fixture.js';
import { run } from './run.js';

// Mock the named exports through the test runner; Bun does not synchronize builtin ESM exports.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

// The synchronized cut, which writes the release files.
async function cut(root: string, ...args: string[]) {
  return await run(['release', 'cut', ...args], { cwd: root });
}
// The same cut with --dry-run, which prints the section and writes nothing.
async function dryRun(root: string, ...args: string[]) {
  return await cut(root, '--dry-run', ...args);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(writeFileSync).mockReset();
  vi.mocked(renameSync).mockReset();
  removeRoots();
});

function repository(version = '0.0.0', { tag = true } = {}) {
  return fixtureRepository({
    files: {
      '.changes/README.md': '# Guide\n',
      '.gitignore': 'node_modules/\n',
      'CHANGELOG.md': '---\ndescription: Releases.\n---\n\n# Changelog\n\nExisting introduction.\n',
      'examples/demo/package.json': '{"name":"demo","private":true,"version":"7.0.0"}\n',
      'package.json': '{"name":"fixture","private":true,"version":"9.0.0"}\n',
      'packages/core/package.json': `${JSON.stringify({ name: '@sample/core', version }, null, 2)}\n`,
      'packages/private/package.json': '{"name":"private","private":true,"version":"5.0.0"}\n',
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n  - examples/*\n',
    },
    prefix: 'loom-changelog-',
    tag: tag && version !== '0.0.0' ? `v${version}` : undefined,
  }).root;
}

// A release cut sets one synchronized version across every participating manifest.
function setVersion(
  root: string,
  version: string,
  manifests: Record<string, Record<string, unknown>> = {},
) {
  put(
    root,
    'packages/core/package.json',
    `${JSON.stringify({ name: '@sample/core', version }, null, 2)}\n`,
  );
  for (const [directory, manifest] of Object.entries(manifests)) {
    put(
      root,
      `packages/${directory}/package.json`,
      `${JSON.stringify({ ...manifest, version }, null, 2)}\n`,
    );
  }
  commit(root);
}

test('a dry run derives the first version from manifests and preserves fragment prose', async () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add **typed** input.\n\n  - Preserve nested detail.\n');
  commit(root);
  git(root, ['tag', 'v0.99.0']);
  const before = git(root, ['status', '--porcelain']);
  await expect(dryRun(root, '--date', '2026-09-07')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout:
      '## v0.1.0 - 2026-09-07\n\n### Fixes\n\n- Add **typed** input.\n\n  - Preserve nested detail.\n\n',
  });
  expect(git(root, ['status', '--porcelain'])).toBe(before);
  expect(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).toContain('0.0.0');
});

test.each([
  ['0.4.7', 'plain.md', '- Fix output.\n', '0.4.8'],
  ['0.4.7', 'feature.input.md', '- Add input.\n', '0.4.8'],
  ['0.4.7', 'breaking.call.md', migration, '0.5.0'],
])('a dry run increments manifest %s for %s', async (current, name, body, expected) => {
  const root = repository(current);
  put(root, `.changes/${name}`, body);
  commit(root);
  git(root, ['tag', 'v0.90.0']);
  const result = await dryRun(root, '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`## v${expected} - 2026-09-07`);
});

test('a dry run sorts by the commit that added each fragment, then filename', async () => {
  const root = repository();
  put(root, '.changes/z.md', '- First.\n');
  commit(root, '2026-01-02T12:00:00Z');
  put(root, '.changes/b.md', '- Third.\n');
  put(root, '.changes/a.md', '- Second.\n');
  commit(root, '2026-01-03T12:00:00Z');
  put(root, '.changes/z.md', '- First, corrected.\n');
  commit(root, '2026-01-04T12:00:00Z');
  const runResult = await dryRun(root, '--date', '2026-09-07');
  expect(runResult.stdout).toBe(
    '## v0.1.0 - 2026-09-07\n\n### Fixes\n\n- First, corrected.\n\n- Second.\n\n- Third.\n\n',
  );
});

test('an explicit target cuts a feature-only minor release with the same preview and written section', async () => {
  const root = repository('0.12.0');
  put(root, 'packages/core/source.ts', 'export const typed = true;\n');
  put(root, '.changes/feature.input.md', '- Add typed input.\n');
  commit(root);
  const args = ['--target', '0.13.0', '--date', '2026-10-15'];
  const preview = await dryRun(root, ...args);
  expect(preview).toEqual({
    status: 0,
    stderr: '',
    stdout: '## v0.13.0 - 2026-10-15\n\n### Features\n\n- Add typed input.\n\n',
  });
  expect(git(root, ['status', '--porcelain'])).toBe('');
  await expect(cut(root, ...args)).resolves.toEqual(preview);
  expect(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).toContain('0.13.0');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain(preview.stdout.trimEnd());
  expect(readdirSync(join(root, '.changes'))).toEqual(['README.md']);
});

test.each(['0.12.1', '0.12.10', '0.13.1', '0.20.0'])(
  'an explicit target %s may equal or exceed the feature minimum',
  async (target) => {
    const root = repository('0.12.0');
    put(root, '.changes/feature.input.md', '- Add input.\n');
    commit(root);
    await expect(dryRun(root, '--target', target)).resolves.toMatchObject({
      status: 0,
      stderr: '',
      stdout: expect.stringContaining(`## v${target} - `),
    });
  },
);

test.each([
  ['0.11.9', 'at least 0.12.1'],
  ['0.12.0', 'at least 0.12.1'],
  ['', 'stable 0.x'],
  ['v0.13.0', 'stable 0.x'],
  ['0.013.0', 'stable 0.x'],
  ['0.13', 'stable 0.x'],
  ['0.13.0-next.1', 'stable 0.x'],
  ['0.13.0+build', 'stable 0.x'],
  ['1.0.0', 'stable 0.x'],
  ['0.9007199254740991.0', 'stable 0.x'],
])('an invalid target %j fails preview and writing without edits', async (target, message) => {
  const root = repository('0.12.0');
  put(root, '.changes/feature.input.md', '- Add input.\n');
  commit(root);
  for (const args of [['--dry-run'], []]) {
    await expect(cut(root, ...args, '--target', target)).resolves.toMatchObject({
      status: 1,
      stderr: expect.stringContaining(message),
      stdout: '',
    });
    expect(git(root, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
  }
});

test('a breaking fragment sets a minor minimum that an explicit patch cannot bypass', async () => {
  const root = repository('0.12.0');
  put(root, '.changes/breaking.input.md', migration);
  commit(root);
  await expect(cut(root, '--target', '0.12.99')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('at least 0.13.0'),
    stdout: '',
  });
  expect(git(root, ['status', '--porcelain'])).toBe('');
  const runResult = await dryRun(root, '--target', '0.13.0');
  expect(runResult.status).toBe(0);
  const runResult2 = await dryRun(root, '--target', '0.14.0');
  expect(runResult2.status).toBe(0);
});

test('an explicit target retains empty-fragment and initial-release rules', async () => {
  const later = repository('0.12.0');
  const runResult = await cut(later, '--target', '0.13.0');
  expect(runResult.stderr).toContain('No fragments');
  const initial = repository();
  const runResult2 = await cut(initial, '--initial', '--target', '0.0.1');
  expect(runResult2.stderr).toContain('at least 0.1.0');
  const runResult3 = await cut(initial, '--initial', '--target', '0.2.0');
  expect(runResult3.stderr).toContain('requires a narrative');
  put(initial, 'narrative.md', 'Begin with typed input.\n');
  commit(initial);
  await expect(
    dryRun(initial, '--initial', '--target', '0.2.0', '--narrative', 'narrative.md'),
  ).resolves.toMatchObject({
    status: 0,
    stderr: '',
    stdout: expect.stringContaining('## v0.2.0 - '),
  });
});

test('an explicit target retains the clean-checkout and existing-tag safeguards', async () => {
  const root = repository('0.12.0');
  put(root, '.changes/feature.input.md', '- Add input.\n');
  commit(root);
  put(root, 'local.md', 'Local work.\n');
  const runResult = await cut(root, '--target', '0.13.0');
  expect(runResult.stderr).toContain('clean checkout');
  rmSync(join(root, 'local.md'));
  git(root, ['tag', 'v0.13.0']);
  const runResult2 = await cut(root, '--target', '0.13.0');
  expect(runResult2.stderr).toContain('Tag v0.13.0 already exists');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('a dry run refuses mismatched manifests and invalid dates without edits', async () => {
  const root = repository('0.3.1');
  put(root, 'packages/other/package.json', '{"name":"other","version":"0.3.2"}\n');
  put(root, '.changes/add.md', '- Add.\n');
  commit(root);
  const runResult = await dryRun(root);
  expect(runResult.stderr).toContain('versions must match');
  const runResult2 = await dryRun(root, '--date', '2026-02-30');
  expect(runResult2.stderr).toContain('calendar date');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('an empty set requires explicit first-release intent and cannot release later versions', async () => {
  const root = repository();
  const runResult = await dryRun(root);
  expect(runResult.stderr).toContain('No fragments');
  const later = repository('0.2.0');
  const runResult2 = await dryRun(later, '--initial');
  expect(runResult2.stderr).toContain('0.0.0');
});

test('an empty initial cut carries notes only through a narrative', async () => {
  const root = repository();
  const runResult = await dryRun(root, '--initial', '--date', '2026-09-07');
  expect(runResult.stderr).toContain('requires a narrative');
  put(root, 'narrative.md', 'Start using the typed command API.\n');
  commit(root);
  await expect(
    dryRun(root, '--initial', '--date', '2026-09-07', '--narrative', 'narrative.md'),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '## v0.1.0 - 2026-09-07\n\nStart using the typed command API.\n\n',
  });
});

test('material changes propagate through library peer dependencies while docs stay immaterial', async () => {
  const root = repository('0.2.0');
  setVersion(root, '0.3.0', {
    adapter: { name: 'adapter', peerDependencies: { '@sample/core': 'workspace:*' } },
    unrelated: { name: 'unrelated' },
  });
  put(root, 'packages/core/source.ts', 'export const value = 1;\n');
  put(root, 'docs/guide.md', '# Guide\n');
  put(root, '.changes/add.md', '- Add input.\n');
  commit(root);
  const result = await dryRun(root, '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('No material changes: unrelated.\n');
  put(root, 'tsconfig.json', '{}\n');
  commit(root);
  const runResult = await dryRun(root);
  expect(runResult.stdout).not.toContain('No material changes:');
});

test('a supplied history base changes the material report but never the version', async () => {
  const root = repository('0.8.2');
  put(root, 'packages/core/source.ts', 'export {};\n');
  commit(root);
  const base = git(root, ['rev-parse', 'HEAD']);
  put(root, '.changes/fix.md', '- Fix.\n');
  commit(root);
  const result = await dryRun(root, '--since', base, '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('## v0.8.3 - 2026-09-07');
  expect(result.stdout).toContain('No material changes: @sample/core.');
});

test('the material report needs no tag for the current version', async () => {
  const root = repository('0.6.0', { tag: false });
  put(root, 'docs/guide.md', '# Guide\n');
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  const result = await dryRun(root, '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('## v0.6.1 - 2026-09-07');
  expect(result.stdout).toContain('No material changes: @sample/core.\n');
});

test('an abandoned unpublished version keeps the baseline at the commit that set it', async () => {
  const root = repository('0.1.0');
  setVersion(root, '0.2.0', { other: { name: 'other' } });
  put(root, 'packages/core/source.ts', 'export {};\n');
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  const result = await dryRun(root, '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('## v0.2.1 - 2026-09-07');
  expect(result.stdout).toContain('No material changes: other.\n');
});

test('a version tag on an unrelated commit does not move the baseline', async () => {
  const root = repository('0.7.0', { tag: false });
  const unrelated = git(root, ['rev-parse', 'HEAD']);
  setVersion(root, '0.8.0', { other: { name: 'other' } });
  git(root, ['tag', 'v0.8.0', unrelated]);
  put(root, 'packages/core/source.ts', 'export {};\n');
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  const result = await dryRun(root, '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('## v0.8.1 - 2026-09-07');
  expect(result.stdout).toContain('No material changes: other.\n');
});

test('a version set on a side branch takes its baseline from the merge commit', async () => {
  const root = repository('0.3.0');
  setVersion(root, '0.3.0', { idle: { name: 'idle' }, other: { name: 'other' } });
  const branch = git(root, ['branch', '--show-current']);
  git(root, ['checkout', '-qb', 'feature']);
  setVersion(root, '0.4.0', { idle: { name: 'idle' }, other: { name: 'other' } });
  git(root, ['checkout', '-q', branch]);
  put(root, 'packages/other/source.ts', 'export {};\n');
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  git(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'merge',
    '--no-ff',
    '-m',
    'Merge feature',
    'feature',
  ]);
  const result = await dryRun(root, '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('## v0.4.1 - 2026-09-07');
  expect(result.stdout).toContain('No material changes: @sample/core, idle, other.\n');
});

test('the cut updates only release files, preserves workspace references, and refuses a second increment', async () => {
  const root = repository();
  put(
    root,
    'packages/adapter/package.json',
    '{"name":"adapter","version":"0.0.0","dependencies":{"@sample/core":"workspace:*"}}\n',
  );
  put(root, '.changes/add.md', '- Add input.\n');
  commit(root);
  const previewed = await dryRun(root, '--date', '2026-09-07');
  const result = await cut(root, '--date', '2026-09-07');
  expect(result).toEqual({ status: 0, stderr: '', stdout: previewed.stdout });
  expect(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).toContain(
    '"version": "0.1.0"',
  );
  expect(readFileSync(join(root, 'packages/adapter/package.json'), 'utf8')).toBe(
    '{"name":"adapter","version":"0.1.0","dependencies":{"@sample/core":"workspace:*"}}\n',
  );
  expect(readFileSync(join(root, 'examples/demo/package.json'), 'utf8')).toContain('7.0.0');
  expect(readFileSync(join(root, 'packages/private/package.json'), 'utf8')).toContain('5.0.0');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    `---\ndescription: Releases.\n---\n\n# Changelog\n\nExisting introduction.\n\n${previewed.stdout.replace(/\n+$/u, '\n')}`,
  );
  expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toContain('specifier: workspace:*');
  expect(readdirSync(join(root, '.changes'))).toEqual(['README.md']);
  const runResult = await cut(root);
  expect(runResult.status).toBe(1);
  expect(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).toContain('0.1.0');
});

test('the cut reads no key of the loom.config.json at the repository root, and keeps to .changes and CHANGELOG.md', async () => {
  const root = repository();
  put(
    root,
    'loom.config.json',
    '{ "paths": { "changelog": "docs/CHANGELOG.md", "changes": "notes" } }\n',
  );
  put(root, '.changes/add.md', '- Add input.\n');
  put(root, 'notes/other.md', '- Not read.\n');
  commit(root);
  const result = await cut(root, '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('## v0.1.0 - 2026-09-07\n\n### Fixes\n\n- Add input.\n\n');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain('## v0.1.0 - 2026-09-07');
  expect(readdirSync(join(root, '.changes'))).toEqual(['README.md']);
  expect(readdirSync(join(root, 'notes'))).toEqual(['other.md']);
  expect(readdirSync(root)).not.toContain('docs');
});

test('lockfile preparation failure leaves the original repository unchanged', async () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add input.\n');
  put(root, 'pnpm-lock.yaml', 'invalid: [\n');
  commit(root);
  const runResult = await cut(root, '--date', '2026-09-07');
  expect(runResult.status).toBe(1);
  expect(git(root, ['status', '--porcelain'])).toBe('');
  expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe('invalid: [\n');
});

test('the cut supports pnpm multi-document lockfiles and preserves earlier releases', async () => {
  const root = repository('0.3.0');
  const history = '## v0.3.0 - 2026-01-01\n\n### Changes\n\n- Old entry.\n';
  put(root, 'CHANGELOG.md', `# Changelog\n\n${history}`);
  put(
    root,
    'pnpm-lock.yaml',
    '---\nlockfileVersion: "9.0"\nimporters: {}\n---\nlockfileVersion: "9.0"\nimporters: {}\n',
  );
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  const previewed = await dryRun(root, '--date', '2026-09-07');
  await expect(cut(root, '--date', '2026-09-07')).resolves.toEqual(previewed);
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    `# Changelog\n\n${previewed.stdout}${history}`,
  );
});

test('the cut restores release files after a filesystem write fails', async () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add input.\n');
  commit(root);
  const original = fs.writeFileSync;
  let failed = false;
  vi.mocked(writeFileSync).mockImplementation((path, ...args) => {
    if (!failed && String(path) === join(root, 'packages/core/package.json')) {
      failed = true;
      original(path, 'partial write');
      throw new Error('induced write failure');
    }
    return original(path, ...args);
  });
  const result = await cut(root, '--date', '2026-09-07');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('induced write failure');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('an optional narrative appears before entries without rewriting it', async () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add.\n');
  put(root, 'narrative.md', 'This release adds **typed** input.\n');
  commit(root);
  const runResult = await dryRun(root, '--date', '2026-09-07', '--narrative', 'narrative.md');
  expect(runResult.stdout).toBe(
    '## v0.1.0 - 2026-09-07\n\nThis release adds **typed** input.\n\n### Fixes\n\n- Add.\n\n',
  );
});

test('opaque fragment names are literal Git paths and merges establish landing order', async () => {
  const root = repository();
  const branch = git(root, ['branch', '--show-current']);
  git(root, ['checkout', '-qb', 'feature']);
  put(root, '.changes/[change].md', '- Landed last.\n');
  commit(root, '2026-01-02T12:00:00Z');
  git(root, ['checkout', '-q', branch]);
  put(root, '.changes/change.md', '- Landed first.\n');
  commit(root, '2026-01-03T12:00:00Z');
  git(
    root,
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'merge',
      '--no-ff',
      '-m',
      'Merge feature',
      'feature',
    ],
    '2026-01-04T12:00:00Z',
  );
  const result = await dryRun(root, '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    '## v0.1.0 - 2026-09-07\n\n### Fixes\n\n- Landed first.\n\n- Landed last.\n\n',
  );
});

test('the cut refuses dirty inputs and existing tags without edits', async () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add.\n');
  commit(root);
  put(root, 'local.txt', 'local work');
  const runResult = await cut(root);
  expect(runResult.stderr).toContain('clean checkout');
  rmSync(join(root, 'local.txt'));
  git(root, ['tag', 'v0.1.0']);
  const runResult2 = await cut(root);
  expect(runResult2.stderr).toContain('Tag v0.1.0 already exists');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('Git history treats bracketed fragment names literally', async () => {
  const root = repository();
  put(root, '.changes/[a].md', '- First.\n');
  commit(root, '2026-01-02T12:00:00Z');
  put(root, '.changes/z.md', '- Second.\n');
  commit(root, '2026-01-03T12:00:00Z');
  put(root, '.changes/a.md', '- Third.\n');
  commit(root, '2026-01-04T12:00:00Z');
  const runResult = await dryRun(root, '--date', '2026-09-07');
  expect(runResult.stdout).toBe(
    '## v0.1.0 - 2026-09-07\n\n### Fixes\n\n- First.\n\n- Second.\n\n- Third.\n\n',
  );
});

test('private manifests need no name or version to be excluded', async () => {
  const root = repository();
  put(root, 'packages/private/package.json', '{"private":true}\n');
  put(root, '.changes/add.md', '- Add input.\n');
  commit(root);
  const runResult = await dryRun(root);
  expect(runResult.status).toBe(0);
});

test('explicit workspace targets win over dependency keys with the same library name', async () => {
  const root = repository('0.2.0');
  setVersion(root, '0.3.0', {
    aaa: { name: 'aaa' },
    consumer: { dependencies: { aaa: 'workspace:zzz@*' }, name: 'consumer' },
    zzz: { name: 'zzz' },
  });
  put(root, 'packages/zzz/code.ts', 'export {};\n');
  put(root, '.changes/add.md', '- Add.\n');
  commit(root);
  const runResult = await dryRun(root);
  expect(runResult.stdout).toContain('No material changes: @sample/core, aaa.');
});

test('a persistent filesystem failure does not prevent restoration of earlier files', async () => {
  const root = repository();
  const originalChangelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  put(root, '.changes/add.md', '- Add input.\n');
  commit(root);
  const original = fs.writeFileSync;
  vi.mocked(writeFileSync).mockImplementation((path, ...args) => {
    if (String(path) === join(root, 'packages/core/package.json')) {
      original(path, 'partial write');
      throw new Error('persistent write failure');
    }
    return original(path, ...args);
  });
  const result = await cut(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('rollback incomplete');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(originalChangelog);
  expect(readFileSync(join(root, '.changes/add.md'), 'utf8')).toBe('- Add input.\n');
});

test('a dry run refuses shallow history instead of inventing landing dates', async () => {
  const source = repository();
  put(source, '.changes/z.md', '- First.\n');
  commit(source, '2026-01-02T12:00:00Z');
  put(source, '.changes/a.md', '- Second.\n');
  commit(source, '2026-01-03T12:00:00Z');
  const root = join(temporaryRoot('loom-release-cut-'), 'shallow');
  git(source, ['clone', '--depth', '1', '--no-local', source, root]);
  const runResult = await dryRun(root);
  expect(runResult.stderr).toContain('full Git history');
});

test.each(['## **Unreleased**', '## **v0.1.0** - 2026-01-01'])(
  'the cut recognizes formatted history heading %s',
  async (heading) => {
    const root = repository();
    put(root, 'CHANGELOG.md', `# Changelog\n\n${heading}\n\n- Existing.\n`);
    put(root, '.changes/add.md', '- Add.\n');
    commit(root);
    const runResult = await cut(root);
    expect(runResult.stderr).toMatch(/has an Unreleased section|already has a v0\.1\.0 section/u);
    expect(git(root, ['status', '--porcelain'])).toBe('');
  },
);

test.each(['```text\nunfinished', '<script>\nunfinished'])(
  'narrative cannot swallow generated headings with %s',
  async (body) => {
    const root = repository();
    put(root, '.changes/add.md', '- Add.\n');
    put(root, 'narrative.md', body);
    commit(root);
    const runResult = await dryRun(root, '--narrative', 'narrative.md');
    expect(runResult.stderr).toContain('unclosed Markdown block');
  },
);

test('the cut refuses history with an open block that would hide the new release', async () => {
  const root = repository();
  put(root, 'CHANGELOG.md', '# Changelog\n\n```text\nunfinished\n');
  put(root, '.changes/add.md', '- Add.\n');
  commit(root);
  const runResult = await cut(root);
  expect(runResult.stderr).toContain('unclosed Markdown block');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test.each(['## <em>Unreleased</em>', '## <code>v0.1.0</code> - 2026-01-01', '## v0.1.0'])(
  'the cut rejects history heading %s by its displayed text',
  async (heading) => {
    const root = repository();
    put(root, 'CHANGELOG.md', `# Changelog\n\n${heading}\n\n- Existing.\n`);
    put(root, '.changes/add.md', '- Add.\n');
    commit(root);
    const runResult = await cut(root);
    expect(runResult.stderr).toMatch(/has an Unreleased section|already has a v0\.1\.0 section/u);
    expect(git(root, ['status', '--porcelain'])).toBe('');
  },
);

test('an existing release lock stays intact and gives recovery guidance', async () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add.\n');
  commit(root);
  mkdirSync(join(root, '.git/release-cut.lock'));
  put(root, '.git/release-cut.lock/owner', 'existing writer');
  const result = await cut(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Another writer may be active');
  expect(result.stderr).toContain('fresh isolated checkout');
  expect(readFileSync(join(root, '.git/release-cut.lock/owner'), 'utf8')).toBe('existing writer');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test.each([[['--dry-run']], [[]]])(
  'release cut %j rejects unused passthrough without editing release files',
  async (mode) => {
    const root = repository();
    put(root, '.changes/change.md', '- Add an operation.\n');
    commit(root);
    const result = await cut(root, ...mode, '--', '--date', '2026-09-07');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Arguments after -- are not supported.');
    expect(git(root, ['status', '--porcelain'])).toBe('');
  },
);

test('a feature fragment advances the synchronized patch and renders under Features', async () => {
  const root = repository('0.4.7');
  put(root, '.changes/feature.typed.md', '- Add typed input.\n');
  put(root, '.changes/output.md', '- Fix output.\n');
  commit(root);
  await expect(dryRun(root, '--date', '2026-09-07')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout:
      '## v0.4.8 - 2026-09-07\n\n### Features\n\n- Add typed input.\n\n### Fixes\n\n- Fix output.\n\nNo material changes: @sample/core.\n\n',
  });
});

test('a dry run orders fragments added within one second by their commits', async () => {
  const root = repository();
  for (const name of ['charlie', 'bravo', 'alpha']) {
    put(root, `.changes/${name}.md`, `- Fix ${name}.\n`);
    commit(root, '2026-01-02T12:00:00Z');
  }
  const runResult = await dryRun(root, '--date', '2026-09-07');
  expect(runResult.stdout).toBe(
    '## v0.1.0 - 2026-09-07\n\n### Fixes\n\n- Fix charlie.\n\n- Fix bravo.\n\n- Fix alpha.\n\n',
  );
});

test('the cut renders a fragment that starts with a byte order mark as a list and consumes it', async () => {
  const root = repository();
  put(root, '.changes/add.md', '﻿- Add input.\n');
  commit(root);
  const result = await cut(root, '--date', '2026-09-07');
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: '## v0.1.0 - 2026-09-07\n\n### Fixes\n\n- Add input.\n\n',
  });
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    '---\ndescription: Releases.\n---\n\n# Changelog\n\nExisting introduction.\n\n## v0.1.0 - 2026-09-07\n\n### Fixes\n\n- Add input.\n',
  );
  expect(readdirSync(join(root, '.changes'))).toEqual(['README.md']);
});

test('the cut ignores hidden entries in .changes/ and leaves them in place', async () => {
  const root = repository();
  put(root, '.changes/.DS_Store', '\u0000binary');
  put(root, '.changes/.notes.md', '- Hidden fix.\n');
  put(root, '.changes/add.md', '- Add input.\n');
  commit(root);
  const runResult = await cut(root, '--date', '2026-09-07');
  expect(runResult.stdout).toBe('## v0.1.0 - 2026-09-07\n\n### Fixes\n\n- Add input.\n\n');
  expect(readdirSync(join(root, '.changes')).toSorted()).toEqual(
    ['.DS_Store', '.notes.md', 'README.md'].toSorted(),
  );
});
