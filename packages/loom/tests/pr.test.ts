import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';
import { parse } from 'yaml';
import { z } from 'zod';

import { childEnvironment } from '../../../scripts/test-process.js';
import {
  commit,
  git,
  migration,
  put,
  removeRoots,
  repository as fixtureRepository,
  temporaryRoot,
} from './fixture.js';
import { cli } from './package.js';
import { run } from './run.js';

function repository(version = '0.4.7', { tag = true } = {}) {
  return fixtureRepository({
    files: {
      '.changes/README.md': '# Guide\n',
      'CHANGELOG.md': '# Changelog\n\n',
      'package.json': '{"name":"fixture","private":true}',
      'packages/core/index.js': 'export const value = 1;\n',
      'packages/core/package.json': JSON.stringify({ name: '@sample/core', version }),
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    },
    prefix: 'loom-pr-',
    tag: tag && version !== '0.0.0' ? `v${version}` : undefined,
  });
}

async function check(root: string, base: string, ...args: string[]) {
  return await run(['pr', 'check', '--base', base, '--title', 'Fix output', ...args], {
    cwd: root,
  });
}

afterEach(() => {
  removeRoots();
});

const narrativeProse = 'Start using the typed command API.';

// An initial cut consumes no fragments, so its notes come from a narrative kept outside the checkout.
async function writeInitialRelease(root: string) {
  const narrative = join(temporaryRoot('loom-narrative-'), 'narrative.md');
  writeFileSync(narrative, `${narrativeProse}\n`);
  return await run(
    ['release', 'cut', '--initial', '--date', '2026-09-07', '--narrative', narrative],
    { cwd: root },
  );
}

async function releaseCheck(root: string, base: string, version: string) {
  return await run(
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

test('a compiler-written release passes and unrelated code cannot enter the release cut', async () => {
  const { root } = repository();
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  const runResult = await run(['release', 'cut', '--date', '2026-09-07'], { cwd: root });
  expect(runResult.status).toBe(0);
  commit(root);
  await expect(releaseCheck(root, base, '0.4.8')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'PR checks passed.\n',
  });
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  commit(root);
  await expect(releaseCheck(root, base, '0.4.8')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('outside the release cut'),
  });
});

// The lockfile check copies every tracked file at the base, and a reference document can pass 1 MiB.
test('a release check reads a tracked file larger than a mebibyte at the base', async () => {
  const { root } = repository();
  put(root, 'docs/reference.md', 'A line of reference prose.\n'.repeat(80_000));
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  const runResult = await run(['release', 'cut', '--date', '2026-09-07'], { cwd: root });
  expect(runResult.status).toBe(0);
  commit(root);
  await expect(releaseCheck(root, base, '0.4.8')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'PR checks passed.\n',
  });
});

test('a feature-only explicit target passes admission with synchronized manifests and lockfile', async () => {
  const { root } = repository('0.12.0');
  put(root, '.changes/feature.input.md', '- Add typed input.\n');
  put(
    root,
    'packages/adapter/package.json',
    JSON.stringify({
      dependencies: { '@sample/core': 'workspace:*' },
      name: '@sample/adapter',
      version: '0.12.0',
    }),
  );
  const base = commit(root);
  await expect(
    run(['release', 'cut', '--target', '0.13.0', '--date', '2026-10-15'], { cwd: root }),
  ).resolves.toMatchObject({ status: 0, stderr: '' });
  commit(root);
  await expect(releaseCheck(root, base, '0.13.0')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'PR checks passed.\n',
  });
  expect(readFileSync(join(root, 'packages/adapter/package.json'), 'utf8')).toContain(
    '"version":"0.13.0"',
  );
  expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toContain('specifier: workspace:*');
  await expect(releaseCheck(root, base, '0.14.0')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('Every participating library must carry title version'),
  });
});

test('release admission rejects a target below the breaking-fragment minimum', async () => {
  const { root } = repository('0.12.0');
  put(root, '.changes/breaking.input.md', migration);
  const base = commit(root);
  const runResult = await run(['release', 'cut', '--target', '0.13.0'], { cwd: root });
  expect(runResult.status).toBe(0);
  put(
    root,
    'packages/core/package.json',
    JSON.stringify({ name: '@sample/core', version: '0.12.1' }),
  );
  put(
    root,
    'CHANGELOG.md',
    readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replace('v0.13.0', 'v0.12.1'),
  );
  commit(root);
  await expect(releaseCheck(root, base, '0.12.1')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('at least 0.13.0'),
  });
});

