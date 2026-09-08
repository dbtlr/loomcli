import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const cli = new URL('../dist/main.js', import.meta.url);
const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'loom-changelog-')));
  roots.push(root);
  mkdirSync(join(root, '.changes'));
  writeFileSync(join(root, '.changes/README.md'), '# Guide\n');
  return root;
}
function run(root: string, ...args: string[]) {
  return invoke(cli, ['changelog', ...args], { cwd: root });
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test('check accepts nested Markdown and ignores only the directory guide', () => {
  const root = fixture();
  writeFileSync(
    join(root, '.changes/new.md'),
    '- Add input.\n\n  Example:\n\n  ```ts\n  call();\n  ```\n\n  - Nested detail.\n',
  );
  expect(run(root, 'check')).toEqual({ status: 0, stderr: '', stdout: 'Checked 1 fragment.\n' });
});

const migration = `- Remove the old call.

### Migration

**Affected surface.** The call.

**Why.** Remove ambiguity.

**Before and after.**

\`\`\`ts
old();
\`\`\`

\`\`\`ts
updated();
\`\`\`

**Steps.**

1. Replace the call.

**Validation.** Run the tests.
`;

test('check recognizes a breaking migration as Markdown structure', () => {
  const root = fixture();
  writeFileSync(join(root, '.changes/breaking.call.md'), migration);
  expect(run(root, 'check')).toEqual({ status: 0, stderr: '', stdout: 'Checked 1 fragment.\n' });
});

test.each([
  ['breaking.md', '- Change.\n'],
  ['breaking..md', '- Change.\n'],
  ['change.txt', '- Change.\n'],
  ['change.MD', '- Change.\n'],
  ['ordinary.md', '---\ndescription: wrong\n---\n- Add.\n'],
  ['ordinary.md', '# Changes\n\n- Add.\n'],
  ['ordinary.md', '-\n'],
  ['ordinary.md', '1. Add.\n'],
  ['ordinary.md', migration],
  ['breaking.call.md', migration.replace('**Why.**', '**Reason.**')],
  ['breaking.call.md', `${migration.replace('### Migration', '```md\n### Migration')}\n\`\`\`\n`],
  [
    'breaking.call.md',
    migration.replace('**Why.** Remove ambiguity.', '> **Why.** Remove ambiguity.'),
  ],
  ['breaking.call.md', migration.concat('\n### Migration\n')],
])('check rejects invalid fragment %s with no file edits', (name, body) => {
  const root = fixture();
  writeFileSync(join(root, '.changes', name), body);
  const result = run(root, 'check');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`.changes/${name}:`);
  expect(readFileSync(join(root, '.changes', name), 'utf8')).toBe(body);
});

function git(root: string, args: string[], date = '2026-01-01T12:00:00Z') {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return result.stdout.trim();
}
function put(root: string, path: string, body: string) {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, body);
}
function commit(root: string, date?: string) {
  git(root, ['add', '.']);
  git(
    root,
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'],
    date,
  );
}
function repository(version = '0.0.0', { tag = true } = {}) {
  const root = fixture();
  git(root, ['init', '-q']);
  git(root, ['config', 'core.autocrlf', 'false']);
  put(root, '.gitignore', 'node_modules/\n');
  put(root, 'package.json', '{"name":"fixture","private":true,"version":"9.0.0"}\n');
  put(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n  - examples/*\n');
  put(
    root,
    'packages/core/package.json',
    `${JSON.stringify({ name: '@sample/core', version }, null, 2)}\n`,
  );
  put(root, 'examples/demo/package.json', '{"name":"demo","private":true,"version":"7.0.0"}\n');
  put(
    root,
    'packages/private/package.json',
    '{"name":"private","private":true,"version":"5.0.0"}\n',
  );
  put(
    root,
    'CHANGELOG.md',
    '---\ndescription: Releases.\n---\n\n# Changelog\n\nExisting introduction.\n',
  );
  commit(root);
  if (tag && version !== '0.0.0') {
    git(root, ['tag', `v${version}`]);
  }
  return root;
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

test('preview derives the first version from manifests and preserves fragment prose', () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add **typed** input.\n\n  - Preserve nested detail.\n');
  commit(root);
  git(root, ['tag', 'v0.99.0']);
  const before = git(root, ['status', '--porcelain']);
  expect(run(root, 'preview', '--date', '2026-09-07')).toEqual({
    status: 0,
    stderr: '',
    stdout:
      '## v0.1.0 - 2026-09-07\n\n### Changes\n\n- Add **typed** input.\n\n  - Preserve nested detail.\n\n',
  });
  expect(git(root, ['status', '--porcelain'])).toBe(before);
  expect(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).toContain('0.0.0');
});

test.each([
  ['0.4.7', 'plain.md', '- Fix output.\n', '0.4.8'],
  ['0.4.7', 'breaking.call.md', migration, '0.5.0'],
])('preview increments manifest %s for %s', (current, name, body, expected) => {
  const root = repository(current);
  put(root, `.changes/${name}`, body);
  commit(root);
  git(root, ['tag', 'v0.90.0']);
  const result = run(root, 'preview', '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`## v${expected} - 2026-09-07`);
});

test('preview sorts by the commit that added each fragment, then filename', () => {
  const root = repository();
  put(root, '.changes/z.md', '- First.\n');
  commit(root, '2026-01-02T12:00:00Z');
  put(root, '.changes/b.md', '- Third.\n');
  put(root, '.changes/a.md', '- Second.\n');
  commit(root, '2026-01-03T12:00:00Z');
  put(root, '.changes/z.md', '- First, corrected.\n');
  commit(root, '2026-01-04T12:00:00Z');
  expect(run(root, 'preview', '--date', '2026-09-07').stdout).toBe(
    '## v0.1.0 - 2026-09-07\n\n### Changes\n\n- First, corrected.\n\n- Second.\n\n- Third.\n\n',
  );
});

test('preview refuses mismatched manifests and invalid dates without edits', () => {
  const root = repository('0.3.1');
  put(root, 'packages/other/package.json', '{"name":"other","version":"0.3.2"}\n');
  put(root, '.changes/add.md', '- Add.\n');
  commit(root);
  expect(run(root, 'preview').stderr).toContain('versions must match');
  expect(run(root, 'preview', '--date', '2026-02-30').stderr).toContain('calendar date');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('an empty set requires explicit first-release intent and cannot release later versions', () => {
  const root = repository();
  expect(run(root, 'preview').stderr).toContain('No fragments');
  expect(run(root, 'preview', '--initial', '--date', '2026-09-07')).toEqual({
    status: 0,
    stderr: '',
    stdout: '## v0.1.0 - 2026-09-07\n\n',
  });
  const later = repository('0.2.0');
  expect(run(later, 'preview', '--initial').stderr).toContain('0.0.0');
});

test('material changes propagate through library peer dependencies while docs stay immaterial', () => {
  const root = repository('0.2.0');
  setVersion(root, '0.3.0', {
    adapter: { name: 'adapter', peerDependencies: { '@sample/core': 'workspace:*' } },
    unrelated: { name: 'unrelated' },
  });
  put(root, 'packages/core/source.ts', 'export const value = 1;\n');
  put(root, 'docs/guide.md', '# Guide\n');
  put(root, '.changes/add.md', '- Add input.\n');
  commit(root);
  const result = run(root, 'preview', '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('No material changes: unrelated.\n');
  put(root, 'tsconfig.json', '{}\n');
  commit(root);
  expect(run(root, 'preview').stdout).not.toContain('No material changes:');
});

test('a supplied history base changes the material report but never the version', () => {
  const root = repository('0.8.2');
  put(root, 'packages/core/source.ts', 'export {};\n');
  commit(root);
  const base = git(root, ['rev-parse', 'HEAD']);
  put(root, '.changes/fix.md', '- Fix.\n');
  commit(root);
  const result = run(root, 'preview', '--since', base, '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('## v0.8.3 - 2026-09-07');
  expect(result.stdout).toContain('No material changes: @sample/core.');
});

test('the material report needs no tag for the current version', () => {
  const root = repository('0.6.0', { tag: false });
  put(root, 'docs/guide.md', '# Guide\n');
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  const result = run(root, 'preview', '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('## v0.6.1 - 2026-09-07');
  expect(result.stdout).toContain('No material changes: @sample/core.\n');
});

test('an abandoned unpublished version keeps the baseline at the commit that set it', () => {
  const root = repository('0.1.0');
  setVersion(root, '0.2.0', { other: { name: 'other' } });
  put(root, 'packages/core/source.ts', 'export {};\n');
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  const result = run(root, 'preview', '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('## v0.2.1 - 2026-09-07');
  expect(result.stdout).toContain('No material changes: other.\n');
});

test('a version tag on an unrelated commit does not move the baseline', () => {
  const root = repository('0.7.0', { tag: false });
  const unrelated = git(root, ['rev-parse', 'HEAD']);
  setVersion(root, '0.8.0', { other: { name: 'other' } });
  git(root, ['tag', 'v0.8.0', unrelated]);
  put(root, 'packages/core/source.ts', 'export {};\n');
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  const result = run(root, 'preview', '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('## v0.8.1 - 2026-09-07');
  expect(result.stdout).toContain('No material changes: other.\n');
});

test('a version set on a side branch takes its baseline from the merge commit', () => {
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
  const result = run(root, 'preview', '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('## v0.4.1 - 2026-09-07');
  expect(result.stdout).toContain('No material changes: @sample/core, idle, other.\n');
});

test('write updates only release files, preserves workspace references, and refuses a second increment', () => {
  const root = repository();
  put(
    root,
    'packages/adapter/package.json',
    '{"name":"adapter","version":"0.0.0","dependencies":{"@sample/core":"workspace:*"}}\n',
  );
  put(root, '.changes/add.md', '- Add input.\n');
  commit(root);
  const preview = run(root, 'preview', '--date', '2026-09-07');
  const result = run(root, 'write', '--date', '2026-09-07');
  expect(result).toEqual({ status: 0, stderr: '', stdout: preview.stdout });
  expect(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).toContain(
    '"version": "0.1.0"',
  );
  expect(readFileSync(join(root, 'packages/adapter/package.json'), 'utf8')).toContain(
    '"@sample/core": "workspace:*"',
  );
  expect(readFileSync(join(root, 'examples/demo/package.json'), 'utf8')).toContain('7.0.0');
  expect(readFileSync(join(root, 'packages/private/package.json'), 'utf8')).toContain('5.0.0');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    `---\ndescription: Releases.\n---\n\n# Changelog\n\nExisting introduction.\n\n${preview.stdout}`,
  );
  expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toContain('specifier: workspace:*');
  expect(readdirSync(join(root, '.changes'))).toEqual(['README.md']);
  expect(run(root, 'write').status).toBe(1);
  expect(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).toContain('0.1.0');
});

test('lockfile preparation failure leaves the original repository unchanged', () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add input.\n');
  put(root, 'pnpm-lock.yaml', 'invalid: [\n');
  commit(root);
  expect(run(root, 'write', '--date', '2026-09-07').status).toBe(1);
  expect(git(root, ['status', '--porcelain'])).toBe('');
  expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe('invalid: [\n');
});

test('write supports pnpm multi-document lockfiles and preserves earlier releases', () => {
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
  const preview = run(root, 'preview', '--date', '2026-09-07');
  expect(run(root, 'write', '--date', '2026-09-07')).toEqual(preview);
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
    `# Changelog\n\n${preview.stdout}${history}`,
  );
});

// Node synchronizes patched builtin exports; the normal CLI cases use the selected runtime.
test('write restores release files after a filesystem write fails', () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add input.\n');
  const preload = join(root, 'fail-write.mjs');
  put(
    root,
    'fail-write.mjs',
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.writeFileSync;
let failed = false;
fs.writeFileSync = function (path, ...args) {
  if (!failed && String(path) === process.env.FAIL_WRITE_PATH) {
    failed = true;
    original(path, 'partial write');
    throw new Error('induced write failure');
  }
  return original(path, ...args);
};
syncBuiltinESMExports();
`,
  );
  commit(root);
  const result = spawnSync(
    'node',
    [
      '--import',
      pathToFileURL(preload).href,
      fileURLToPath(cli),
      'changelog',
      'write',
      '--date',
      '2026-09-07',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FAIL_WRITE_PATH: join(root, 'packages/core/package.json') },
      timeout: 10_000,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('induced write failure');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('an optional narrative appears before entries without rewriting it', () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add.\n');
  put(root, 'narrative.md', 'This release adds **typed** input.\n');
  commit(root);
  expect(run(root, 'preview', '--date', '2026-09-07', '--narrative', 'narrative.md').stdout).toBe(
    '## v0.1.0 - 2026-09-07\n\nThis release adds **typed** input.\n\n### Changes\n\n- Add.\n\n',
  );
});

test('opaque fragment names are literal Git paths and merges establish landing order', () => {
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
  const result = run(root, 'preview', '--date', '2026-09-07');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    '## v0.1.0 - 2026-09-07\n\n### Changes\n\n- Landed first.\n\n- Landed last.\n\n',
  );
});

test.each(['directory', 'README.md'])('check refuses directories named %s', (name) => {
  const root = fixture();
  rmSync(join(root, '.changes/README.md'));
  mkdirSync(join(root, '.changes', name));
  expect(run(root, 'check').stderr).toContain(`.changes/${name}:`);
});

test('write refuses dirty inputs and existing tags without edits', () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add.\n');
  commit(root);
  put(root, 'local.txt', 'local work');
  expect(run(root, 'write').stderr).toContain('clean checkout');
  rmSync(join(root, 'local.txt'));
  git(root, ['tag', 'v0.1.0']);
  expect(run(root, 'write').stderr).toContain('Tag v0.1.0 already exists');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('Git history treats bracketed fragment names literally', () => {
  const root = repository();
  put(root, '.changes/[a].md', '- First.\n');
  commit(root, '2026-01-02T12:00:00Z');
  put(root, '.changes/z.md', '- Second.\n');
  commit(root, '2026-01-03T12:00:00Z');
  put(root, '.changes/a.md', '- Third.\n');
  commit(root, '2026-01-04T12:00:00Z');
  expect(run(root, 'preview', '--date', '2026-09-07').stdout).toBe(
    '## v0.1.0 - 2026-09-07\n\n### Changes\n\n- First.\n\n- Second.\n\n- Third.\n\n',
  );
});

test('private manifests need no name or version to be excluded', () => {
  const root = repository();
  put(root, 'packages/private/package.json', '{"private":true}\n');
  put(root, '.changes/add.md', '- Add input.\n');
  commit(root);
  expect(run(root, 'preview').status).toBe(0);
});

test('explicit workspace targets win over dependency keys with the same library name', () => {
  const root = repository('0.2.0');
  setVersion(root, '0.3.0', {
    aaa: { name: 'aaa' },
    consumer: { dependencies: { aaa: 'workspace:zzz@*' }, name: 'consumer' },
    zzz: { name: 'zzz' },
  });
  put(root, 'packages/zzz/code.ts', 'export {};\n');
  put(root, '.changes/add.md', '- Add.\n');
  commit(root);
  expect(run(root, 'preview').stdout).toContain('No material changes: @sample/core, aaa.');
});

test('a persistent filesystem failure does not prevent restoration of earlier files', () => {
  const root = repository();
  const originalChangelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  put(root, '.changes/add.md', '- Add input.\n');
  const preload = join(root, 'fail-write.mjs');
  put(
    root,
    'fail-write.mjs',
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.writeFileSync;
fs.writeFileSync = function (path, ...args) {
  if (String(path) === process.env.FAIL_WRITE_PATH) {
    original(path, 'partial write');
    throw new Error('persistent write failure');
  }
  return original(path, ...args);
};
syncBuiltinESMExports();
`,
  );
  commit(root);
  const result = spawnSync(
    'node',
    ['--import', pathToFileURL(preload).href, fileURLToPath(cli), 'changelog', 'write'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FAIL_WRITE_PATH: join(root, 'packages/core/package.json') },
      timeout: 10_000,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('rollback incomplete');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(originalChangelog);
  expect(readFileSync(join(root, '.changes/add.md'), 'utf8')).toBe('- Add input.\n');
});

test('preview refuses shallow history instead of inventing landing dates', () => {
  const source = repository();
  put(source, '.changes/z.md', '- First.\n');
  commit(source, '2026-01-02T12:00:00Z');
  put(source, '.changes/a.md', '- Second.\n');
  commit(source, '2026-01-03T12:00:00Z');
  const root = join(fixture(), 'shallow');
  git(source, ['clone', '--depth', '1', '--no-local', source, root]);
  expect(run(root, 'preview').stderr).toContain('full Git history');
});

test.each(['## **Unreleased**', '## **v0.1.0** - 2026-01-01'])(
  'write recognizes formatted history heading %s',
  (heading) => {
    const root = repository();
    put(root, 'CHANGELOG.md', `# Changelog\n\n${heading}\n\n- Existing.\n`);
    put(root, '.changes/add.md', '- Add.\n');
    commit(root);
    expect(run(root, 'write').stderr).toContain('already contains');
    expect(git(root, ['status', '--porcelain'])).toBe('');
  },
);

test.each(['```text\nunfinished', '<script>\nunfinished'])(
  'narrative cannot swallow generated headings with %s',
  (body) => {
    const root = repository();
    put(root, '.changes/add.md', '- Add.\n');
    put(root, 'narrative.md', body);
    commit(root);
    expect(run(root, 'preview', '--narrative', 'narrative.md').stderr).toContain(
      'unclosed Markdown block',
    );
  },
);

test('write refuses history with an open block that would hide the new release', () => {
  const root = repository();
  put(root, 'CHANGELOG.md', '# Changelog\n\n```text\nunfinished\n');
  put(root, '.changes/add.md', '- Add.\n');
  commit(root);
  expect(run(root, 'write').stderr).toContain('unclosed Markdown block');
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test.each(['## <em>Unreleased</em>', '## <code>v0.1.0</code> - 2026-01-01', '## v0.1.0'])(
  'write rejects history heading %s by its displayed text',
  (heading) => {
    const root = repository();
    put(root, 'CHANGELOG.md', `# Changelog\n\n${heading}\n\n- Existing.\n`);
    put(root, '.changes/add.md', '- Add.\n');
    commit(root);
    expect(run(root, 'write').stderr).toContain('already contains');
    expect(git(root, ['status', '--porcelain'])).toBe('');
  },
);

test('an existing release lock stays intact and gives recovery guidance', () => {
  const root = repository();
  put(root, '.changes/add.md', '- Add.\n');
  commit(root);
  mkdirSync(join(root, '.git/changelog-write.lock'));
  put(root, '.git/changelog-write.lock/owner', 'existing writer');
  const result = run(root, 'write');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Another writer may be active');
  expect(result.stderr).toContain('fresh isolated checkout');
  expect(readFileSync(join(root, '.git/changelog-write.lock/owner'), 'utf8')).toBe(
    'existing writer',
  );
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('check rejects release-only options through Loom before reading files', () => {
  const root = fixture();
  const result = run(root, 'check', '--initial');
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--initial');
});

test.each(['check', 'preview', 'write'])(
  '%s rejects unused passthrough without editing release files',
  (mode) => {
    const root = repository();
    put(root, '.changes/change.md', '- Add an operation.\n');
    commit(root);
    const result = run(root, mode, '--', '--date', '2026-09-07');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Arguments after -- are not supported.');
    expect(git(root, ['status', '--porcelain'])).toBe('');
  },
);
