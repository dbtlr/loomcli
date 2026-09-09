import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { sharedBuildInputs } from '../src/helpers/release-plan.js';
import { commit, git, put, removeRoots, repository, temporaryRoot } from './fixture.js';
import { startServices, stopServices } from './services.js';
import type { PackageState } from './services.js';

const cli = new URL('../dist/main.js', import.meta.url);
const owner = 'dbtlr/loomcli';
const library = '@sample/core';
const notes = '### Changes\n\n- Fix output.';

afterEach(() => {
  stopServices();
  removeRoots();
});

function manifest(version: string) {
  return `${JSON.stringify({ name: library, version }, null, 2)}\n`;
}

function section(version: string, body: string) {
  return `## v${version} - 2026-09-07\n\n${body}\n`;
}

const earlierSection = section('0.1.0', '### Changes\n\n- Add output.');

function changelogFile(sections: string[]) {
  return `---\ndescription: Releases.\n---\n\n# Changelog\n\nExisting introduction.\n\n${sections.join('\n')}`;
}

function baseRepository() {
  return repository({
    files: {
      'CHANGELOG.md': changelogFile([earlierSection]),
      'package.json': '{"name":"fixture","private":true}\n',
      'packages/core/index.js': 'export const value = 1;\n',
      'packages/core/package.json': manifest('0.1.0'),
      'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'tsconfig.json': '{}\n',
    },
    prefix: 'loom-release-',
  }).root;
}

// A release cut sets the version in every participating manifest and adds the changelog section.
function cutRelease(root: string, version: string, sections = [section(version, notes)]) {
  put(root, 'packages/core/package.json', manifest(version));
  put(root, 'CHANGELOG.md', changelogFile([...sections, earlierSection]));
  return commit(root);
}

function releaseRepository(version = '0.2.0', sections?: string[]) {
  const root = baseRepository();
  const cut = cutRelease(root, version, sections);
  return { cut, root };
}

const planSchema = z.object({
  cutCommit: z.string(),
  head: z.string(),
  libraries: z.array(z.object({ directory: z.string(), name: z.string(), published: z.boolean() })),
  notes: z.string(),
  publish: z.boolean(),
  record: z.boolean(),
  release: z.object({ id: z.number().nullable(), present: z.boolean() }),
  tag: z.object({ commit: z.string().nullable(), present: z.boolean() }),
  version: z.string(),
});

interface Endpoints {
  githubApi: string;
  registry: string;
}

function planned(root: string) {
  const input: unknown = JSON.parse(readFileSync(join(root, 'plan.json'), 'utf8'));
  return planSchema.parse(input);
}

function plan(root: string, endpoints: Endpoints, ...args: string[]) {
  return invoke(
    cli,
    [
      'release',
      'plan',
      '--repository',
      owner,
      '--output',
      join(root, 'plan.json'),
      '--registry',
      endpoints.registry,
      '--github-api',
      endpoints.githubApi,
      ...args,
    ],
    { cwd: root },
  );
}

test('a version on the registry, the tag, and the Release leaves nothing to do', async () => {
  const { cut, root } = releaseRepository();
  const endpoints = await startServices({
    packages: { [library]: { published: true } },
    release: { assets: [], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: cut },
    version: '0.2.0',
  });
  const result = plan(root, endpoints);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(planned(root)).toEqual({
    cutCommit: cut,
    head: cut,
    libraries: [{ directory: 'packages/core', name: library, published: true }],
    notes,
    publish: false,
    record: false,
    release: { id: 900, present: true },
    tag: { commit: cut, present: true },
    version: '0.2.0',
  });
  expect(result.stdout).toContain('Publish: no. Record: no.');
});

test('a version absent from the registry plans publication and recording', async () => {
  const { cut, root } = releaseRepository();
  const endpoints = await startServices({
    packages: {},
    repository: owner,
    version: '0.2.0',
  });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({
    cutCommit: cut,
    libraries: [{ name: library, published: false }],
    publish: true,
    record: true,
    release: { id: null, present: false },
    tag: { commit: null, present: false },
  });
});

test('a published version without a tag plans recording alone', async () => {
  const { root } = releaseRepository();
  const endpoints = await startServices({
    packages: { [library]: { published: true } },
    repository: owner,
    version: '0.2.0',
  });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({ publish: false, record: true });
});

test('a published and tagged version without a Release plans recording', async () => {
  const { cut, root } = releaseRepository();
  const endpoints = await startServices({
    packages: { [library]: { published: true } },
    repository: owner,
    tag: { annotated: false, commit: cut },
    version: '0.2.0',
  });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({
    publish: false,
    record: true,
    release: { present: false },
    tag: { commit: cut, present: true },
  });
});

