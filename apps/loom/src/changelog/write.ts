import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

function insertSection(changelog: string, section: string, version: string) {
  const { after, before } = releaseInsertion(changelog, version);
  return before + section + after;
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

// Stage package-manager work before touching the checkout; handled write failures restore originals.
function installRelease(root: string, release: ReturnType<typeof prepareRelease>) {
  if (git(root, ['rev-parse', '--show-prefix']).trim() !== '') {
    throw new Error('Run write from the repository root.');
  }
  if (git(root, ['status', '--porcelain', '--untracked-files=all']).trim()) {
    throw new Error('write requires a clean checkout. Commit the release inputs first.');
  }
  if (git(root, ['tag', '--list', `v${release.version}`]).trim()) {
    throw new Error(`Tag v${release.version} already exists.`);
  }
  const original = new Map<string, string | undefined>();
  const updates = new Map<string, string | undefined>();
  original.set('CHANGELOG.md', readRegularFile(root, 'CHANGELOG.md'));
  updates.set(
    'CHANGELOG.md',
    insertSection(readRegularFile(root, 'CHANGELOG.md'), release.section, release.version),
  );
  for (const library of release.libraries) {
    original.set(library.path, library.source);
    updates.set(library.path, versionedManifest(library.source, release.version));
  }
  for (const fragment of release.fragments) {
    original.set(`.changes/${fragment.name}`, fragment.body);
    updates.set(`.changes/${fragment.name}`, undefined);
  }
  original.set(
    'pnpm-lock.yaml',
    existsSync(join(root, 'pnpm-lock.yaml')) ? readRegularFile(root, 'pnpm-lock.yaml') : undefined,
  );
  const installed: string[] = [];
  updates.set('pnpm-lock.yaml', prepareLockfile(root, release));
  try {
    if (
      git(root, ['rev-parse', 'HEAD']).trim() !== release.head ||
      git(root, ['status', '--porcelain', '--untracked-files=all']).trim()
    ) {
      throw new Error('Checkout changed during release preparation.');
    }
    for (const [path, contents] of original) {
      const current = existsSync(join(root, path)) ? readRegularFile(root, path) : undefined;
      if (current !== contents) {
        throw new Error(`${path}: changed during release preparation.`);
      }
    }
    for (const [path, contents] of updates) {
      installed.push(path);
      if (contents === undefined) {
        rmSync(join(root, path));
      } else {
        writeFileSync(join(root, path), contents);
      }
    }
  } catch (error) {
    const failed: string[] = [];
    for (const path of installed.toReversed()) {
      try {
        const contents = original.get(path);
        const current = existsSync(join(root, path)) ? readRegularFile(root, path) : undefined;
        if (current !== contents) {
          if (contents === undefined) {
            rmSync(join(root, path), { force: true });
          } else {
            writeFileSync(join(root, path), contents);
          }
        }
      } catch {
        failed.push(path);
      }
    }
    if (failed.length > 0) {
      throw new Error(
        `Release rollback incomplete for ${failed.join(', ')}. Use a fresh isolated checkout.`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function writeRelease(root: string, release: ReturnType<typeof prepareRelease>) {
  const lock = resolve(root, git(root, ['rev-parse', '--git-path', 'changelog-write.lock']).trim());
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(
        `Release lock already exists at ${lock}. Another writer may be active. After an interrupted write, use a fresh isolated checkout.`,
        { cause: error },
      );
    }
    throw error;
  }
  try {
    installRelease(root, release);
  } finally {
    rmSync(lock, { recursive: true });
  }
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

export { releaseInsertion };