// A proposed decision record as the decisions directory holds it ahead of the release that ships it.
function proposedRecord(number: string) {
  return [
    '---',
    'type: adr',
    `title: ADR-${number} - Decision ${number}`,
    `description: Decision ${number} binds the work.`,
    'status: proposed',
    'created: 2026-09-01',
    'modified: 2026-09-02',
    '---',
    '',
    `# ADR-${number} - Decision ${number}`,
    '',
    '## Context',
    '',
    'The context.',
    '',
    '## Status',
    '',
    'Proposed with the contract. It moves to accepted in the release PR that ships it.',
    '',
    '## Changelog',
    '',
    '- 2026-09-01: Proposed.',
    '',
  ].join('\n');
}

const decisionIndex = [
  '# Decision records',
  '',
  '| Record                       | Decision       | Status   |',
  '| ---------------------------- | -------------- | -------- |',
  '| [ADR-0001](0001-first.md)    | The first one. | proposed |',
  '| [ADR-0002](0002-second.md)   | The second.    | proposed |',
  '| [ADR-0003](0003-third.md)    | The third.     | proposed |',
  '',
  'ADR-0002 narrows ADR-0001.',
  '',
].join('\n');

// Decision 0003 ends with its Status section, as a record with no Changelog entries does.
const proposedThird = proposedRecord('0003').split('\n## Changelog')[0] ?? '';

// A cut at 0.4.8, dated 2026-09-07, over a base that holds three proposed decisions.
async function decisionCut(first = proposedRecord('0001'), index = decisionIndex) {
  const { root } = repository();
  put(root, 'docs/decisions/0001-first.md', first);
  put(root, 'docs/decisions/0002-second.md', proposedRecord('0002'));
  put(root, 'docs/decisions/0003-third.md', proposedThird);
  put(root, 'docs/decisions/README.md', index);
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  const runResult = await run(['release', 'cut', '--date', '2026-09-07'], { cwd: root });
  expect(runResult.status).toBe(0);
  return { base, root };
}

// The record a release cut writes when it marks decision 0001 accepted.
const acceptedFirst = proposedRecord('0001')
  .replace('status: proposed', 'status: accepted')
  .replace('modified: 2026-09-02', 'modified: 2026-09-07')
  .replace(
    'Proposed with the contract. It moves to accepted in the release PR that ships it.',
    'Accepted in 0.4.8.',
  );

const acceptedFirstIndex = decisionIndex.replace(
  '| The first one. | proposed |',
  '| The first one. | accepted |',
);

test('a release cut may mark shipped decisions accepted and leave another proposed', async () => {
  const { base, root } = await decisionCut();
  put(root, 'docs/decisions/0001-first.md', acceptedFirst);
  put(
    root,
    'docs/decisions/0003-third.md',
    proposedThird
      .replace('status: proposed', 'status: accepted')
      .replace('modified: 2026-09-02', 'modified: 2026-09-07')
      .replace(
        'Proposed with the contract. It moves to accepted in the release PR that ships it.',
        'Accepted in 0.4.8.',
      ),
  );
  put(
    root,
    'docs/decisions/README.md',
    acceptedFirstIndex.replace('| The third.     | proposed |', '| The third.     | accepted |'),
  );
  commit(root);
  await expect(releaseCheck(root, base, '0.4.8')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'PR checks passed.\n',
  });
});

