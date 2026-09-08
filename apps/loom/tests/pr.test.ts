import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test, vi } from 'vite-plus/test';
import { parse } from 'yaml';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

// These fixtures run multiple Git and pnpm processes; Windows CI exceeds the five-second default.
vi.setConfig({ testTimeout: 30_000 });

const cli = new URL('../dist/main.js', import.meta.url);
const roots: string[] = [];

function git(root: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return result.stdout.trim();
}

function put(root: string, path: string, body: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}

function commit(root: string) {
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qm',
    'fixture',
  );
  return git(root, 'rev-parse', 'HEAD');
}

function repository(version = '0.4.7') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'loom-pr-')));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'core.autocrlf', 'false');
  put(root, '.changes/README.md', '# Guide\n');
  put(root, 'package.json', '{"name":"fixture","private":true}');
  put(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  put(root, 'packages/core/package.json', JSON.stringify({ name: '@sample/core', version }));
  put(root, 'packages/core/index.js', 'export const value = 1;\n');
  put(root, 'CHANGELOG.md', '# Changelog\n\n');
  const base = commit(root);
  if (version !== '0.0.0') {
    git(root, 'tag', `v${version}`);
  }
  return { base, root };
}

function check(root: string, base: string, ...args: string[]) {
  return invoke(cli, ['pr', 'check', '--base', base, '--title', 'Fix output', ...args], {
    cwd: root,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function releaseCheck(root: string, base: string, version: string) {
  return invoke(
    cli,
    [
      'pr',
      'check',
      '--base',
      base,
      '--title',
      `chore(release): Release v${version} - Improve output`,
    ],
    { cwd: root },
  );
}

test('a compiler-written release passes and unrelated code cannot enter the release cut', () => {
  const { root } = repository();
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  expect(invoke(cli, ['changelog', 'write', '--date', '2026-09-07'], { cwd: root }).status).toBe(0);
  commit(root);
  expect(releaseCheck(root, base, '0.4.8')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'PR checks passed.\n',
  });
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  commit(root);
  expect(releaseCheck(root, base, '0.4.8')).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('outside the release cut'),
  });
});

test('build-affecting PRs require a changed fragment or skip label', () => {
  const { base, root } = repository();
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  commit(root);
  expect(check(root, base)).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('fragment or skip-changelog'),
  });
  expect(check(root, base, '--label', 'skip-changelog')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'PR checks passed.\n',
  });
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  expect(check(root, base)).toEqual({ status: 0, stderr: '', stdout: 'PR checks passed.\n' });
});

test('ordinary PRs cannot bump a library, even with skip-changelog or by making it private', () => {
  const { base, root } = repository();
  put(root, 'packages/core/package.json', '{"name":"@sample/core","version":"0.4.8"}');
  commit(root);
  expect(check(root, base, '--label', 'skip-changelog')).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('version must stay 0.4.7'),
  });
  put(root, 'packages/other/package.json', '{"name":"other","version":"0.4.7"}');
  put(
    root,
    'packages/core/package.json',
    '{"name":"@sample/core","private":true,"version":"0.4.8"}',
  );
  commit(root);
  expect(check(root, base, '--label', 'skip-changelog')).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('version must stay 0.4.7'),
  });
});

test('release validation checks generated entries and preserves earlier changelog history', () => {
  const { root } = repository();
  put(
    root,
    'CHANGELOG.md',
    '# Changelog\n\n## v0.4.7 - 2026-01-01\n\n### Changes\n\n- Earlier result.\n\n',
  );
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  expect(invoke(cli, ['changelog', 'write', '--date', '2026-09-07'], { cwd: root }).status).toBe(0);
  const expected = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  put(root, 'CHANGELOG.md', expected.replace('- Fix output.', '- Something else.'));
  commit(root);
  expect(releaseCheck(root, base, '0.4.8')).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('CHANGELOG.md'),
  });
  put(root, 'CHANGELOG.md', expected.replace('- Earlier result.', '- Rewritten history.'));
  commit(root);
  expect(releaseCheck(root, base, '0.4.8')).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('CHANGELOG.md'),
  });
  put(root, 'CHANGELOG.md', expected);
  commit(root);
  expect(releaseCheck(root, base, '0.4.8').status).toBe(0);
});

test('a release cannot delete its lockfile or change a manifest file mode', () => {
  const { root } = repository('0.0.0');
  const base = git(root, 'rev-parse', 'HEAD');
  expect(
    invoke(cli, ['changelog', 'write', '--initial', '--date', '2026-09-07'], { cwd: root }).status,
  ).toBe(0);
  const cut = commit(root);
  rmSync(join(root, 'pnpm-lock.yaml'));
  commit(root);
  expect(releaseCheck(root, base, '0.1.0')).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('pnpm-lock.yaml'),
  });
  git(root, 'reset', '--hard', cut);
  git(root, 'update-index', '--chmod=+x', 'packages/core/package.json');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'mode');
  expect(releaseCheck(root, base, '0.1.0')).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('file mode'),
  });
});

