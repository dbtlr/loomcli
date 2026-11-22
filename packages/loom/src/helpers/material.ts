import { posix } from 'node:path';

import { noVersionCommit } from '../commands/release/messages.js';
import type { Checkout, Libraries, Placement } from './repository.js';
import {
  currentVersion,
  git,
  gitLine,
  gitPaths,
  readParticipants,
  readPlacement,
  requireCoherentLibraries,
  requireFullHistory,
} from './repository.js';

function dependencyName(directory: string, name: string, range: string, libraries: Libraries) {
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
async function synchronizedVersion(checkout: Checkout, ref: string | undefined) {
  if (ref === undefined) {
    return undefined;
  }
  const [first, ...rest] = await readParticipants(checkout, ref);
  if (first === undefined) {
    return undefined;
  }
  return currentVersion(requireCoherentLibraries([first, ...rest])).text;
}

// An abandoned version never receives a tag, so the baseline is the commit that set the current version.
// The walk visits the first-parent commits that touched a participating manifest, newest first.
export async function materialBaseline(
  checkout: Checkout,
  libraries: Libraries,
  version: string,
  head: string,
) {
  await requireFullHistory(checkout);
  const log = await git(checkout, [
    'log',
    '--first-parent',
    '--format=%H %P',
    head,
    '--',
    ...libraries.map((library) => library.path),
  ]);
  const candidates = log.split('\n').flatMap((line) => {
    const [commit, parent] = line.split(' ').filter(Boolean);
    return commit === undefined ? [] : [{ commit, parent }];
  });
  for (const { commit, parent } of candidates) {
    if (
      (await synchronizedVersion(checkout, commit)) === version &&
      (await synchronizedVersion(checkout, parent)) !== version
    ) {
      return commit;
    }
  }
  throw new Error(noVersionCommit(version));
}

/**
 * Root Markdown and docs do not enter the current library build. A path is judged from the root it
 * sits under: a path in the checkout's root from that root, and one outside it, which climbs to the
 * top of the work tree, from the top, so `../README.md` is top-level Markdown as `README.md` is.
 */
export function isBuildAffectingPath(path: string, placement: Placement) {
  // At the top, `up` is empty, so every path is judged as it reads.
  const judged = path.startsWith(placement.up) ? path.slice(placement.up.length) : path;
  return !judged.startsWith('docs/') && !(!judged.includes('/') && /\.md$/iu.test(judged));
}

export async function unchangedLibraries(
  checkout: Checkout,
  libraries: Libraries,
  since: string,
  head?: string,
) {
  const base = await gitLine(checkout, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${since}^{commit}`,
  ]);
  await git(checkout, ['merge-base', '--is-ancestor', base, head ?? 'HEAD']);
  const placement = await readPlacement(checkout);
  const paths = await gitPaths(checkout, placement, [
    'diff',
    '--no-renames',
    '--name-only',
    '-z',
    base,
    ...(head === undefined ? [] : [head]),
    '--',
  ]);
  // Untracked files anywhere in the work tree, as the diff reads it, printed from its top.
  const untracked =
    head === undefined
      ? await gitPaths(checkout, placement, [
          'ls-files',
          '--others',
          '--exclude-standard',
          '--full-name',
          '-z',
          '--',
          placement.up === '' ? '.' : placement.up,
        ])
      : [];
  const changed = new Set<string>();
  for (const path of [...paths, ...untracked].filter(
    (candidate) => !candidate.startsWith('.changes/') && isBuildAffectingPath(candidate, placement),
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
