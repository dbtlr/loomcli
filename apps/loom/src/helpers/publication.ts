import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { readFragments } from './fragments.js';
import { checkPullRequest } from './pr-check.js';
import { checkConsumers } from './publication-consumers.js';
import { digest, inspectPack, integrity } from './publication-pack.js';
import { checkoutSource, pnpm } from './publication-process.js';
import { currentVersion, git, readLibraries, readRegularFileBytes } from './repository.js';

const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const fragmentSchema = z.strictObject({ content: z.string(), name: z.string() });
const packageSchema = z.strictObject({
  directory: z.string(),
  exports: z.array(z.string()),
  file: z.string().regex(/^package-\d+\.tgz$/u),
  files: z.array(z.string()),
  integrity: z.string(),
  name: z.string(),
  version: z.string(),
});
const manifestSchema = z.strictObject({
  base: sha,
  fragments: z.array(fragmentSchema),
  packages: z.array(packageSchema).min(1),
  schema: z.literal(1),
  source: sha,
  title: z.string(),
  version: z.string(),
});

function releaseIdentity(
  root: string,
  options: { base: string; head: string; title: string },
  retained: boolean,
) {
  sha.parse(options.base);
  sha.parse(options.head);
  if (!options.title.startsWith('chore(release): Release ')) {
    throw new Error('Expected a release title.');
  }
  checkPullRequest(root, { ...options, labels: [], retained });
  const libraries = readLibraries(root, options.head);
  const fragments = readFragments(root, options.base).map((fragment) => ({
    content: readRegularFileBytes(root, `.changes/${fragment.name}`, options.base).toString('utf8'),
    name: fragment.name,
  }));
  return { fragments, libraries, version: currentVersion(libraries).text };
}

export function verifyArtifacts(
  root: string,
  options: { artifacts: string; digest: string; head: string },
) {
  const directory = resolve(root, options.artifacts);
  const bytes = readRegularFileBytes(directory, 'manifest.json');
  if (digest(bytes) !== hash.parse(options.digest)) {
    throw new Error('Artifact manifest digest does not match the retained identity.');
  }
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (manifest.source !== sha.parse(options.head)) {
    throw new Error('Artifact source does not match the requested source SHA.');
  }
  const release = releaseIdentity(
    root,
    { base: manifest.base, head: manifest.source, title: manifest.title },
    true,
  );
  if (
    release.version !== manifest.version ||
    !isDeepStrictEqual(release.fragments, manifest.fragments)
  ) {
    throw new Error('Artifact version or consumed fragments differ from the original release.');
  }
  if (manifest.packages.length !== release.libraries.length) {
    throw new Error('Artifact package list differs from the original release.');
  }
  const expectedFiles = ['manifest.json'];
  for (const [index, library] of release.libraries.entries()) {
    const record = manifest.packages[index];
    if (
      record === undefined ||
      record.name !== library.manifest.name ||
      record.directory !== library.directory ||
      record.version !== release.version ||
      record.file !== `package-${index}.tgz`
    ) {
      throw new Error('Artifact package list differs from the original release.');
    }
    expectedFiles.push(record.file);
    if (integrity(readRegularFileBytes(directory, record.file)) !== record.integrity) {
      throw new Error(`${record.name}: artifact integrity does not match.`);
    }
    const inspected = inspectPack(join(directory, record.file), library, release.libraries);
    if (
      !isDeepStrictEqual(inspected.files, record.files) ||
      !isDeepStrictEqual(inspected.exports, record.exports)
    ) {
      throw new Error(`${record.name}: artifact inventory differs.`);
    }
  }
  if (!isDeepStrictEqual(readdirSync(directory).toSorted(), expectedFiles.toSorted())) {
    throw new Error('Unexpected artifact set files.');
  }
  return manifest;
}

export function verifyPublication(
  root: string,
  options: { artifacts: string; digest: string; head: string; runtime: string },
) {
  const artifacts = resolve(root, options.artifacts);
  const manifest = verifyArtifacts(root, options);
  const temporary = mkdtempSync(join(tmpdir(), 'loom-publication-verify-'));
  try {
    const source = join(temporary, 'source');
    checkoutSource(root, manifest.source, source);
    pnpm(source, ['install', '--frozen-lockfile', '--ignore-scripts']);
    checkConsumers(source, artifacts, manifest.packages, options.runtime);
    verifyArtifacts(root, options);
    return {
      base: manifest.base,
      digest: options.digest,
      source: manifest.source,
      version: manifest.version,
    };
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

export function preparePublication(
  root: string,
  options: { base: string; head: string; title: string; output: string; runtime: string },
) {
  const output = resolve(root, options.output);
  if (existsSync(output)) {
    throw new Error(
      'Artifact output already exists. Verify the retained set instead of rebuilding.',
    );
  }
  const release = releaseIdentity(root, options, false);
  mkdirSync(dirname(output), { recursive: true });
  const stage = mkdtempSync(join(dirname(output), '.loom-artifacts-'));
  const temporary = mkdtempSync(join(tmpdir(), 'loom-publication-prepare-'));
  try {
    const source = join(temporary, 'source');
    checkoutSource(root, options.head, source);
    pnpm(source, ['install', '--frozen-lockfile']);
    pnpm(source, ['run', 'verify']);
    const packages = release.libraries.map((library, index) => {
      const file = `package-${index}.tgz`;
      pnpm(join(source, library.directory), ['pack', '--out', join(stage, file)]);
      return {
        directory: library.directory,
        file,
        integrity: integrity(readFileSync(join(stage, file))),
        name: library.manifest.name,
        version: release.version,
        ...inspectPack(join(stage, file), library, release.libraries),
      };
    });
    if (git(source, ['status', '--porcelain', '--untracked-files=normal']).trim()) {
      throw new Error('Build or pack changed release source files.');
    }
    const manifest = {
      base: options.base,
      fragments: release.fragments,
      packages,
      schema: 1,
      source: options.head,
      title: options.title,
      version: release.version,
    };
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(stage, 'manifest.json'), bytes);
    const id = digest(bytes);
    verifyArtifacts(root, { artifacts: stage, digest: id, head: options.head });
    checkConsumers(source, stage, packages, options.runtime);
    verifyArtifacts(root, { artifacts: stage, digest: id, head: options.head });
    if (existsSync(output)) {
      throw new Error('Artifact output already exists.');
    }
    renameSync(stage, output);
    return { base: options.base, digest: id, source: options.head, version: release.version };
  } finally {
    rmSync(stage, { force: true, recursive: true });
    rmSync(temporary, { force: true, recursive: true });
  }
}
