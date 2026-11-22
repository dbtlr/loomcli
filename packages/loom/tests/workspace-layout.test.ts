/*
 * Loom's own release commands, `release cut`, `release plan`, `release record`, and `pr check`, run
 * from the release workspace, the directory that holds `pnpm-workspace.yaml`. Each case runs one
 * scenario twice: once with the workspace at the git root, and once with it in `typescript/` below
 * the root, while `docs/` and `.github/` stay at the root. Both runs expect the same literal cut,
 * verdict, plan, and record, so a layout that changes any of them fails a case.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { commit, put, removeRoots, repository } from './fixture.js';
import { run } from './run.js';
import { startServices, stopServices } from './services.js';

const owner = 'dbtlr/loomcli';
const library = '@sample/core';

afterEach(() => {
  stopServices();
  removeRoots();
});

/** A proposed decision record as the shared decisions folder holds it ahead of its release. */
const proposedRecord = [
  '---',
  'type: adr',
  'title: ADR-0001 - Decision 0001',
  'description: Decision 0001 binds the work.',
  'status: proposed',
  'created: 2026-09-01',
  'modified: 2026-09-02',
  '---',
  '',
  '# ADR-0001 - Decision 0001',
  '',
  '## Context',
  '',
  'The context.',
  '',
  '## Status',
  '',
  'Proposed with the contract.',
  '',
].join('\n');

const acceptedRecord = proposedRecord
  .replace('status: proposed', 'status: accepted')
  .replace('modified: 2026-09-02', 'modified: 2026-09-07')
  .replace('Proposed with the contract.', 'Accepted in 0.4.8.');

const proposedIndex = [
  '# Decision records',
  '',
  '| Record                    | Decision       | Status   |',
  '| ------------------------- | -------------- | -------- |',
  '| [ADR-0001](0001-first.md) | The first one. | proposed |',
  '',
].join('\n');

const acceptedIndex = proposedIndex.replace('| proposed |', '| accepted |');

/** The files of the release workspace, by their path inside it. */
const workspaceFiles = {
  '.changes/README.md': '# Guide\n',
  'CHANGELOG.md': '# Changelog\n\n',
  'package.json': '{"name":"fixture","private":true}\n',
  'packages/core/index.js': 'export const value = 1;\n',
  'packages/core/package.json': `${JSON.stringify({ name: library, version: '0.4.7' })}\n`,
  'packages/loom/package.json': '{"name":"@sample/loom","private":true}\n',
  'packages/loom/skills/loom/SKILL.md':
    "---\nname: loom\ndescription: The authoring skill.\nmetadata:\n  version: '0.4.8'\n---\n\n# Author\n",
  'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
  'tsconfig.json': '{}\n',
};

/** The files that stay at the git root in both layouts. */
const topFiles = {
  'README.md': '# Repository\n',
  'docs/decisions/0001-first.md': proposedRecord,
  'docs/decisions/README.md': proposedIndex,
};

const layouts = [
  { layout: 'at the git root', workspace: '' },
  { layout: 'below the git root', workspace: 'typescript' },
];

/**
 * A repository at 0.4.7 whose release workspace sits at `workspace` below the git root. `top` is the
 * git root, `root` is the workspace directory the commands run in, and `base` is the first commit.
 */
function layoutRepository(workspace: string) {
  const files: Record<string, string> = { ...topFiles };
  for (const [path, body] of Object.entries(workspaceFiles)) {
    files[workspace === '' ? path : `${workspace}/${path}`] = body;
  }
  const { base, root: top } = repository({ files, prefix: 'loom-layout-', tag: 'v0.4.7' });
  return { base, root: join(top, workspace), top };
}

const releaseTitle = 'chore(release): Release v0.4.8 - Fix output';

const section =
  '## v0.4.8 - 2026-09-07\n\n### Fixes\n\n- Fix output.\n\nNo material changes: @sample/core.\n\n';

/**
 * Cuts 0.4.8 from the workspace over a base that carries one fragment, and marks the shared
 * decision accepted, as a release PR does. Returns the base, the cut commit, and the cut's output.
 */
async function releasePullRequest(root: string, top: string) {
  put(root, '.changes/fix.md', '- Fix output.\n');
  const base = commit(top);
  const cut = await run(['release', 'cut', '--date', '2026-09-07'], { cwd: root });
  put(top, 'docs/decisions/0001-first.md', acceptedRecord);
  put(top, 'docs/decisions/README.md', acceptedIndex);
  return { base, cut, head: commit(top) };
}

