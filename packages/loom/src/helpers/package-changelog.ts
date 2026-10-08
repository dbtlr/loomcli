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

import { z } from 'zod';

import { highestKind, insertSection, landedFragments, renderSection } from './changelog.js';
import { withVersion } from './manifest.js';
import { withoutByteOrderMark } from './markdown.js';
import { isRepository, isShallow, readRegularFile } from './repository.js';
import { nextVersion, parseVersion } from './version.js';

function manifestVersion(source: string) {
  let document: unknown = undefined;
  try {
    document = JSON.parse(withoutByteOrderMark(source));
  } catch (error) {
    throw new Error('package.json: expected valid JSON.', { cause: error });
  }
  const parsed = z.object({ version: z.string() }).safeParse(document);
  if (!parsed.success) {
    throw new Error('package.json: expected a version string.');
  }
  return parsed.data.version;
}

function packageVersion(source: string) {
  const text = manifestVersion(source);
  const version = parseVersion(text);
  if (version === undefined) {
    throw new Error(
      `package.json version ${JSON.stringify(text)} is not MAJOR.MINOR.PATCH, so set a release version such as 1.2.0; prerelease versions belong to release orchestration.`,
    );
  }
  return version;
}

// Write orders fragments by the commits that added them, so it reads the full history of a repository.
function requireHistory(directory: string) {
  if (!isRepository(directory)) {
    throw new Error(
      'loom changelog write orders fragments by the commits that added them, so run it inside a git repository with the fragments committed.',
    );
  }
  if (isShallow(directory)) {
    throw new Error(
      'loom changelog write needs full git history to order the fragments, so fetch it with git fetch --unshallow and run it again.',
    );
  }
}

/**
 * A package's next cut, prepared without writing: the section its pending fragments render, the
 * version they decide, and the new contents of `CHANGELOG.md` and `package.json`.
 */
export function preparePackageCut(
  directory: string,
  options: { date: string; narrative: string | undefined },
) {
  const manifest = readRegularFile(directory, 'package.json');
  const current = packageVersion(manifest);
  requireHistory(directory);
  const { fragments } = landedFragments(directory);
  if (fragments.length === 0) {
    throw new Error('No fragments to release, so add a fragment to .changes/ first.');
  }
  const version = nextVersion(current, highestKind(fragments));
  const section = renderSection({
    date: options.date,
    fragments,
    narrative: options.narrative,
    version,
  });
  const changelog = existsSync(join(directory, 'CHANGELOG.md'))
    ? readRegularFile(directory, 'CHANGELOG.md')
    : '# Changelog\n';
  return {
    changelog: insertSection(changelog, section, version),
    fragments,
    manifest: withVersion(manifest, version),
    section,
    version,
  };
}

/**
 * Installs a prepared cut. The new files are staged in a temporary directory beside the originals,
 * so a failure while staging changes nothing. The replacement then moves each original and each
 * consumed fragment into that directory and the staged files into place, and a failure undoes every
 * move made so far. Only when the undo itself fails does the directory stay, holding the originals.
 */
export function writePackageCut(directory: string, cut: ReturnType<typeof preparePackageCut>) {
  const stage = mkdtempSync(join(directory, '.loom-changelog-'));
  const moves: { from: string; to: string }[] = [];
  const move = (from: string, to: string) => {
    renameSync(from, to);
    moves.push({ from, to });
  };
  let keep = false;
  try {
    const files = [
      ['CHANGELOG.md', cut.changelog],
      ['package.json', cut.manifest],
    ] satisfies [string, string][];
    for (const [name, contents] of files) {
      writeFileSync(join(stage, `new.${name}`), contents);
      if (existsSync(join(directory, name))) {
        chmodSync(join(stage, `new.${name}`), statSync(join(directory, name)).mode);
      }
    }
    for (const [name] of files) {
      if (existsSync(join(directory, name))) {
        move(join(directory, name), join(stage, `old.${name}`));
      }
      move(join(stage, `new.${name}`), join(directory, name));
    }
    for (const fragment of cut.fragments) {
      move(join(directory, '.changes', fragment.name), join(stage, `fragment.${fragment.name}`));
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