test.each([
  {
    edit: 'its context',
    files: {
      'docs/decisions/0001-first.md': acceptedFirst.replace('The context.', 'New context.'),
    },
  },
  {
    edit: 'a changelog entry',
    files: { 'docs/decisions/0001-first.md': `${acceptedFirst}- 2026-09-07: Accepted.\n` },
  },
  {
    edit: 'a Status section without the release',
    files: {
      'docs/decisions/0001-first.md': acceptedFirst.replace('Accepted in 0.4.8.', 'Accepted.'),
    },
  },
  {
    edit: 'a modified date other than the release date',
    files: {
      'docs/decisions/0001-first.md': acceptedFirst.replace(
        'modified: 2026-09-07',
        'modified: 2026-09-08',
      ),
    },
  },
  {
    edit: 'another proposed record',
    files: {
      'docs/decisions/0002-second.md': proposedRecord('0002').replace('The context.', 'New.'),
    },
  },
  { edit: 'a new record', files: { 'docs/decisions/0004-fourth.md': proposedRecord('0004') } },
])('a release cut that changes $edit fails naming the record', async ({ files }) => {
  const { base, root } = await decisionCut();
  put(root, 'docs/decisions/0001-first.md', acceptedFirst);
  put(root, 'docs/decisions/README.md', acceptedFirstIndex);
  for (const [path, body] of Object.entries(files)) {
    put(root, path, body);
  }
  commit(root);
  await expect(releaseCheck(root, base, '0.4.8')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining(
      `${Object.keys(files)[0]}: a release cut changes a decision record only to mark a proposed decision accepted`,
    ),
  });
});

test('a release cut replaces the whole Status section, subsections included', async () => {
  const evidence = '\n### Evidence\n\nThe acceptance run.\n';
  const { base, root } = await decisionCut(
    proposedRecord('0001').replace('ships it.\n', `ships it.\n${evidence}`),
  );
  put(
    root,
    'docs/decisions/0001-first.md',
    acceptedFirst.replace('Accepted in 0.4.8.\n', `Accepted in 0.4.8.\n${evidence}`),
  );
  put(root, 'docs/decisions/README.md', acceptedFirstIndex);
  commit(root);
  const runResult = await releaseCheck(root, base, '0.4.8');
  expect(runResult.stderr).toContain(
    'docs/decisions/0001-first.md: a release cut changes a decision record only',
  );
  put(root, 'docs/decisions/0001-first.md', acceptedFirst);
  commit(root);
  const runResult2 = await releaseCheck(root, base, '0.4.8');
  expect(runResult2.status).toBe(0);
});

test('a record with two Status sections cannot be accepted', async () => {
  const { base, root } = await decisionCut(
    proposedRecord('0001').replace('## Changelog', '## Status\n\nAgain.\n\n## Changelog'),
  );
  put(
    root,
    'docs/decisions/0001-first.md',
    acceptedFirst.replace('## Changelog', '## Status\n\nAgain.\n\n## Changelog'),
  );
  put(root, 'docs/decisions/README.md', acceptedFirstIndex);
  commit(root);
  const runResult = await releaseCheck(root, base, '0.4.8');
  expect(runResult.stderr).toContain(
    'docs/decisions/0001-first.md: a release cut changes a decision record only',
  );
});

test.each([
  {
    index: decisionIndex.replace(
      '| [ADR-0002]',
      '| [ADR-0001](0001-first.md)    | The first one. | proposed |\n| [ADR-0002]',
    ),
    shape: 'two rows',
  },
  { index: acceptedFirstIndex, shape: 'a row that already reads accepted' },
])('a record whose index has $shape cannot be accepted', async ({ index }) => {
  const { base, root } = await decisionCut(proposedRecord('0001'), index);
  put(root, 'docs/decisions/0001-first.md', acceptedFirst);
  put(
    root,
    'docs/decisions/README.md',
    index.replace('| The first one. | proposed |', '| The first one. | accepted |'),
  );
  commit(root);
  const runResult = await releaseCheck(root, base, '0.4.8');
  expect(runResult.stderr).toContain(
    'docs/decisions/README.md: a release cut changes the decision index only',
  );
});

test('a release cut that deletes a record fails naming the record', async () => {
  const { base, root } = await decisionCut();
  rmSync(join(root, 'docs/decisions/0002-second.md'));
  commit(root);
  const runResult = await releaseCheck(root, base, '0.4.8');
  expect(runResult.stderr).toContain(
    'docs/decisions/0002-second.md: a release cut changes a decision record only',
  );
});