async function prCheck(root: string, base: string, title: string, ...args: string[]) {
  return await run(['pr', 'check', '--base', base, '--title', title, ...args], { cwd: root });
}

interface Endpoints {
  githubApi: string;
  registry: string;
}

async function plan(root: string, top: string, endpoints: Endpoints) {
  return await run(
    [
      'release',
      'plan',
      '--repository',
      owner,
      '--output',
      join(top, 'plan.json'),
      '--registry',
      endpoints.registry,
      '--github-api',
      endpoints.githubApi,
    ],
    { cwd: root },
  );
}

async function record(root: string, top: string, endpoints: Endpoints) {
  return await run(
    [
      'release',
      'record',
      '--repository',
      owner,
      '--plan',
      join(top, 'plan.json'),
      '--registry',
      endpoints.registry,
      '--github-api',
      endpoints.githubApi,
      '--retry-delay-ms',
      '10',
    ],
    { cwd: root, env: { GH_TOKEN: 'test-token' } },
  );
}

const planSchema = z.object({
  cutCommit: z.string(),
  head: z.string(),
  libraries: z.array(z.object({ directory: z.string(), name: z.string(), published: z.boolean() })),
  notes: z.string(),
  provenanceCommit: z.string().nullable(),
  publish: z.boolean(),
  record: z.boolean(),
  release: z.object({ present: z.boolean() }),
  tag: z.object({ commit: z.string().nullable(), present: z.boolean() }),
  version: z.string(),
});

function planned(top: string) {
  const input: unknown = JSON.parse(readFileSync(join(top, 'plan.json'), 'utf8'));
  return planSchema.parse(input);
}

test.each(layouts)(
  'a release from the workspace $layout gives the same cut, verdict, plan, and record',
  async ({ workspace }) => {
    const { root, top } = layoutRepository(workspace);
    const { base, cut, head } = await releasePullRequest(root, top);
    expect(cut).toEqual({ status: 0, stderr: '', stdout: section });
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(
      `# Changelog\n\n${section.trimEnd()}\n`,
    );
    await expect(prCheck(root, base, releaseTitle)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'PR checks passed.\n',
    });
    const absent = await startServices({ packages: {}, repository: owner, version: '0.4.8' });
    await expect(plan(root, top, absent)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: expect.stringContaining('Publish: yes. Record: yes.'),
    });
    expect(planned(top)).toEqual({
      cutCommit: head,
      head,
      // The workflow passes each directory to `pnpm --dir` from the workspace directory.
      libraries: [{ directory: 'packages/core', name: library, published: false }],
      notes: '### Fixes\n\n- Fix output.\n\nNo material changes: @sample/core.',
      provenanceCommit: null,
      publish: true,
      record: true,
      release: { present: false },
      tag: { commit: null, present: false },
      version: '0.4.8',
    });
    const published = await startServices({
      packages: { [library]: { provenanceCommit: head, published: true, tarball: 'fix bytes' } },
      repository: owner,
      version: '0.4.8',
    });
    await expect(plan(root, top, published)).resolves.toMatchObject({ status: 0, stderr: '' });
    expect(planned(top)).toMatchObject({ provenanceCommit: head, publish: false, record: true });
    await expect(record(root, top, published)).resolves.toMatchObject({ status: 0, stderr: '' });
    await expect(published.writes()).resolves.toMatchObject([
      { body: { object: head, tag: 'v0.4.8' }, method: 'POST' },
      { body: { ref: 'refs/tags/v0.4.8' }, method: 'POST' },
      { body: { name: 'v0.4.8', tag_name: 'v0.4.8' }, method: 'POST' },
      { name: 'sample-core-0.4.8.tgz', size: 9 },
    ]);
  },
);

const fragmentRequired =
  'Build-affecting PRs require an added or modified fragment or skip-changelog.\n';

// Each change names a path in the workspace, or, with `top`, a path at the git root.
const ordinaryChanges = [
  { change: 'docs at the git root', path: 'docs/guide.md', stderr: '', top: true },
  { change: 'the README at the git root', path: 'README.md', stderr: '', top: true },
  {
    change: 'a workflow at the git root',
    path: '.github/workflows/ci.yml',
    stderr: fragmentRequired,
    top: true,
  },
  {
    change: 'a library source',
    path: 'packages/core/index.js',
    stderr: fragmentRequired,
    top: false,
  },
  { change: 'the workspace README', path: 'README.md', stderr: '', top: false },
];

