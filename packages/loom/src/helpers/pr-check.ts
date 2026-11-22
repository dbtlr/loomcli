import { object, string } from 'valibot';

import {
  expectedReleaseTitle,
  fragmentRequired,
  fragmentsAfterCut,
  prShallow,
  releaseBranchBehind,
  versionMustStay,
} from '../commands/pr/messages.js';
import { readFragments } from './fragments.js';
import { parseManifest } from './manifest.js';
import { isBuildAffectingPath } from './material.js';
import { parseOrThrow } from './parse-or-throw.js';
import { checkRelease } from './release-check.js';
import {
  currentVersion,
  git,
  gitLine,
  gitPaths,
  readLibraries,
  readPlacement,
  readRegularFile,
  workspaceAt,
} from './repository.js';
import type { Checkout } from './repository.js';

/** A revision named for the check, resolved to the commit it names. */
function commitOf(checkout: Checkout, revision: string) {
  return gitLine(checkout, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]);
}

export async function checkPullRequest(
  checkout: Checkout,
  options: { base: string; head: string; title: string; labels: string[] },
) {
  if ((await gitLine(checkout, ['rev-parse', '--is-shallow-repository'])) === 'true') {
    throw new Error(prShallow);
  }
  const base = await commitOf(checkout, options.base);
  const head = await commitOf(checkout, options.head);
  const ancestor = await gitLine(checkout, ['merge-base', base, head]);
  const fragments = await readFragments(checkout, head);
  const placement = await readPlacement(checkout);
  const changed = await gitPaths(checkout, placement, [
    'diff',
    '--no-renames',
    '--name-only',
    '-z',
    ancestor,
    head,
    '--',
  ]);
  if (options.title.startsWith('chore(release)')) {
    const version =
      /^chore\(release\): Release v(?<version>0\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)) - (?:\S[^\r\n]*)$/u.exec(
        options.title,
      )?.groups?.version;
    if (version === undefined) {
      throw new Error(expectedReleaseTitle);
    }
    if (ancestor !== base) {
      throw new Error(releaseBranchBehind);
    }
    if (fragments.length > 0) {
      throw new Error(fragmentsAfterCut);
    }
    await checkRelease(checkout, base, head, version, { changed, placement });
    return;
  }
  const libraries = await readLibraries(checkout, head);
  const previous = await readLibraries(checkout, ancestor);
  const current = currentVersion(previous);
  currentVersion(libraries);
  for (const library of libraries) {
    if (library.manifest.version !== current.text) {
      throw new Error(versionMustStay(library.path, current.text));
    }
  }
  const location = await workspaceAt(checkout, head);
  for (const library of previous) {
    const path = `${location}${library.path}`;
    if (await git(checkout, ['ls-tree', head, '--', path])) {
      const manifest = parseOrThrow(
        object({ version: string() }),
        parseManifest(await readRegularFile(checkout, path, head), library.path),
      );
      if (manifest.version !== library.manifest.version) {
        throw new Error(versionMustStay(library.path, current.text));
      }
    }
  }
  if (
    changed.some((path) => isBuildAffectingPath(path, placement)) &&
    !fragments.some((fragment) => changed.includes(`.changes/${fragment.name}`)) &&
    !options.labels.includes('skip-changelog')
  ) {
    throw new Error(fragmentRequired);
  }
}