test('PR checks refuse shallow history', () => {
  const { base, root } = repository();
  put(root, 'docs/guide.md', '# Guide\n');
  commit(root);
  const clone = join(root, 'shallow');
  git(root, 'clone', '--depth=1', '--no-local', root, clone);
  expect(check(clone, base)).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('full Git history'),
  });
});

test.each(['docs/guide.md', 'README.md'])('documentation path %s needs no fragment', (path) => {
  const { base, root } = repository();
  put(root, path, '# Guide\n');
  commit(root);
  expect(check(root, base).status).toBe(0);
});

test('an old untouched fragment and a guide edit do not satisfy admission; a correction does', () => {
  const { root } = repository();
  put(root, '.changes/old.md', '- Add old output.\n');
  const base = commit(root);
  put(root, '.changes/README.md', '# Revised guide\n');
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  commit(root);
  expect(check(root, base).stderr).toContain('fragment or skip-changelog');
  put(root, '.changes/old.md', '- Add corrected output.\n');
  commit(root);
  expect(check(root, base).status).toBe(0);
});

test('skip never excuses an invalid fragment already at head', () => {
  const { root } = repository();
  put(root, '.changes/breaking.invalid.md', '- Break output without migration.\n');
  const base = commit(root);
  put(root, 'docs/guide.md', '# Guide\n');
  commit(root);
  expect(check(root, base, '--label', 'skip-changelog')).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('Migration'),
  });
});

test('comparison uses committed head content and excludes changes from the base branch', () => {
  const { base, root } = repository();
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  const feature = commit(root);
  put(root, '.changes/local.md', '- Uncommitted output.\n');
  expect(check(root, base, '--head', feature).stderr).toContain('fragment or skip-changelog');
  rmSync(join(root, '.changes/local.md'));
  git(root, 'checkout', '--detach', base);
  put(root, '.changes/base.md', '- A different feature.\n');
  const advanced = commit(root);
  expect(check(root, advanced, '--head', feature).stderr).toContain('fragment or skip-changelog');
  git(root, 'checkout', '--detach', base);
  put(root, 'docs/guide.md', '# Guide\n');
  const docs = commit(root);
  expect(check(root, advanced, '--head', docs).status).toBe(0);
});

test('ordinary PRs allow private version edits and require new libraries to join the current version', () => {
  const { base, root } = repository();
  put(root, 'packages/private/package.json', '{"name":"private","private":true,"version":"9.0.0"}');
  commit(root);
  expect(check(root, base, '--label', 'skip-changelog').status).toBe(0);
  put(root, 'packages/next/package.json', '{"name":"next","version":"0.4.8"}');
  commit(root);
  expect(check(root, base, '--label', 'skip-changelog').stderr).toContain('versions must match');
  put(root, 'packages/next/package.json', '{"name":"next","version":"0.4.7"}');
  commit(root);
  expect(check(root, base, '--label', 'skip-changelog').status).toBe(0);
});

test('the initial empty cut and a narrative round-trip through the compiler', () => {
  const { base, root } = repository('0.0.0');
  const narrativeRoot = mkdtempSync(join(tmpdir(), 'loom-narrative-'));
  roots.push(narrativeRoot);
  const narrative = join(narrativeRoot, 'narrative.md');
  writeFileSync(narrative, 'Start using the typed command API.\n');
  try {
    expect(
      invoke(
        cli,
        ['changelog', 'write', '--initial', '--date', '2026-09-07', '--narrative', narrative],
        { cwd: root },
      ).status,
    ).toBe(0);
  } finally {
    rmSync(narrative);
  }
  commit(root);
  expect(releaseCheck(root, base, '0.1.0').status).toBe(0);
  git(root, 'tag', 'v0.1.0');
  expect(releaseCheck(root, base, '0.1.0').stderr).toContain('Tag v0.1.0 already exists');
});