test.each([
  { edit: 'leaves the accepted row proposed', index: decisionIndex },
  {
    edit: 'marks a row it does not accept',
    index: acceptedFirstIndex.replace(
      '| The second.    | proposed |',
      '| The second.    | accepted |',
    ),
  },
  {
    edit: 'edits the index prose',
    index: acceptedFirstIndex.replace('ADR-0002 narrows', 'ADR-0002, proposed, narrows'),
  },
])('a release cut that $edit fails naming the index', async ({ index }) => {
  const { base, root } = await decisionCut();
  put(root, 'docs/decisions/0001-first.md', acceptedFirst);
  put(root, 'docs/decisions/README.md', index);
  commit(root);
  await expect(releaseCheck(root, base, '0.4.8')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining(
      'docs/decisions/README.md: a release cut changes the decision index only',
    ),
  });
});

test('a release cut that changes only the index fails naming the index', async () => {
  const { base, root } = await decisionCut();
  put(root, 'docs/decisions/README.md', acceptedFirstIndex);
  commit(root);
  const runResult = await releaseCheck(root, base, '0.4.8');
  expect(runResult.stderr).toContain(
    'docs/decisions/README.md: a release cut changes the decision index only',
  );
});

test('a release check derives the material baseline at the base without a tag', async () => {
  const { root } = repository('0.4.7', { tag: false });
  put(
    root,
    'packages/core/package.json',
    JSON.stringify({ name: '@sample/core', version: '0.5.0' }),
  );
  put(root, 'packages/other/package.json', JSON.stringify({ name: 'other', version: '0.5.0' }));
  commit(root);
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  const written = await run(['release', 'cut', '--date', '2026-09-07'], { cwd: root });
  expect(written.status).toBe(0);
  expect(written.stdout).toContain('No material changes: other.\n');
  commit(root);
  await expect(releaseCheck(root, base, '0.5.1')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'PR checks passed.\n',
  });
});

test('build-affecting PRs require a changed fragment or skip label', async () => {
  const { base, root } = repository();
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  commit(root);
  await expect(check(root, base)).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('fragment or skip-changelog'),
  });
  await expect(check(root, base, '--label', 'skip-changelog')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'PR checks passed.\n',
  });
  put(root, '.changes/fix.md', '- Fix output.\n');
  commit(root);
  await expect(check(root, base)).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'PR checks passed.\n',
  });
});

test('ordinary PRs cannot bump a library, even with skip-changelog or by making it private', async () => {
  const { base, root } = repository();
  put(root, 'packages/core/package.json', '{"name":"@sample/core","version":"0.4.8"}');
  commit(root);
  await expect(check(root, base, '--label', 'skip-changelog')).resolves.toMatchObject({
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
  await expect(check(root, base, '--label', 'skip-changelog')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('version must stay 0.4.7'),
  });
});

test('release validation checks generated entries and preserves earlier changelog history', async () => {
  const { root } = repository();
  put(
    root,
    'CHANGELOG.md',
    '# Changelog\n\n## v0.4.7 - 2026-01-01\n\n### Changes\n\n- Earlier result.\n\n',
  );
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  const runResult = await run(['release', 'cut', '--date', '2026-09-07'], { cwd: root });
  expect(runResult.status).toBe(0);
  const expected = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  put(root, 'CHANGELOG.md', expected.replace('- Fix output.', '- Something else.'));
  commit(root);
  await expect(releaseCheck(root, base, '0.4.8')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('CHANGELOG.md'),
  });
  put(root, 'CHANGELOG.md', expected.replace('- Earlier result.', '- Rewritten history.'));
  commit(root);
  await expect(releaseCheck(root, base, '0.4.8')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('CHANGELOG.md'),
  });
  put(root, 'CHANGELOG.md', expected);
  commit(root);
  const runResult2 = await releaseCheck(root, base, '0.4.8');
  expect(runResult2.status).toBe(0);
});

test('a release cannot delete its lockfile or change a manifest file mode', async () => {
  const { root } = repository('0.0.0');
  const base = git(root, ['rev-parse', 'HEAD']);
  const runResult = await writeInitialRelease(root);
  expect(runResult.status).toBe(0);
  const cut = commit(root);
  rmSync(join(root, 'pnpm-lock.yaml'));
  commit(root);
  await expect(releaseCheck(root, base, '0.1.0')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('pnpm-lock.yaml'),
  });
  git(root, ['reset', '--hard', cut]);
  git(root, ['update-index', '--chmod=+x', 'packages/core/package.json']);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'mode']);
  await expect(releaseCheck(root, base, '0.1.0')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('file mode'),
  });
});

