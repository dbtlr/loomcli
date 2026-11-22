import { isDeepStrictEqual } from 'node:util';

import { parse } from 'yaml';

import {
  changelogRewritten,
  fileModeChanged,
  librariesChanged,
  librariesOffTitle,
  lockfileMismatch,
  noCompiledHeading,
  oneCompiledSection,
  onlyVersionField,
  outsideCut,
  sectionNotCompiled,
  skillInvalidYaml,
  skillMissing,
  skillVersionMismatch,
  skillVersionNotString,
  skillVersionUnset,
  skillWithoutFrontmatter,
  skillWithoutVersion,
} from '../commands/pr/messages.js';
import { tagExists } from '../commands/release/messages.js';
import { authoringSkillSource } from '../content/authoring-skill.js';
import { placedSection, releaseDate, releaseInsertion } from './changelog.js';
import { requireSafeCharacters } from './fragments.js';
import { frontmatter } from './managed.js';
import { checkDecisions } from './release-decisions.js';
import { prepareLockfile } from './release-files.js';
import { prepareRelease, requireReleaseNotes } from './release.js';
import {
  currentVersion,
  git,
  gitLine,
  readLibraries,
  readRegularFile,
  readRegularFileBytes,
  workspaceAt,
} from './repository.js';
import type { Checkout, Placement } from './repository.js';

/** The authoring skill `loom init` ships, whose version a release carries. */
const authoringSkillPath = `${authoringSkillSource}/SKILL.md`;

/** The string `metadata.version` of a skill's frontmatter, or the reason there is none. */
function skillVersion(text: string): { reason: string } | { version: string } {
  const source = frontmatter.exec(text)?.groups?.yaml;
  if (source === undefined) {
    return { reason: skillWithoutFrontmatter };
  }
  let data: unknown = undefined;
  try {
    data = parse(source);
  } catch (error) {
    return { reason: skillInvalidYaml(String(error)) };
  }
  const metadata =
    typeof data === 'object' && data !== null && 'metadata' in data ? data.metadata : undefined;
  const version =
    typeof metadata === 'object' && metadata !== null && 'version' in metadata
      ? metadata.version
      : undefined;
  if (version === undefined || version === null) {
    return { reason: skillWithoutVersion };
  }
  return typeof version === 'string' ? { version } : { reason: skillVersionNotString };
}

/**
 * Checks that the authoring skill at the head names the title version as its `metadata.version`.
 * The release diff cannot change the skill, so its review and its version land before the cut.
 */
async function checkSkillVersion(checkout: Checkout, head: string, version: string) {
  let text = '';
  try {
    const location = await workspaceAt(checkout, head);
    text = await readRegularFile(checkout, `${location}${authoringSkillPath}`, head);
  } catch (error) {
    checkout.signal.throwIfAborted();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(skillMissing(authoringSkillPath, reason), { cause: error });
  }
  const found = skillVersion(text);
  if ('reason' in found) {
    throw new Error(skillVersionUnset(authoringSkillPath, found.reason, version));
  }
  if (found.version !== version) {
    throw new Error(skillVersionMismatch(authoringSkillPath, found.version, version));
  }
}

// How many line feeds the text holds.
function lineFeeds(text: string) {
  return text.split('\n').length - 1;
}

/**
 * Refuses a release PR's narrative, which starts at the offset in the changelog's text, when it
 * holds a byte or character a `--narrative` file refuses, naming its line in CHANGELOG.md. The scan
 * reads the file's bytes, because decoding has already replaced the bytes that are not UTF-8. A
 * line feed byte decodes alone, so the text and the bytes break into the same lines.
 */
function requireSafeNarrative(bytes: Buffer, text: string, offset: number, narrative: string) {
  if (narrative === '') {
    return;
  }
  const first = lineFeeds(text.slice(0, offset)) + 1;
  const last = first + lineFeeds(narrative.slice(0, -1));
  requireSafeCharacters('CHANGELOG.md', bytes, 'narrative', { first, last });
}

export async function checkRelease(
  checkout: Checkout,
  base: string,
  head: string,
  version: string,
  diff: { changed: string[]; placement: Placement },
) {
  const { changed } = diff;
  const previous = await readLibraries(checkout, base);
  const libraries = await readLibraries(checkout, head);
  const atBase = await workspaceAt(checkout, base);
  const atHead = await workspaceAt(checkout, head);
  const changelogBytes = await readRegularFileBytes(checkout, `${atHead}CHANGELOG.md`, head);
  const changelog = changelogBytes.toString('utf8');
  const { after, before } = releaseInsertion(
    await readRegularFile(checkout, `${atBase}CHANGELOG.md`, base),
    version,
  );
  if (
    !changelog.startsWith(before) ||
    !changelog.endsWith(after) ||
    changelog.length <= before.length + after.length
  ) {
    throw new Error(changelogRewritten);
  }
  const placed = changelog.slice(before.length, changelog.length - after.length);
  // A section that ends the file lands with one newline; the compiler's own form ends with a blank line.
  const section = after === '' && !placed.endsWith('\n\n') ? `${placed}\n` : placed;
  const dateInput = /^## v0\.\d+\.\d+ - (?<date>\d{4}-\d{2}-\d{2})\n\n/u.exec(section)?.groups
    ?.date;
  if (dateInput === undefined) {
    throw new Error(noCompiledHeading);
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
    throw new Error(librariesOffTitle(version));
  }
  await checkSkillVersion(checkout, head, version);
  if (await gitLine(checkout, ['tag', '--list', `v${version}`])) {
    throw new Error(tagExists(version));
  }
  if (
    !isDeepStrictEqual(
      libraries.map((library) => library.path).toSorted(),
      previous.map((library) => library.path).toSorted(),
    )
  ) {
    throw new Error(librariesChanged);
  }
  for (const library of libraries) {
    const original = previous.find((candidate) => candidate.path === library.path);
    if (!isDeepStrictEqual(library.manifest, { ...original?.manifest, version })) {
      throw new Error(onlyVersionField(library.path));
    }
  }
  const decisions = await checkDecisions(
    checkout,
    base,
    head,
    { date: options.date, version },
    diff,
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
      throw new Error(outsideCut(path));
    }
    const oldEntry = await git(checkout, ['ls-tree', base, '--', path]);
    const newEntry = await git(checkout, ['ls-tree', head, '--', path]);
    const oldMode = oldEntry.slice(0, 6);
    const newMode = newEntry.slice(0, 6);
    if (oldMode && newMode && oldMode !== newMode) {
      throw new Error(fileModeChanged(path));
    }
  }
  if (
    (await readRegularFile(checkout, `${atHead}pnpm-lock.yaml`, head)) !==
    (await prepareLockfile(checkout, release, base))
  ) {
    throw new Error(lockfileMismatch);
  }
  const heading = `## v${release.version} - ${options.date}\n\n`;
  const entries = release.section.slice(heading.length);
  if (!section.startsWith(heading) || !section.endsWith(entries)) {
    throw new Error(sectionNotCompiled);
  }
  const narrative = section.slice(heading.length, section.length - entries.length);
  requireSafeNarrative(changelogBytes, changelog, before.length + heading.length, narrative);
  const compiled = await prepareRelease(
    checkout,
    { ...options, narrative: narrative || undefined },
    base,
  );
  if (placed !== placedSection(compiled.section, after)) {
    throw new Error(oneCompiledSection);
  }
  requireReleaseNotes(compiled);
}
