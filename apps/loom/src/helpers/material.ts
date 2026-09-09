import { posix } from 'node:path';

import type { readLibraries } from './repository.js';
import {
  currentVersion,
  git,
  readParticipants,
  requireCoherentLibraries,
  requireFullHistory,
} from './repository.js';

function dependencyName(
  directory: string,
  name: string,
  range: string,
  libraries: ReturnType<typeof readLibraries>,
) {
  if (!range.startsWith('workspace:')) {
    return name;
  }
  const target = range.slice('workspace:'.length);
  if (target.startsWith('.')) {
    const path = posix.normalize(posix.join(directory, target));
    return libraries.find((library) => library.directory === path)?.manifest.name;
  }
  const separator = target.lastIndexOf('@');
  return separator > 0 ? target.slice(0, separator) : name;
}

// Only a commit that carries no participating manifest has no synchronized version.
// Every other failure of the walk is a defect or a damaged repository, and it propagates.
function synchronizedVersion(root: string, ref: string | undefined) {
  if (ref === undefined) {
    return undefined;
  }
  const [first, ...rest] = readParticipants(root, ref);
  if (first === undefined) {
    return undefined;
  }
  return currentVersion(requireCoherentLibraries([first, ...rest])).text;
}

// An abandoned version never receives a tag, so the baseline is the commit that set the current version.
// The walk visits the first-parent commits that touched a participating manifest, newest first.
export function materialBaseline(
  root: string,
  libraries: ReturnType<typeof readLibraries>,
  version: string,
  head: string,
) {
  requireFullHistory(root);
  const candidates = git(root, [
    'log',
    '--first-parent',
    '--format=%H %P',
    head,
    '--',
    ...libraries.map((library) => library.path),
  ])
    .split('\n')
    .flatMap((line) => {
      const [commit, parent] = line.split(' ').filter(Boolean);
      return commit === undefined ? [] : [{ commit, parent }];
    });
  for (const { commit, parent } of candidates) {
    if (
      synchronizedVersion(root, commit) === version &&
      synchronizedVersion(root, parent) !== version
    ) {
      return commit;
    }
  }
  throw new Error(`No first-parent commit sets version ${version}.`);
}

// Root Markdown and docs do not enter the current library build.
export function isBuildAffectingPath(path: string) {
  return !path.startsWith('docs/') && !(!path.includes('/') && /\.md$/iu.test(path));
}

export function unchangedLibraries(
  root: string,
  libraries: ReturnType<typeof readLibraries>,
  since: string,
  head?: string,
) {
  const base = git(root, ['rev-parse', '--verify', '--end-of-options', `${since}^{commit}`]).trim();
  git(root, ['merge-base', '--is-ancestor', base, head ?? 'HEAD']);
  const paths = git(root, [
    'diff',
    '--no-renames',
    '--name-only',
    '-z',
    base,
    ...(head === undefined ? [] : [head]),
    '--',
  ])
    .split('\0')
    .filter(Boolean);
  const untracked = (
    head === undefined ? git(root, ['ls-files', '--others', '--exclude-standard', '-z']) : ''
  )
    .split('\0')
    .filter(Boolean);
  const changed = new Set<string>();
  for (const path of [...paths, ...untracked].filter(
    (candidate) => !candidate.startsWith('.changes/') && isBuildAffectingPath(candidate),
  )) {
    const owner = libraries.find((library) => path.startsWith(`${library.directory}/`));
    if (!owner) {
      return [];
    }
    changed.add(owner.manifest.name);
  }
  let count = 0;
  do {
    count = changed.size;
    for (const library of libraries) {
      const dependencies = [
        library.manifest.dependencies,
        library.manifest.devDependencies,
        library.manifest.optionalDependencies,
        library.manifest.peerDependencies,
      ].flatMap((group) => Object.entries(group ?? {}));
      for (const [name, range] of dependencies) {
        const target = dependencyName(library.directory, name, range, libraries);
        if (target && changed.has(target)) {
          changed.add(library.manifest.name);
        }
      }
    }
  } while (count !== changed.size);
  return libraries
    .map((library) => library.manifest.name)
    .filter((name) => !changed.has(name))
    .toSorted();
}