test.skipIf(process.platform === 'win32')(
  'the Ubuntu workflow checks metadata as data and reruns admission when a label is removed',
  () => {
    const workflow: unknown = parse(
      readFileSync(new URL('../../../.github/workflows/pr.yml', import.meta.url), 'utf8'),
    );
    const config = z
      .object({
        jobs: z.object({
          guards: z.object({
            steps: z.array(z.object({ name: z.string(), run: z.string().optional() })),
          }),
        }),
        on: z.object({ pull_request: z.object({ types: z.array(z.string()) }) }),
        permissions: z.object({ contents: z.literal('read') }).strict(),
      })
      .parse(workflow);
    expect(config.on.pull_request.types).toEqual(
      expect.arrayContaining([
        'opened',
        'reopened',
        'synchronize',
        'edited',
        'labeled',
        'unlabeled',
      ]),
    );
    const script = config.jobs.guards.steps.find(
      (step) => step.name === 'Check PR fragments and versions',
    )?.run;
    if (script === undefined) {
      throw new Error('Missing guard step.');
    }
    const { base, root } = repository();
    put(
      root,
      'package.json',
      JSON.stringify({ name: 'fixture', private: true, scripts: { loom: 'node "$LOOM_PR_CLI"' } }),
    );
    const head = commit(root);
    const env = {
      ...process.env,
      LOOM_PR_CLI: fileURLToPath(cli),
      PR_BASE: base,
      PR_HEAD: head,
      PR_LABELS: JSON.stringify(['skip-changelog']),
      PR_TITLE: 'Fix output $(touch injected) `touch injected` "quoted"',
    };
    const skipped = spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8', env });
    expect(skipped.status).toBe(0);
    expect(skipped.stdout).toContain('PR checks passed.');
    const admitted = spawnSync('bash', ['-c', script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, PR_LABELS: JSON.stringify(['Skip-Changelog']) },
    });
    expect(admitted.status).toBe(1);
    expect(admitted.stderr).toContain('fragment or skip-changelog');
    expect(git(root, 'status', '--porcelain')).toBe('');
  },
);

test('breaking cuts advance the minor and synchronize every library', () => {
  const { root } = repository();
  put(root, 'packages/other/package.json', '{"name":"other","version":"0.4.7"}');
  put(
    root,
    '.changes/breaking.output.md',
    `- Change output.

### Migration

**Affected surface.** Output.

**Why.** Remove ambiguity.

**Before and after.** Replace the old output with the new output.

**Steps.**

1. Update the consumer.

**Validation.** Run the consumer tests.
`,
  );
  const base = commit(root);
  const written = invoke(cli, ['changelog', 'write', '--date', '2026-09-07'], { cwd: root });
  expect(written.status).toBe(0);
  expect(written.stdout).toContain('## v0.5.0 - 2026-09-07');
  commit(root);
  expect(releaseCheck(root, base, '0.5.0').status).toBe(0);
  put(root, 'packages/other/package.json', '{"name":"other","version":"0.4.7"}');
  commit(root);
  expect(releaseCheck(root, base, '0.5.0').stderr).toContain('versions must match');
});

test('a release rejects lockfile changes that the version writer did not produce', () => {
  const { base, root } = repository('0.0.0');
  expect(
    invoke(cli, ['changelog', 'write', '--initial', '--date', '2026-09-07'], { cwd: root }).status,
  ).toBe(0);
  const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  const changed = lockfile.replace('autoInstallPeers: true', 'autoInstallPeers: false');
  expect(changed).not.toBe(lockfile);
  put(root, 'pnpm-lock.yaml', changed);
  commit(root);
  expect(releaseCheck(root, base, '0.1.0')).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('pnpm-lock.yaml must match the version writer'),
  });
});

test('release cuts reject non-version manifest changes and replacement numbers', () => {
  const { root } = repository();
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  expect(invoke(cli, ['changelog', 'write', '--date', '2026-09-07'], { cwd: root }).status).toBe(0);
  const cut = commit(root);
  expect(releaseCheck(root, base, '0.4.9').stderr).toContain(
    'replacement overrides are not supported',
  );
  put(
    root,
    'packages/core/package.json',
    '{"name":"@sample/core","version":"0.4.8","scripts":{"prepack":"echo injected"}}',
  );
  commit(root);
  expect(releaseCheck(root, base, '0.4.8').stderr).toContain('only the version field');
  git(root, 'reset', '--hard', cut);
  put(root, '.changes/left.md', '- Left behind.\n');
  commit(root);
  expect(releaseCheck(root, base, '0.4.8').stderr).toContain('No fragments may remain');
});

test('a release branch must include the current base and ordinary argument errors stay explicit', () => {
  const { root } = repository();
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  expect(invoke(cli, ['changelog', 'write', '--date', '2026-09-07'], { cwd: root }).status).toBe(0);
  const cut = commit(root);
  git(root, 'checkout', '--detach', base);
  put(root, 'docs/guide.md', '# Guide\n');
  const advanced = commit(root);
  git(root, 'checkout', '--detach', cut);
  expect(releaseCheck(root, advanced, '0.4.8').stderr).toContain('include the current base');
  expect(releaseCheck(root, base, '1.0.0').stderr).toContain('Expected release title');
  expect(check(root, base, '--', 'extra').stderr).toContain('Arguments after --');
  expect(invoke(cli, ['pr', 'check'], { cwd: root }).status).toBe(2);
});
