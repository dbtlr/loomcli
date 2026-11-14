import { isDeepStrictEqual } from 'node:util';

import { parse } from 'yaml';

import { authoringSkillSource } from '../content/authoring-skill.js';
import { placedSection, releaseDate, releaseInsertion } from './changelog.js';
import { frontmatter } from './managed.js';
import { checkDecisions } from './release-decisions.js';
import { prepareLockfile } from './release-files.js';
import { prepareRelease, requireReleaseNotes } from './release.js';
import { currentVersion, git, gitLine, readLibraries, readRegularFile } from './repository.js';
import type { Checkout } from './repository.js';

/** The authoring skill `loom init` ships, whose version a release carries. */
const authoringSkillPath = `${authoringSkillSource}/SKILL.md`;

/** The string `metadata.version` of a skill's frontmatter, or the reason there is none. */
function skillVersion(text: string): { reason: string } | { version: string } {
  const source = frontmatter.exec(text)?.groups?.yaml;
  if (source === undefined) {
    return { reason: 'has no YAML frontmatter' };
  }
  let data: unknown = undefined;
  try {
    data = parse(source);
  } catch (error) {
    return { reason: `has frontmatter that is not valid YAML: ${String(error)}` };
  }
  const metadata =
    typeof data === 'object' && data !== null && 'metadata' in data ? data.metadata : undefined;
  const version =
    typeof metadata === 'object' && metadata !== null && 'version' in metadata
      ? metadata.version
      : undefined;
  if (version === undefined || version === null) {
    return { reason: 'has no metadata.version' };
  }
  return typeof version === 'string'
    ? { version }
    : { reason: 'has a metadata.version that is not a string, so quote it' };
}

/**
 * Checks that the authoring skill at the head names the title version as its `metadata.version`.
 * The release diff cannot change the skill, so its review and its version land before the cut.
 */
async function checkSkillVersion(checkout: Checkout, head: string, version: string) {
  let text = '';
  try {
    text = await readRegularFile(checkout, authoringSkillPath, head);
  } catch (error) {
    checkout.signal.throwIfAborted();
    throw new Error(
      `${authoringSkillPath} must exist at the head of a release PR as a regular file, so add it in an ordinary PR before the cut: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const found = skillVersion(text);
  if ('reason' in found) {
    throw new Error(
      `${authoringSkillPath} ${found.reason}. Set its metadata.version to "${version}" in an ordinary PR before the cut.`,
    );
  }
  if (found.version !== version) {
    throw new Error(
      `${authoringSkillPath} carries metadata.version ${found.version}, not title version ${version}. Review the skill against the release and set its metadata.version to "${version}" in an ordinary PR before the cut.`,
    );
  }
}

export async function checkRelease(
  checkout: Checkout,
  base: string,
  head: string,
  version: string,
  changed: string[],
) {
  const previous = await readLibraries(checkout, base);
  const libraries = await readLibraries(checkout, head);
  const changelog = await readRegularFile(checkout, 'CHANGELOG.md', head);
  const { after, before } = releaseInsertion(
    await readRegularFile(checkout, 'CHANGELOG.md', base),
    version,
  );
  if (
    !changelog.startsWith(before) ||
    !changelog.endsWith(after) ||
    changelog.length <= before.length + after.length
  ) {
    throw new Error('CHANGELOG.md must preserve its introduction and earlier releases.');
  }
  const placed = changelog.slice(before.length, changelog.length - after.length);
  // A section that ends the file lands with one newline; the compiler's own form ends with a blank line.
  const section = after === '' && !placed.endsWith('\n\n') ? `${placed}\n` : placed;
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
    target: version,
  };
  const release = await prepareRelease(checkout, options, base);
  if (currentVersion(libraries).text !== version) {
    throw new Error(`Every participating library must carry title version ${version}.`);
  }
  await checkSkillVersion(checkout, head, version);
  if (await gitLine(checkout, ['tag', '--list', `v${version}`])) {
    throw new Error(`Tag v${version} already exists.`);
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
  const decisions = await checkDecisions(
    checkout,
    base,
    head,
    { date: options.date, version },
    changed,
  );
  const allowed = new Set([
    'CHANGELOG.md',
    'pnpm-lock.yaml',
    ...libraries.map((library) => library.path),
    ...release.fragments.map((fragment) => `.changes/${fragment.name}`),
    ...decisions,
  ]);
  for (const path of changed) {
    if (!allowed.has(path)) {
      throw new Error(`${path}: outside the release cut.`);
    }
    const oldEntry = await git(checkout, ['ls-tree', base, '--', path]);
    const newEntry = await git(checkout, ['ls-tree', head, '--', path]);
    const oldMode = oldEntry.slice(0, 6);
    const newMode = newEntry.slice(0, 6);
    if (oldMode && newMode && oldMode !== newMode) {
      throw new Error(`${path}: release cuts cannot change a file mode.`);
    }
  }
  if (
    (await readRegularFile(checkout, 'pnpm-lock.yaml', head)) !==
    (await prepareLockfile(checkout, release, base))
  ) {
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
  const compiled = await prepareRelease(
    checkout,
    { ...options, narrative: narrative || undefined },
    base,
  );
  if (placed !== placedSection(compiled.section, after)) {
    throw new Error('CHANGELOG.md must contain exactly one compiled release section.');
  }
  requireReleaseNotes(compiled);
}
