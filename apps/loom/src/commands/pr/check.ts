import { z } from 'zod';

import { readFragments } from '../../helpers/fragments.js';
import { isBuildAffectingPath } from '../../helpers/material.js';
import { currentVersion, git, readLibraries, readRegularFile } from '../../helpers/repository.js';
import { checkRelease } from './release.js';

export function checkPullRequest(
  root: string,
  options: { base: string; head: string; title: string; labels: string[] },
) {
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error('PR checks require full Git history.');
  }
  const base = git(root, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${options.base}^{commit}`,
  ]).trim();
  const head = git(root, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${options.head}^{commit}`,
  ]).trim();
  const ancestor = git(root, ['merge-base', base, head]).trim();
  const fragments = readFragments(root, head);
  const changed = git(root, ['diff', '--no-renames', '--name-only', '-z', ancestor, head, '--'])
    .split('\0')
    .filter(Boolean);
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
    checkRelease(root, base, head, version, changed);
    return;
  }
  const libraries = readLibraries(root, head);
  const previous = readLibraries(root, ancestor);
  const current = currentVersion(previous);
  currentVersion(libraries);
  for (const library of libraries) {
    if (library.manifest.version !== current.text) {
      throw new Error(`${library.path}: ordinary PR version must stay ${current.text}.`);
    }
  }
  for (const library of previous) {
    if (git(root, ['ls-tree', head, '--', library.path])) {
      const manifest = z
        .object({ version: z.string() })
        .parse(JSON.parse(readRegularFile(root, library.path, head)));
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