test('an unpublished version whose tag names another commit is abandoned', async () => {
  const { root } = releaseRepository();
  const endpoints = await startServices({
    packages: {},
    repository: owner,
    tag: { annotated: true, commit: '1111111111111111111111111111111111111111' },
    version: '0.2.0',
  });
  const result = plan(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('1111111111111111111111111111111111111111');
  expect(result.stderr).toContain('abandoned as unpublished');
});

test('an unpublished version whose tag names the head still publishes', async () => {
  const { cut, root } = releaseRepository();
  const endpoints = await startServices({
    packages: {},
    repository: owner,
    tag: { annotated: true, commit: cut },
    version: '0.2.0',
  });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({ publish: true, record: true, tag: { present: true } });
});

test('a missing changelog section fails', async () => {
  const { root } = releaseRepository('0.2.0', []);
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  const result = plan(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('CHANGELOG.md');
  expect(result.stderr).toContain('v0.2.0');
});

test('an empty changelog section fails', async () => {
  const { root } = releaseRepository('0.2.0', [section('0.2.0', '')]);
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  const result = plan(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('CHANGELOG.md');
});

test.each([
  ['only a subheading', '### Changes'],
  ['only a thematic break', '---'],
  ['only an HTML comment', '<!-- nothing to say -->'],
])('a changelog section carrying %s fails', async (_label, body) => {
  const { root } = releaseRepository('0.2.0', [section('0.2.0', body)]);
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  const result = plan(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('CHANGELOG.md');
  expect(result.stderr).toContain('v0.2.0');
});

test('a changelog section carrying one list item is accepted', async () => {
  const { root } = releaseRepository('0.2.0', [section('0.2.0', '- Fix output.')]);
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({ notes: '- Fix output.' });
});

test('a heading that mentions the version in prose is not the release section', async () => {
  const prose = section('0.2.0', notes).replace('## v0.2.0 - 2026-09-07', '## Upgrading to v0.2.0');
  const { root } = releaseRepository('0.2.0', [prose, section('0.2.0', '- The real notes.')]);
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({ notes: '- The real notes.' });
});

test('a library change after the cut commit refuses publication', async () => {
  const { cut, root } = releaseRepository();
  put(root, 'packages/core/index.js', 'export const value = 2;\n');
  const head = commit(root);
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  const result = plan(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('packages/core/index.js');
  expect(result.stderr).toContain(cut);
  expect(result.stderr).toContain(head);
  expect(result.stderr).toContain('abandoned as unpublished');
});

test.each(sharedBuildInputs)(
  'a change to %s after the cut commit refuses publication',
  async (path) => {
    const { cut, root } = releaseRepository();
    put(root, path, path.endsWith('.json') ? '{"changed":true}\n' : '# changed\n');
    const head = commit(root);
    const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
    const result = plan(root, endpoints);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(path);
    expect(result.stderr).toContain(cut);
    expect(result.stderr).toContain(head);
    expect(result.stderr).toContain('abandoned as unpublished');
  },
);

test('a version set, reverted, and set again takes the newest setter as the cut commit', async () => {
  const root = baseRepository();
  cutRelease(root, '0.2.0');
  cutRelease(root, '0.1.0', []);
  const cut = cutRelease(root, '0.2.0');
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({ cutCommit: cut, head: cut });
});

test('documentation changes after the cut commit still publish', async () => {
  const { cut, root } = releaseRepository();
  put(root, 'docs/guide.md', '# Guide\n');
  put(root, 'README.md', '# Fixture\n');
  const head = commit(root);
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({ cutCommit: cut, head, publish: true });
});

test('a version set on a merge commit resolves that merge as the cut commit', async () => {
  const root = baseRepository();
  const trunk = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  git(root, ['switch', '-q', '-c', 'cut']);
  cutRelease(root, '0.2.0');
  git(root, ['switch', '-q', trunk]);
  git(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'merge',
    '-q',
    '--no-ff',
    '--no-edit',
    'cut',
  ]);
  const merge = git(root, ['rev-parse', 'HEAD']);
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({ cutCommit: merge, head: merge, publish: true });
});

test('a shallow checkout refuses to plan', async () => {
  const { root } = releaseRepository();
  const shallow = join(temporaryRoot('loom-shallow-'), 'clone');
  git(root, ['clone', '-q', '--depth', '1', `file://${root}`, shallow]);
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  const result = plan(shallow, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Release preparation requires full Git history.');
});

test('an explicit head plans the version that commit carries', async () => {
  const { cut, root } = releaseRepository();
  cutRelease(root, '0.3.0');
  const endpoints = await startServices({ packages: {}, repository: owner, version: '0.2.0' });
  expect(plan(root, endpoints, '--head', cut).status).toBe(0);
  expect(planned(root)).toMatchObject({ cutCommit: cut, head: cut, version: '0.2.0' });
});

const source = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';
const elsewhere = '1111111111111111111111111111111111111111';
const tarball = 'core tarball bytes';
const asset = 'sample-core-0.2.0.tgz';

function writePlan(root: string) {
  writeFileSync(
    join(root, 'plan.json'),
    JSON.stringify({
      cutCommit: source,
      head: source,
      libraries: [{ directory: 'packages/core', name: library, published: false }],
      notes,
      publish: true,
      record: true,
      release: { id: null, present: false },
      tag: { commit: null, present: false },
      version: '0.2.0',
    }),
  );
  return root;
}

function record(
  root: string,
  endpoints: Endpoints,
  options: { token: string | undefined } = { token: 'test-token' },
) {
  return invoke(
    cli,
    [
      'release',
      'record',
      '--repository',
      owner,
      '--plan',
      join(root, 'plan.json'),
      '--registry',
      endpoints.registry,
      '--github-api',
      endpoints.githubApi,
      '--retry-delay-ms',
      '10',
    ],
    { cwd: root, env: { GH_TOKEN: options.token } },
  );
}

function publishedPackage(overrides: Partial<PackageState> = {}) {
  return {
    [library]: { provenanceCommit: source, published: true, tarball, ...overrides },
  };
}

test('an absent tag and Release are created at the provenance commit with the notes and the asset', async () => {
  const root = writePlan(temporaryRoot('loom-record-'));
  const endpoints = await startServices({
    packages: publishedPackage(),
    repository: owner,
    version: '0.2.0',
  });
  expect(record(root, endpoints)).toMatchObject({ status: 0, stderr: '' });
  await expect(endpoints.writes()).resolves.toMatchObject([
    { body: { message: 'v0.2.0', object: source, tag: 'v0.2.0', type: 'commit' }, method: 'POST' },
    { body: { ref: 'refs/tags/v0.2.0', sha: `tagobject-${source}` }, method: 'POST' },
    {
      body: { body: notes, draft: false, name: 'v0.2.0', prerelease: false, tag_name: 'v0.2.0' },
      method: 'POST',
    },
    { contentType: 'application/gzip', name: asset, size: tarball.length },
  ]);
});

test('a tag already at the provenance commit is reused without a tag write', async () => {
  const root = writePlan(temporaryRoot('loom-record-'));
  const endpoints = await startServices({
    packages: publishedPackage(),
    repository: owner,
    tag: { annotated: true, commit: source },
    version: '0.2.0',
  });
  expect(record(root, endpoints).status).toBe(0);
  const writes = await endpoints.writes();
  expect(writes.filter((write) => write.path.includes('/git/'))).toEqual([]);
  expect(writes).toHaveLength(2);
});

test('a tag at another commit fails before any write', async () => {
  const root = writePlan(temporaryRoot('loom-record-'));
  const endpoints = await startServices({
    packages: publishedPackage(),
    repository: owner,
    tag: { annotated: true, commit: elsewhere },
    version: '0.2.0',
  });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(elsewhere);
  expect(result.stderr).toContain(source);
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('an empty placeholder asset is deleted and uploaded again', async () => {
  const root = writePlan(temporaryRoot('loom-record-'));
  const endpoints = await startServices({
    packages: publishedPackage(),
    release: { assets: [{ id: 11, name: asset, size: 0 }], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: source },
    version: '0.2.0',
  });
  expect(record(root, endpoints).status).toBe(0);
  await expect(endpoints.writes()).resolves.toMatchObject([
    { method: 'DELETE', path: `/repos/${owner}/releases/assets/11` },
    { method: 'POST', name: asset, size: tarball.length },
  ]);
});

test('an uploaded asset is kept and never replaced', async () => {
  const root = writePlan(temporaryRoot('loom-record-'));
  const endpoints = await startServices({
    packages: publishedPackage(),
    release: { assets: [{ id: 11, name: asset, size: 40 }], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: source },
    version: '0.2.0',
  });
  const result = record(root, endpoints);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Kept the ${asset} asset.`);
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('a registry that answers 404 twice is read again until the version appears', async () => {
  const root = writePlan(temporaryRoot('loom-record-'));
  const endpoints = await startServices({
    packages: publishedPackage({ misses: 2 }),
    release: { assets: [{ id: 11, name: asset, size: 40 }], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: source },
    version: '0.2.0',
  });
  expect(record(root, endpoints).status).toBe(0);
});

test('a tarball that does not match its integrity fails before any write', async () => {
  const root = writePlan(temporaryRoot('loom-record-'));
  const endpoints = await startServices({
    packages: publishedPackage({ integrity: 'sha512-Ym9ndXM=' }),
    repository: owner,
    version: '0.2.0',
  });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('sha512-Ym9ndXM=');
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('provenance that names another repository fails before any write', async () => {
  const root = writePlan(temporaryRoot('loom-record-'));
  const endpoints = await startServices({
    packages: publishedPackage({ provenanceRepository: 'other/project' }),
    repository: owner,
    version: '0.2.0',
  });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('other/project');
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('a missing token fails before any read', async () => {
  const root = writePlan(temporaryRoot('loom-record-'));
  const endpoints = await startServices({
    packages: publishedPackage(),
    repository: owner,
    version: '0.2.0',
  });
  const result = record(root, endpoints, { token: undefined });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('GH_TOKEN');
  await expect(endpoints.writes()).resolves.toEqual([]);
});