test('PR checks refuse shallow history', async () => {
  const { base, root } = repository();
  put(root, 'docs/guide.md', '# Guide\n');
  commit(root);
  const clone = join(root, 'shallow');
  git(root, ['clone', '--depth=1', '--no-local', root, clone]);
  await expect(check(clone, base)).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('full Git history'),
  });
});

test.each(['docs/guide.md', 'README.md'])(
  'documentation path %s needs no fragment',
  async (path) => {
    const { base, root } = repository();
    put(root, path, '# Guide\n');
    commit(root);
    const runResult = await check(root, base);
    expect(runResult.status).toBe(0);
  },
);

test('an old untouched fragment and a guide edit do not satisfy admission; a correction does', async () => {
  const { root } = repository();
  put(root, '.changes/old.md', '- Add old output.\n');
  const base = commit(root);
  put(root, '.changes/README.md', '# Revised guide\n');
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  commit(root);
  const runResult = await check(root, base);
  expect(runResult.stderr).toContain('fragment or skip-changelog');
  put(root, '.changes/old.md', '- Add corrected output.\n');
  commit(root);
  const runResult2 = await check(root, base);
  expect(runResult2.status).toBe(0);
});

test('skip never excuses an invalid fragment already at head', async () => {
  const { root } = repository();
  put(root, '.changes/breaking.invalid.md', '- Break output without migration.\n');
  const base = commit(root);
  put(root, 'docs/guide.md', '# Guide\n');
  commit(root);
  await expect(check(root, base, '--label', 'skip-changelog')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('Migration'),
  });
});

test('comparison uses committed head content and excludes changes from the base branch', async () => {
  const { base, root } = repository();
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  const feature = commit(root);
  put(root, '.changes/local.md', '- Uncommitted output.\n');
  const runResult = await check(root, base, '--head', feature);
  expect(runResult.stderr).toContain('fragment or skip-changelog');
  rmSync(join(root, '.changes/local.md'));
  git(root, ['checkout', '--detach', base]);
  put(root, '.changes/base.md', '- A different feature.\n');
  const advanced = commit(root);
  const runResult2 = await check(root, advanced, '--head', feature);
  expect(runResult2.stderr).toContain('fragment or skip-changelog');
  git(root, ['checkout', '--detach', base]);
  put(root, 'docs/guide.md', '# Guide\n');
  const docs = commit(root);
  const runResult3 = await check(root, advanced, '--head', docs);
  expect(runResult3.status).toBe(0);
});

test('ordinary PRs allow private version edits and require new libraries to join the current version', async () => {
  const { base, root } = repository();
  put(root, 'packages/private/package.json', '{"name":"private","private":true,"version":"9.0.0"}');
  commit(root);
  const runResult = await check(root, base, '--label', 'skip-changelog');
  expect(runResult.status).toBe(0);
  put(root, 'packages/next/package.json', '{"name":"next","version":"0.4.8"}');
  commit(root);
  const runResult2 = await check(root, base, '--label', 'skip-changelog');
  expect(runResult2.stderr).toContain('versions must match');
  put(root, 'packages/next/package.json', '{"name":"next","version":"0.4.7"}');
  commit(root);
  const runResult3 = await check(root, base, '--label', 'skip-changelog');
  expect(runResult3.status).toBe(0);
});

test('the initial empty cut and a narrative round-trip through the compiler', async () => {
  const { base, root } = repository('0.0.0');
  const runResult = await writeInitialRelease(root);
  expect(runResult.status).toBe(0);
  commit(root);
  const runResult2 = await releaseCheck(root, base, '0.1.0');
  expect(runResult2.status).toBe(0);
  git(root, ['tag', 'v0.1.0']);
  const runResult3 = await releaseCheck(root, base, '0.1.0');
  expect(runResult3.stderr).toContain('Tag v0.1.0 already exists');
});

test('an initial cut whose section lost its narrative carries no notes and fails', async () => {
  const { base, root } = repository('0.0.0');
  const runResult = await writeInitialRelease(root);
  expect(runResult.status).toBe(0);
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  put(root, 'CHANGELOG.md', changelog.replace(`\n${narrativeProse}\n`, ''));
  commit(root);
  const runResult2 = await releaseCheck(root, base, '0.1.0');
  expect(runResult2.stderr).toContain('requires a narrative');
});

