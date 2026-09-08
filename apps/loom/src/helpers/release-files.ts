import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fromMarkdown } from 'mdast-util-from-markdown';
import { parseAllDocuments } from 'yaml';
import { z } from 'zod';

import { headingText, requireClosedBlocks } from './markdown.js';
import type { prepareRelease } from './release.js';
import { blankLine } from './release.js';
import { git, readRegularFile, readRegularFileBytes } from './repository.js';

function releaseInsertion(changelog: string, version: string) {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/u.exec(changelog)?.[0] ?? '';
  const body = changelog.slice(frontmatter.length);
  requireClosedBlocks(body, 'CHANGELOG.md');
  const nodes = fromMarkdown(body).children;
  const headings = nodes.filter((node) => node.type === 'heading');
  if (!headings.some((node) => node.depth === 1)) {
    throw new Error('CHANGELOG.md requires a title.');
  }
  if (
    headings.some(
      (node) =>
        headingText(node).trim().toLowerCase() === 'unreleased' ||
        headingText(node).trim().split(/\s/u)[0] === `v${version}`,
    )
  ) {
    throw new Error('CHANGELOG.md already contains this version or an Unreleased section.');
  }
  const firstRelease = headings.find((node) => node.depth === 2);
  const offset = firstRelease?.position?.start.offset;
  const before = offset === undefined ? changelog : changelog.slice(0, frontmatter.length + offset);
  const after = offset === undefined ? '' : changelog.slice(frontmatter.length + offset);
  return { after, before: before + blankLine(before) };
}

function updateLockfile(root: string) {
  const lock = join(root, 'pnpm-lock.yaml');
  if (existsSync(lock)) {
    for (const document of parseAllDocuments(readRegularFile(root, 'pnpm-lock.yaml'))) {
      if (document.errors.length > 0) {
        throw new Error('pnpm-lock.yaml is invalid YAML.');
      }
      z.object({ lockfileVersion: z.union([z.string(), z.number()]) }).parse(document.toJS());
    }
  }
  const manifestPath = fileURLToPath(import.meta.resolve('pnpm/package.json'));
  const manifestSource = readRegularFile(dirname(manifestPath), 'package.json');
  const manifest = z
    .object({ bin: z.object({ pnpm: z.string() }) })
    .parse(JSON.parse(manifestSource));
  const result = spawnSync(
    join(dirname(manifestPath), manifest.bin.pnpm),
    [
      'install',
      '--lockfile-only',
      '--lockfile-dir',
      '.',
      '--offline',
      '--ignore-scripts',
      '--ignore-pnpmfile',
      '--config.frozen-lockfile=false',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Lockfile preparation failed:\n${result.stdout}${result.stderr}`);
  }
  return readRegularFile(root, 'pnpm-lock.yaml');
}

function versionedManifest(source: string, version: string) {
  const document = z.record(z.string(), z.unknown()).parse(JSON.parse(source));
  return `${JSON.stringify({ ...document, version }, null, 2)}\n`;
}

export function prepareLockfile(
  root: string,
  release: Pick<ReturnType<typeof prepareRelease>, 'libraries' | 'version'>,
  ref?: string,
) {
  const stage = mkdtempSync(join(tmpdir(), 'loom-release-'));
  try {
    const paths = git(
      root,
      ref === undefined ? ['ls-files', '-z'] : ['ls-tree', '-r', '--name-only', '-z', ref],
    );
    for (const path of paths.split('\0').filter(Boolean)) {
      mkdirSync(dirname(join(stage, path)), { recursive: true });
      writeFileSync(join(stage, path), readRegularFileBytes(root, path, ref));
    }
    for (const library of release.libraries) {
      writeFileSync(join(stage, library.path), versionedManifest(library.source, release.version));
    }
    return updateLockfile(stage);
  } finally {
    rmSync(stage, { force: true, recursive: true });
  }
}

export { releaseInsertion, versionedManifest };
