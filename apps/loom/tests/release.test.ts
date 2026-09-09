import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { commit, git, put, removeRoots, repository, temporaryRoot } from './fixture.js';
import { startServices, stopServices } from './services.js';
import type { PackageState } from './services.js';

const cli = new URL('../dist/main.js', import.meta.url);
const owner = 'dbtlr/loomcli';
const library = '@sample/core';
const extraLibrary = '@sample/extra';
const notes = '### Changes\n\n- Fix output.';
const asset = 'sample-core-0.2.0.tgz';
const elsewhere = '1111111111111111111111111111111111111111';

afterEach(() => {
  stopServices();
  removeRoots();
});

function manifest(version: string, name = library) {
  return `${JSON.stringify({ name, version }, null, 2)}\n`;
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
  provenanceCommit: z.string().nullable(),
  publish: z.boolean(),
  record: z.boolean(),
  release: z.object({ present: z.boolean() }),
  tag: z.object({ commit: z.string().nullable(), present: z.boolean() }),
  version: z.string(),
});

function uploaded(name = asset) {
  return { id: 11, name, size: 40, state: 'uploaded' };
}

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

test('a version on the registry, the tag, and a complete Release leaves nothing to do', async () => {
  const { cut, root } = releaseRepository();
  const endpoints = await startServices({
    packages: { [library]: { provenanceCommit: cut, published: true } },
    release: { assets: [uploaded()], id: 900 },
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
    provenanceCommit: cut,
    publish: false,
    record: false,
    release: { present: true },
    tag: { commit: cut, present: true },
    version: '0.2.0',
  });
  expect(result.stdout).toContain('Publish: no. Record: no.');
});

test.each([
  ['no assets', []],
  ['an empty expected asset', [{ id: 11, name: asset, size: 0, state: 'uploaded' }]],
  ['an unfinished expected asset', [{ id: 11, name: asset, size: 40, state: 'starter' }]],
])('a Release carrying %s is incomplete and plans recording', async (_label, assets) => {
  const { cut, root } = releaseRepository();
  const endpoints = await startServices({
    packages: { [library]: { provenanceCommit: cut, published: true } },
    release: { assets, id: 900 },
    repository: owner,
    tag: { annotated: true, commit: cut },
    version: '0.2.0',
  });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({ publish: false, record: true, release: { present: true } });
});

test('a Release carrying only foreign assets was recorded elsewhere and is complete', async () => {
  const { cut, root } = releaseRepository();
  const endpoints = await startServices({
    packages: { [library]: { provenanceCommit: cut, published: true } },
    release: { assets: [uploaded('sample-core-0.2.0.zip')], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: cut },
    version: '0.2.0',
  });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({ record: false });
});

