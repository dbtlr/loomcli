import { posix } from 'node:path';

import { noVersionCommit } from '../commands/release/messages.js';
import type { Checkout, Libraries, Placement } from './repository.js';
import {
  currentVersion,
  fromTop,
  git,
  gitLine,
  gitPaths,
  readParticipants,
  readPlacement,
  requireCoherentLibraries,
  requireFullHistory,
  workspaceAt,
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

/** One path a diff changed, relative to the checkout's root, with its status and each side's mode and blob. */
interface DiffEntry {
  after: string;
  before: string;
  path: string;
  status: string;
}

/**
 * The paths that changed from the first revision to the second, or to the working tree when only
 * one is given, each with its status and the mode and blob on each side, as `--raw` prints them.
 * The working tree's side of a changed file has no blob yet, so git prints it as zeros.
 */
async function rawDiff(checkout: Checkout, placement: Placement, revisions: string[]) {
  const output = await git(checkout, [
    'diff',
    '--no-renames',
    '--raw',
    '--no-abbrev',
    '-z',
    ...revisions,
    '--',
  ]);
  const fields = output.split('\0');
  const entries: DiffEntry[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [beforeMode, afterMode, beforeBlob, afterBlob, status] = (fields[index] ?? '')
      .slice(1)
      .split(' ');
    entries.push({
      after: `${afterMode} ${afterBlob}`,
      before: `${beforeMode} ${beforeBlob}`,
      path: fromTop(placement, fields[index + 1] ?? ''),
      status: status ?? '',
    });
  }
  return entries;
}

/**
 * The changed paths of a diff from a revision whose workspace sat at `location`, without the moves
 * of the workspace since: a file deleted from that workspace and added, with the same mode and
 * content, at the same path in the workspace directory now has not changed for the workspace. Any
 * other file deleted from that workspace, such as one the move edited as it moved it, is named by
 * its path in the workspace, so the library that owned it counts it. With the workspace where it
 * was, at `''`, no file moved, and every path stays.
 */
function withoutMove(entries: DiffEntry[], location: string) {
  if (location === '') {
    return entries.map((entry) => entry.path);
  }
  const deleted = new Map(
    entries.filter((entry) => entry.status === 'D').map((entry) => [entry.path, entry.before]),
  );
  const moved = new Set<string>();
  for (const entry of entries) {
    const origin = `${location}${entry.path}`;
    if (entry.status === 'A' && deleted.get(origin) === entry.after) {
      moved.add(entry.path).add(origin);
    }
  }
  return entries
    .filter((entry) => !moved.has(entry.path))
    .map((entry) =>
      entry.status === 'D' && entry.path.startsWith(location)
        ? entry.path.slice(location.length)
        : entry.path,
    );
}

/**
 * The paths that changed from `base` to `head`, or to the working tree without one, relative to the
 * checkout's root and without the moves of the workspace since, as `withoutMove` reads them.
 */
export async function changedWithoutMove(
  checkout: Checkout,
  placement: Placement,
  base: string,
  head?: string,
) {
  return withoutMove(
    await rawDiff(checkout, placement, [base, ...(head === undefined ? [] : [head])]),
    await workspaceAt(checkout, base),
  );
}

/**
 * An abandoned version never receives a tag, so the baseline is the commit that set the current
 * version. The walk visits the first-parent commits that touched a participating manifest, newest
 * first, where the workspace sits now or, below the top of the work tree, at the top, where it sat
 * before it moved, and reads each commit's version where that commit's workspace sat.
 */
export async function materialBaseline(
  checkout: Checkout,
  libraries: Libraries,
  version: string,
  head: string,
) {
  await requireFullHistory(checkout);
  const { up } = await readPlacement(checkout);
  const log = await git(checkout, [
    'log',
    '--first-parent',
    '--format=%H %P',
    head,
    '--',
    ...libraries.flatMap((library) =>
      up === '' ? [library.path] : [library.path, `${up}${library.path}`],
    ),
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
 * Beside a workspace below the top, only `.github/` and a top-level file that is not Markdown can
 * affect the build, so a sibling directory such as `rust/` is no build input.
 */
export function isBuildAffectingPath(path: string, placement: Placement) {
  // At the top, `up` is empty, so every path is judged as it reads.
  const outside = placement.up !== '' && path.startsWith(placement.up);
  const judged = outside ? path.slice(placement.up.length) : path;
  const topLevel = !judged.includes('/');
  if (topLevel && /\.md$/iu.test(judged)) {
    return false;
  }
  if (judged.startsWith('docs/')) {
    return false;
  }
  return !outside || topLevel || judged.startsWith('.github/');
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
  const paths = await changedWithoutMove(checkout, placement, base, head);
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