// Every ordinary change in every layout.
const ordinaryCases = layouts.flatMap(({ layout, workspace }) =>
  ordinaryChanges.map(({ change, path, stderr, top }) => ({
    change,
    layout,
    path,
    stderr,
    top,
    workspace,
  })),
);

test.each(ordinaryCases)(
  'pr check from the workspace $layout gives the same verdict on $change without a fragment',
  async ({ path, stderr, top: atTop, workspace }) => {
    const { base, root, top } = layoutRepository(workspace);
    put(atTop ? top : root, path, '# Changed\n');
    commit(top);
    await expect(prCheck(root, base, 'Fix output')).resolves.toEqual(
      stderr === ''
        ? { status: 0, stderr: '', stdout: 'PR checks passed.\n' }
        : { status: 1, stderr, stdout: '' },
    );
    put(root, '.changes/fix.md', '- Fix output.\n');
    commit(top);
    await expect(prCheck(root, base, 'Fix output')).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'PR checks passed.\n',
    });
  },
);

test.each(layouts)(
  'a release PR $layout that edits the shared decision beyond acceptance fails naming it from the workspace',
  async ({ workspace }) => {
    const { root, top } = layoutRepository(workspace);
    const { base } = await releasePullRequest(root, top);
    put(top, 'docs/decisions/0001-first.md', acceptedRecord.replace('The context.', 'New.'));
    commit(top);
    const path = `${workspace === '' ? '' : '../'}docs/decisions/0001-first.md`;
    await expect(prCheck(root, base, releaseTitle)).resolves.toEqual({
      status: 1,
      stderr: `${path}: a release cut changes a decision record only to mark a proposed decision accepted, with status accepted, modified 2026-09-07, and a Status section that reads "Accepted in 0.4.8.". Make any other change in an ordinary PR.\n`,
      stdout: '',
    });
  },
);

test.each(layouts)(
  'release plan $layout refuses a library change after the cut by its workspace path, and publishes after a docs change',
  async ({ workspace }) => {
    const { root, top } = layoutRepository(workspace);
    const { head: cut } = await releasePullRequest(root, top);
    const endpoints = await startServices({ packages: {}, repository: owner, version: '0.4.8' });
    put(top, 'docs/guide.md', '# Guide\n');
    put(top, 'README.md', '# Changed\n');
    const documented = commit(top);
    await expect(plan(root, top, endpoints)).resolves.toMatchObject({ status: 0, stderr: '' });
    expect(planned(top)).toMatchObject({ cutCommit: cut, head: documented, publish: true });
    put(root, 'packages/core/index.js', 'export const value = 2;\n');
    put(root, 'tsconfig.json', '{"changed":true}\n');
    const head = commit(top);
    const result = await plan(root, top, endpoints);
    expect(result).toMatchObject({ status: 1, stdout: '' });
    expect(result.stderr).toContain(
      `packages/core/index.js, tsconfig.json changed between the cut commit ${cut} and the head ${head}.`,
    );
  },
);

const notWorkspace =
  'Run release cut from the workspace directory, the one that holds pnpm-workspace.yaml.\n';

test.each(layouts)(
  'release cut $layout refuses a directory other than the workspace directory and changes nothing',
  async ({ workspace }) => {
    const { root, top } = layoutRepository(workspace);
    put(root, '.changes/fix.md', '- Fix output.\n');
    commit(top);
    const others = [join(root, 'packages/core'), ...(workspace === '' ? [] : [top])];
    for (const cwd of others) {
      for (const mode of [['--dry-run'], []]) {
        await expect(run(['release', 'cut', ...mode], { cwd })).resolves.toEqual({
          status: 1,
          stderr: notWorkspace,
          stdout: '',
        });
      }
    }
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe('# Changelog\n\n');
    expect(readFileSync(join(root, '.changes/fix.md'), 'utf8')).toBe('- Fix output.\n');
  },
);

test.each(layouts)(
  'a release cut dry run $layout reads untracked files across the work tree for the material report',
  async ({ workspace }) => {
    const { root, top } = layoutRepository(workspace);
    put(root, '.changes/fix.md', '- Fix output.\n');
    commit(top);
    const dryRun = async () =>
      await run(['release', 'cut', '--dry-run', '--date', '2026-09-07'], { cwd: root });
    put(top, 'docs/guide.md', '# Guide\n');
    await expect(dryRun()).resolves.toEqual({ status: 0, stderr: '', stdout: section });
    put(top, '.github/workflows/ci.yml', 'name: CI\n');
    await expect(dryRun()).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '## v0.4.8 - 2026-09-07\n\n### Fixes\n\n- Fix output.\n\n',
    });
  },
);