test('a published version whose tag names another commit fails', async () => {
  const { cut, root } = releaseRepository();
  const endpoints = await startServices({
    packages: { [library]: { provenanceCommit: cut, published: true } },
    release: { assets: [uploaded()], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: elsewhere },
    version: '0.2.0',
  });
  const result = plan(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(elsewhere);
  expect(result.stderr).toContain(cut);
});

test('a tag reference whose tag object the API does not carry fails', async () => {
  const { cut, root } = releaseRepository();
  const endpoints = await startServices({
    packages: { [library]: { provenanceCommit: cut, published: true } },
    release: { assets: [uploaded()], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: cut, missingObject: true },
    version: '0.2.0',
  });
  const result = plan(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Tag v0.2.0 names tag object tagobject-${cut}`);
  expect(result.stderr).toContain('which the API does not return');
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
    release: { present: false },
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
    packages: { [library]: { provenanceCommit: cut, published: true } },
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

// The list is written out here, not imported, so a shrunken production set fails a case instead of dropping it.
const buildInputs = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/clean.mjs',
  'tsconfig.json',
];

test.each(buildInputs)('a change to %s after the cut commit refuses publication', async (path) => {
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
});

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

test('one published and one unpublished library still plans publication', async () => {
  const root = baseRepository();
  put(root, 'packages/extra/package.json', manifest('0.1.0', extraLibrary));
  commit(root);
  put(root, 'packages/extra/package.json', manifest('0.2.0', extraLibrary));
  cutRelease(root, '0.2.0');
  const endpoints = await startServices({
    packages: { [library]: { published: true } },
    repository: owner,
    version: '0.2.0',
  });
  expect(plan(root, endpoints).status).toBe(0);
  expect(planned(root)).toMatchObject({
    libraries: [
      { name: library, published: true },
      { name: extraLibrary, published: false },
    ],
    publish: true,
  });
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

const tarball = 'core tarball bytes';

// Recording checks the provenance commit against the checkout, so its fixture is a repository.
function recordRepository() {
  return repository({ files: { 'README.md': '# Fixture\n' }, prefix: 'loom-record-' });
}

const coreLibrary = { directory: 'packages/core', name: library, published: true };

function writePlan(root: string, head: string, libraries = [coreLibrary]) {
  writeFileSync(
    join(root, 'plan.json'),
    JSON.stringify({
      cutCommit: head,
      head,
      libraries,
      notes,
      provenanceCommit: head,
      publish: true,
      record: true,
      release: { present: false },
      tag: { commit: null, present: false },
      version: '0.2.0',
    }),
  );
}

// A checkout whose own commit is the one the registry attests for the published library.
function recordFixture(overrides: Partial<PackageState> = {}) {
  const { base, root } = recordRepository();
  writePlan(root, base);
  return {
    packages: { [library]: { provenanceCommit: base, published: true, tarball, ...overrides } },
    published: base,
    root,
  };
}

function record(
  root: string,
  endpoints: Endpoints,
  options: { requestTimeoutMs?: number; token: string | undefined } = { token: 'test-token' },
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
      ...(options.requestTimeoutMs === undefined
        ? []
        : ['--request-timeout-ms', String(options.requestTimeoutMs)]),
    ],
    { cwd: root, env: { GH_TOKEN: options.token } },
  );
}

test('an absent tag and Release are created at the provenance commit with the notes and the asset', async () => {
  const { packages, published, root } = recordFixture();
  const endpoints = await startServices({ packages, repository: owner, version: '0.2.0' });
  expect(record(root, endpoints)).toMatchObject({ status: 0, stderr: '' });
  await expect(endpoints.writes()).resolves.toMatchObject([
    {
      body: { message: 'v0.2.0', object: published, tag: 'v0.2.0', type: 'commit' },
      method: 'POST',
    },
    { body: { ref: 'refs/tags/v0.2.0', sha: `tagobject-${published}` }, method: 'POST' },
    {
      body: { body: notes, draft: false, name: 'v0.2.0', prerelease: false, tag_name: 'v0.2.0' },
      method: 'POST',
    },
    { contentType: 'application/gzip', name: asset, size: tarball.length },
  ]);
});

test('a head past the published commit tags the commit the run published from', async () => {
  const { base, root } = recordRepository();
  put(root, 'docs/guide.md', '# Guide\n');
  const head = commit(root);
  writePlan(root, base);
  const endpoints = await startServices({
    packages: { [library]: { provenanceCommit: base, published: true, tarball } },
    repository: owner,
    version: '0.2.0',
  });
  expect(record(root, endpoints).status).toBe(0);
  const writes = await endpoints.writes();
  expect(writes[0]).toMatchObject({ body: { object: base } });
  expect(JSON.stringify(writes)).not.toContain(head);
});

test('a tag already at the provenance commit is reused without a tag write', async () => {
  const { packages, published, root } = recordFixture();
  const endpoints = await startServices({
    packages,
    repository: owner,
    tag: { annotated: true, commit: published },
    version: '0.2.0',
  });
  expect(record(root, endpoints).status).toBe(0);
  const writes = await endpoints.writes();
  expect(writes.filter((write) => write.path.includes('/git/'))).toEqual([]);
  expect(writes).toHaveLength(2);
});

test('a tag at another commit fails before any write', async () => {
  const { packages, published, root } = recordFixture();
  const endpoints = await startServices({
    packages,
    repository: owner,
    tag: { annotated: true, commit: elsewhere },
    version: '0.2.0',
  });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(elsewhere);
  expect(result.stderr).toContain(published);
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test.each([
  ['an empty', 0, 'uploaded'],
  ['an unfinished', 40, 'starter'],
])('%s asset is deleted and uploaded again', async (_label, size, state) => {
  const { packages, published, root } = recordFixture();
  const endpoints = await startServices({
    packages,
    release: { assets: [{ id: 11, name: asset, size, state }], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: published },
    version: '0.2.0',
  });
  expect(record(root, endpoints).status).toBe(0);
  await expect(endpoints.writes()).resolves.toMatchObject([
    { method: 'DELETE', path: `/repos/${owner}/releases/assets/11` },
    { method: 'POST', name: asset, size: tarball.length },
  ]);
});

test('an uploaded asset is kept and never replaced', async () => {
  const { packages, published, root } = recordFixture();
  const endpoints = await startServices({
    packages,
    release: { assets: [{ id: 11, name: asset, size: 40 }], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: published },
    version: '0.2.0',
  });
  const result = record(root, endpoints);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Kept the ${asset} asset.`);
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('an uploaded asset past the first page of the assets list is still kept', async () => {
  const { packages, published, root } = recordFixture();
  const earlier = Array.from({ length: 34 }, (unused, index) =>
    uploaded(`other-${String(index)}.tgz`),
  );
  const endpoints = await startServices({
    packages,
    release: { assets: [...earlier, uploaded()], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: published },
    version: '0.2.0',
  });
  const result = record(root, endpoints);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Kept the ${asset} asset.`);
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('a Release whose upload endpoint names another origin fails before any upload', async () => {
  const { packages, published, root } = recordFixture();
  const endpoints = await startServices({
    packages,
    release: { assets: [], id: 900, uploadHost: 'uploads.example.invalid' },
    repository: owner,
    tag: { annotated: true, commit: published },
    version: '0.2.0',
  });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('uploads.example.invalid');
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('a registry that answers 404 twice is read again until the version appears', async () => {
  const { packages, published, root } = recordFixture({ misses: 2 });
  const endpoints = await startServices({
    packages,
    release: { assets: [{ id: 11, name: asset, size: 40 }], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: published },
    version: '0.2.0',
  });
  expect(record(root, endpoints).status).toBe(0);
});

test('a tarball endpoint that answers 503 twice is read again until it serves the bytes', async () => {
  const { packages, published, root } = recordFixture({ tarballMisses: 2 });
  const endpoints = await startServices({
    packages,
    release: { assets: [{ id: 11, name: asset, size: 40 }], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: published },
    version: '0.2.0',
  });
  expect(record(root, endpoints).status).toBe(0);
});

test('a tarball endpoint that stalls past the deadline is read again until it serves the bytes', async () => {
  const { packages, published, root } = recordFixture({ tarballStalls: 1 });
  const endpoints = await startServices({
    packages,
    release: { assets: [{ id: 11, name: asset, size: 40 }], id: 900 },
    repository: owner,
    tag: { annotated: true, commit: published },
    version: '0.2.0',
  });
  expect(record(root, endpoints, { requestTimeoutMs: 50, token: 'test-token' }).status).toBe(0);
});

test('a stalled registry read under plan fails with the url it waited on', async () => {
  const { root } = releaseRepository();
  const endpoints = await startServices({
    packages: { [library]: { published: true, stalls: 1 } },
    repository: owner,
    version: '0.2.0',
  });
  const result = plan(root, endpoints, '--request-timeout-ms', '50');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`${endpoints.registry}/${library}`);
  expect(result.stderr).toContain('did not answer within 50 ms');
});

test('a tarball that does not match its integrity fails before any write', async () => {
  const { packages, root } = recordFixture({ integrity: 'sha512-Ym9ndXM=' });
  const endpoints = await startServices({ packages, repository: owner, version: '0.2.0' });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('sha512-Ym9ndXM=');
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('provenance that names another repository fails before any write', async () => {
  const { packages, root } = recordFixture({ provenanceRepository: 'other/project' });
  const endpoints = await startServices({ packages, repository: owner, version: '0.2.0' });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('other/project');
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('provenance that names another branch fails before any write', async () => {
  const { packages, root } = recordFixture({ provenanceRef: 'refs/heads/other' });
  const endpoints = await startServices({ packages, repository: owner, version: '0.2.0' });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('refs/heads/other');
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('provenance that attests another package fails before any write', async () => {
  const subject = 'pkg:npm/%40other/core@0.2.0';
  const { packages, root } = recordFixture({ provenanceSubject: subject });
  const endpoints = await startServices({ packages, repository: owner, version: '0.2.0' });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(subject);
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('a provenance commit the checkout does not carry fails before any write', async () => {
  const { packages, root } = recordFixture({ provenanceCommit: elsewhere });
  const endpoints = await startServices({ packages, repository: owner, version: '0.2.0' });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(elsewhere);
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('two libraries published from different commits fail before any write', async () => {
  const { base, root } = recordRepository();
  writePlan(root, base, [
    coreLibrary,
    { directory: 'packages/extra', name: extraLibrary, published: true },
  ]);
  const endpoints = await startServices({
    packages: {
      [library]: { provenanceCommit: base, published: true, tarball },
      [extraLibrary]: { provenanceCommit: elsewhere, published: true, tarball: 'extra bytes' },
    },
    repository: owner,
    version: '0.2.0',
  });
  const result = record(root, endpoints);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(elsewhere);
  expect(result.stderr).toContain(base);
  await expect(endpoints.writes()).resolves.toEqual([]);
});

test('a missing token fails before any read', async () => {
  const { packages, root } = recordFixture();
  const endpoints = await startServices({ packages, repository: owner, version: '0.2.0' });
  const result = record(root, endpoints, { token: undefined });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('GH_TOKEN');
  await expect(endpoints.writes()).resolves.toEqual([]);
});
