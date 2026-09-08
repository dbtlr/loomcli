import { isDeepStrictEqual } from 'node:util';

import { prepareLockfile, releaseInsertion } from './release-files.js';
import { prepareRelease, releaseDate } from './release.js';
import { currentVersion, git, readLibraries, readRegularFile } from './repository.js';

export function checkRelease(
  root: string,
  base: string,
  head: string,
  version: string,
  changed: string[],
  retained = false,
) {
  const previous = readLibraries(root, base);
  const libraries = readLibraries(root, head);
  const changelog = readRegularFile(root, 'CHANGELOG.md', head);
  const { after, before } = releaseInsertion(readRegularFile(root, 'CHANGELOG.md', base), version);
  if (
    !changelog.startsWith(before) ||
    !changelog.endsWith(after) ||
    changelog.length <= before.length + after.length
  ) {
    throw new Error('CHANGELOG.md must preserve its introduction and earlier releases.');
  }
  const section = changelog.slice(before.length, changelog.length - after.length);
  const dateInput = /^## v0\.\d+\.\d+ - (?<date>\d{4}-\d{2}-\d{2})\n\n/u.exec(section)?.groups
    ?.date;
  if (dateInput === undefined) {
    throw new Error('CHANGELOG.md requires a compiled release heading and date.');
  }
  const options = {
    date: releaseDate(dateInput),
    initial: currentVersion(previous).text === '0.0.0',
    narrative: undefined,
    since: undefined,
  };
  const release = prepareRelease(root, options, base);
  if (version !== release.version) {
    throw new Error(
      `Release version must be ${release.version}; replacement overrides are not supported.`,
    );
  }
  if (currentVersion(libraries).text !== version) {
    throw new Error(`Every participating library must carry title version ${version}.`);
  }
  if (git(root, ['tag', '--list', `v${version}`]).trim()) {
    if (!retained) {
      throw new Error(`Tag v${version} already exists.`);
    }
    const tag = `refs/tags/v${version}`;
    if (
      git(root, ['cat-file', '-t', tag]).trim() !== 'tag' ||
      git(root, ['rev-parse', `${tag}^{commit}`]).trim() !== head
    ) {
      throw new Error(`Tag v${version} must be annotated at the retained source SHA.`);
    }
  }
  if (
    !isDeepStrictEqual(
      libraries.map((library) => library.path).toSorted(),
      previous.map((library) => library.path).toSorted(),
    )
  ) {
    throw new Error('Release cuts cannot change participating libraries.');
  }
  for (const library of libraries) {
    const original = previous.find((candidate) => candidate.path === library.path);
    if (!isDeepStrictEqual(library.manifest, { ...original?.manifest, version })) {
      throw new Error(`${library.path}: release cuts change only the version field.`);
    }
  }
  const allowed = new Set([
    'CHANGELOG.md',
    'pnpm-lock.yaml',
    ...libraries.map((library) => library.path),
    ...release.fragments.map((fragment) => `.changes/${fragment.name}`),
  ]);
  for (const path of changed) {
    if (!allowed.has(path)) {
      throw new Error(`${path}: outside the release cut.`);
    }
    const oldMode = git(root, ['ls-tree', base, '--', path]).slice(0, 6);
    const newMode = git(root, ['ls-tree', head, '--', path]).slice(0, 6);
    if (oldMode && newMode && oldMode !== newMode) {
      throw new Error(`${path}: release cuts cannot change a file mode.`);
    }
  }
  if (readRegularFile(root, 'pnpm-lock.yaml', head) !== prepareLockfile(root, release, base)) {
    throw new Error(
      'pnpm-lock.yaml must match the version writer; unrelated lockfile changes need an ordinary PR.',
    );
  }
  const heading = `## v${release.version} - ${options.date}\n\n`;
  const entries = release.section.slice(heading.length);
  if (!section.startsWith(heading) || !section.endsWith(entries)) {
    throw new Error('CHANGELOG.md must contain the compiler output for the consumed fragments.');
  }
  const narrative = section.slice(heading.length, section.length - entries.length);
  if (
    section !==
    prepareRelease(root, { ...options, narrative: narrative || undefined }, base).section
  ) {
    throw new Error('CHANGELOG.md must contain exactly one compiled release section.');
  }
}
