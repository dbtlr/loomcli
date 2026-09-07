import { posix } from 'node:path';

import type { readLibraries } from './repository.js';
import { git } from './repository.js';

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

// Root Markdown and docs do not enter the current library build.
export function isBuildAffectingPath(path: string) {
  return !path.startsWith('docs/') && !(!path.includes('/') && /\.md$/iu.test(path));
}

export function unchangedLibraries(
  root: string,
  libraries: ReturnType<typeof readLibraries>,
  since: string,
) {
  const base = git(root, ['rev-parse', '--verify', '--end-of-options', `${since}^{commit}`]).trim();
  git(root, ['merge-base', '--is-ancestor', base, 'HEAD']);
  const paths = git(root, ['diff', '--no-renames', '--name-only', '-z', base, '--'])
    .split('\0')
    .filter(Boolean);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
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
