import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  prepareLockfile,
  releaseInsertion,
  versionedManifest,
} from '../../helpers/release-files.js';
import type { prepareRelease } from '../../helpers/release.js';
import { git, readRegularFile } from '../../helpers/repository.js';

function insertSection(changelog: string, section: string, version: string) {
  const { after, before } = releaseInsertion(changelog, version);
  return before + section + after;
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
