import {
  chmodSync,
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { object, safeParse, string } from 'valibot';

import { highestKind, insertSection, landedFragments, renderSection } from './changelog.js';
import type { ChangelogFiles } from './changelog.js';
import { parseManifest, withVersion } from './manifest.js';
import { isRepository, isShallow, readWorkingFile } from './repository.js';
import type { Checkout } from './repository.js';
import { nextVersion, parseVersion } from './version.js';

function manifestVersion(source: string, path: string) {
  const parsed = safeParse(object({ version: string() }), parseManifest(source, path));
  if (!parsed.success) {
    throw new Error('package.json: expected a version string.');
  }
  return parsed.output.version;
}

function packageVersion(source: string, path: string) {
  const text = manifestVersion(source, path);
  const version = parseVersion(text);
  if (version === undefined) {
    throw new Error(
      `package.json version ${JSON.stringify(text)} is not MAJOR.MINOR.PATCH, so set a release version such as 1.2.0; prerelease versions belong to release orchestration.`,
    );
  }
  return version;
}

// Write orders fragments by the commits that added them, so it reads the full history of a repository.
async function requireHistory(checkout: Checkout) {
  if (!(await isRepository(checkout))) {
    throw new Error(
      'loom changelog write orders fragments by the commits that added them, so run it inside a git repository with the fragments committed.',
    );
  }
  if (await isShallow(checkout)) {
    throw new Error(
      'loom changelog write needs full git history to order the fragments, so fetch it with git fetch --unshallow and run it again.',
    );
  }
}

/**
 * A package's next cut, prepared without writing: the section its pending fragments render, the
 * version they decide, and the new contents of its changelog and `package.json`. `files` names the
 * changelog and the fragment folder relative to the package directory, and either may leave it.
 */
export async function preparePackageCut(
  checkout: Checkout,
  options: { date: string; narrative: string | undefined },
  files: ChangelogFiles,
) {
  const directory = checkout.root;
  const manifest = readWorkingFile(directory, 'package.json');
  const current = packageVersion(manifest, join(directory, 'package.json'));
  await requireHistory(checkout);
  const { fragments } = await landedFragments(checkout, undefined, files.changes);
  if (fragments.length === 0) {
    throw new Error(`No fragments to release, so add a fragment to ${files.changes}/ first.`);
  }
  const version = nextVersion(current, highestKind(fragments));
  const section = renderSection({
    date: options.date,
    fragments,
    narrative: options.narrative,
    version,
  });
  const changelog = existsSync(join(directory, files.changelog))
    ? readWorkingFile(directory, files.changelog)
    : '# Changelog\n';
  return {
    changelog: insertSection(changelog, section, version, files),
    files,
    fragments,
    manifest: withVersion(manifest, version),
    section,
    version,
  };
}

/** A package's next cut, prepared without writing. */
export type PackageCut = Awaited<ReturnType<typeof preparePackageCut>>;

/**
 * Installs a prepared cut. The new files are staged in a temporary directory in the package
 * directory, so a failure while staging changes nothing. The replacement then moves each original and each
 * consumed fragment into that directory and the staged files into place, and a failure undoes every
 * move made so far. Only when the undo itself fails does the directory stay, holding the originals.
 */
export function writePackageCut(directory: string, cut: PackageCut) {
  const stage = mkdtempSync(join(directory, '.loom-changelog-'));
  const moves: { from: string; to: string }[] = [];
  const move = (from: string, to: string) => {
    renameSync(from, to);
    moves.push({ from, to });
  };
  let keep = false;
  try {
    // Each file is staged under its conventional name, wherever the configuration puts the changelog.
    const files = [
      ['CHANGELOG.md', join(directory, cut.files.changelog), cut.changelog],
      ['package.json', join(directory, 'package.json'), cut.manifest],
    ] satisfies [string, string, string][];
    for (const [name, path, contents] of files) {
      writeFileSync(join(stage, `new.${name}`), contents);
      if (existsSync(path)) {
        chmodSync(join(stage, `new.${name}`), statSync(path).mode);
      }
    }
    for (const [name, path] of files) {
      if (existsSync(path)) {
        move(path, join(stage, `old.${name}`));
      }
      move(join(stage, `new.${name}`), path);
    }
    for (const fragment of cut.fragments) {
      move(
        join(directory, cut.files.changes, fragment.name),
        join(stage, `fragment.${fragment.name}`),
      );
    }
  } catch (error) {
    const failed: string[] = [];
    for (const { from, to } of moves.toReversed()) {
      try {
        renameSync(to, from);
      } catch {
        failed.push(from);
      }
    }
    if (failed.length > 0) {
      keep = true;
      throw new Error(
        `Restoring ${failed.join(', ')} failed, so copy the originals back from ${stage}.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (!keep) {
      rmSync(stage, { force: true, recursive: true });
    }
  }
}