test('the Ubuntu workflow checks metadata as data and reruns admission when a label is removed', () => {
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
    expect.arrayContaining(['opened', 'reopened', 'synchronize', 'edited', 'labeled', 'unlabeled']),
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
    ...childEnvironment(undefined),
    LOOM_PR_CLI: cli,
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
  expect(git(root, ['status', '--porcelain'])).toBe('');
});

test('breaking cuts advance the minor and synchronize every library', async () => {
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
  const written = await run(['release', 'cut', '--date', '2026-09-07'], { cwd: root });
  expect(written.status).toBe(0);
  expect(written.stdout).toContain('## v0.5.0 - 2026-09-07');
  commit(root);
  const runResult = await releaseCheck(root, base, '0.5.0');
  expect(runResult.status).toBe(0);
  put(root, 'packages/other/package.json', '{"name":"other","version":"0.4.7"}');
  commit(root);
  const runResult2 = await releaseCheck(root, base, '0.5.0');
  expect(runResult2.stderr).toContain('versions must match');
});

test('a release rejects lockfile changes that the version writer did not produce', async () => {
  const { base, root } = repository('0.0.0');
  const runResult = await writeInitialRelease(root);
  expect(runResult.status).toBe(0);
  const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  const changed = lockfile.replace('autoInstallPeers: true', 'autoInstallPeers: false');
  expect(changed).not.toBe(lockfile);
  put(root, 'pnpm-lock.yaml', changed);
  commit(root);
  await expect(releaseCheck(root, base, '0.1.0')).resolves.toMatchObject({
    status: 1,
    stderr: expect.stringContaining('pnpm-lock.yaml must match the version writer'),
  });
});

test('release cuts reject non-version manifest changes and mismatched title versions', async () => {
  const { root } = repository();
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  const runResult = await run(['release', 'cut', '--date', '2026-09-07'], { cwd: root });
  expect(runResult.status).toBe(0);
  const cut = commit(root);
  const runResult2 = await releaseCheck(root, base, '0.4.9');
  expect(runResult2.stderr).toContain('Every participating library must carry title version');
  put(
    root,
    'packages/core/package.json',
    '{"name":"@sample/core","version":"0.4.8","scripts":{"prepack":"echo injected"}}',
  );
  commit(root);
  const runResult3 = await releaseCheck(root, base, '0.4.8');
  expect(runResult3.stderr).toContain('only the version field');
  git(root, ['reset', '--hard', cut]);
  put(root, '.changes/left.md', '- Left behind.\n');
  commit(root);
  const runResult4 = await releaseCheck(root, base, '0.4.8');
  expect(runResult4.stderr).toContain('No fragments may remain');
});

test('a release branch must include the current base and ordinary argument errors stay explicit', async () => {
  const { root } = repository();
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(root);
  const runResult = await run(['release', 'cut', '--date', '2026-09-07'], { cwd: root });
  expect(runResult.status).toBe(0);
  const cut = commit(root);
  git(root, ['checkout', '--detach', base]);
  put(root, 'docs/guide.md', '# Guide\n');
  const advanced = commit(root);
  git(root, ['checkout', '--detach', cut]);
  const runResult2 = await releaseCheck(root, advanced, '0.4.8');
  expect(runResult2.stderr).toContain('include the current base');
  const runResult3 = await releaseCheck(root, base, '1.0.0');
  expect(runResult3.stderr).toContain('Expected release title');
  const runResult4 = await check(root, base, '--', 'extra');
  expect(runResult4.stderr).toContain('Arguments after --');
  const runResult5 = await run(['pr', 'check'], { cwd: root });
  expect(runResult5.status).toBe(2);
});

test('a committed hidden entry in .changes/ is ignored, neither rejected nor counted as a fragment', async () => {
  const { base, root } = repository();
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  put(root, '.changes/.DS_Store', '\u0000binary');
  put(root, '.changes/.output.md', '- Fix output.\n');
  commit(root);
  const runResult = await check(root, base);
  expect(runResult.stderr).toContain('fragment or skip-changelog');
  put(root, '.changes/output.md', '- Fix output.\n');
  commit(root);
  await expect(check(root, base)).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'PR checks passed.\n',
  });
});
