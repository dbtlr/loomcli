import { object, string } from 'valibot';

import { readFragments } from './fragments.js';
import { parseManifest } from './manifest.js';
import { isBuildAffectingPath } from './material.js';
import { parseOrThrow } from './parse-or-throw.js';
import { checkRelease } from './release-check.js';
import { currentVersion, git, gitLine, readLibraries, readRegularFile } from './repository.js';
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
    throw new Error('PR checks require full Git history.');
  }
  const base = await commitOf(checkout, options.base);
  const head = await commitOf(checkout, options.head);
  const ancestor = await gitLine(checkout, ['merge-base', base, head]);
  const fragments = await readFragments(checkout, head);
  const diff = await git(checkout, [
    'diff',
    '--no-renames',
    '--name-only',
    '-z',
    ancestor,
    head,
    '--',
  ]);
  const changed = diff.split('\0').filter(Boolean);
  if (options.title.startsWith('chore(release)')) {
    const version =
      /^chore\(release\): Release v(?<version>0\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)) - (?:\S[^\r\n]*)$/u.exec(
        options.title,
      )?.groups?.version;
    if (version === undefined) {
      throw new Error('Expected release title: chore(release): Release v<version> - <description>');
    }
    if (ancestor !== base) {
      throw new Error(
        'Release branch must include the current base commit. Update the release cut.',
      );
    }
    if (fragments.length > 0) {
      throw new Error('No fragments may remain after a release cut.');
    }
    await checkRelease(checkout, base, head, version, changed);
    return;
  }
  const libraries = await readLibraries(checkout, head);
  const previous = await readLibraries(checkout, ancestor);
  const current = currentVersion(previous);
  currentVersion(libraries);
  for (const library of libraries) {
    if (library.manifest.version !== current.text) {
      throw new Error(`${library.path}: ordinary PR version must stay ${current.text}.`);
    }
  }
  for (const library of previous) {
    if (await git(checkout, ['ls-tree', head, '--', library.path])) {
      const manifest = parseOrThrow(
        object({ version: string() }),
        parseManifest(await readRegularFile(checkout, library.path, head), library.path),
      );
      if (manifest.version !== library.manifest.version) {
        throw new Error(`${library.path}: ordinary PR version must stay ${current.text}.`);
      }
    }
  }
  if (
    changed.some(isBuildAffectingPath) &&
    !fragments.some((fragment) => changed.includes(`.changes/${fragment.name}`)) &&
    !options.labels.includes('skip-changelog')
  ) {
    throw new Error('Build-affecting PRs require an added or modified fragment or skip-changelog.');
  }
}
