/*
 * The operator sentences of `loom changelog`, under ADR-0164: the failures its work and the helpers
 * that serve it raise, which read fragments, the changelog, its Markdown, the shared version, and
 * the version a cut takes, and the lines it prints when it is done. `loom pr check` and
 * `loom release cut` read fragments and the changelog through the same helpers, so their routes
 * load this module too. A launch never loads it, because only the changelog's work and those
 * helpers import it. Each is a function of the values it repeats, or a constant, and the code that
 * raises the failure or writes the line calls it. Every value a sentence repeats is escaped.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** Escapes one value a sentence repeats. */
const escaped = escapeControlCharacters;

// Changelogs and fragments.

/**
 * The failure of a date that is not a calendar date.
 *
 * @example
 * ```ts
 * notCalendarDate; // 'Expected a calendar date: YYYY-MM-DD.'
 * ```
 */
const notCalendarDate = 'Expected a calendar date: YYYY-MM-DD.';

/**
 * The failure of a fragment no commit added.
 *
 * @example
 * ```ts
 * uncommittedFragment('.changes/fix.md');
 * // '.changes/fix.md: commit the fragment before preparing a release.'
 * ```
 */
function uncommittedFragment(path: string): string {
  return `${escaped(path)}: commit the fragment before preparing a release.`;
}

/**
 * The failure of a narrative that is empty or holds a level-one or level-two heading.
 *
 * @example
 * ```ts
 * narrativeHeadings; // 'Narrative must contain prose without level-one or level-two headings.'
 * ```
 */
const narrativeHeadings = 'Narrative must contain prose without level-one or level-two headings.';

/**
 * The failure of a changelog with no level-one title.
 *
 * @example
 * ```ts
 * changelogWithoutTitle('CHANGELOG.md');
 * // 'CHANGELOG.md needs a level-one title, so add one such as # Changelog above its release sections.'
 * ```
 */
function changelogWithoutTitle(file: string): string {
  return `${escaped(file)} needs a level-one title, so add one such as # Changelog above its release sections.`;
}

/**
 * The failure of a changelog that holds an Unreleased section.
 *
 * @example
 * ```ts
 * unreleasedSection('CHANGELOG.md', '.changes');
 * // 'CHANGELOG.md has an Unreleased section, so move its entries into fragments in .changes/ and delete the section.'
 * ```
 */
function unreleasedSection(file: string, changes: string): string {
  return `${escaped(file)} has an Unreleased section, so move its entries into fragments in ${escaped(changes)}/ and delete the section.`;
}

/**
 * The failure of a cut whose version the changelog already records.
 *
 * @example
 * ```ts
 * sectionExists('CHANGELOG.md', '1.2.0');
 * // 'CHANGELOG.md already has a v1.2.0 section, so set the version in package.json ...'
 * ```
 */
function sectionExists(file: string, version: string): string {
  return `${escaped(file)} already has a v${escaped(version)} section, so set the version in package.json to the latest release it records and cut again.`;
}

/**
 * The failure of a Markdown block left open, which would swallow later release entries.
 *
 * @example
 * ```ts
 * unclosedBlock('Narrative'); // 'Narrative: unclosed Markdown block would swallow later release entries.'
 * ```
 */
function unclosedBlock(label: string): string {
  return `${escaped(label)}: unclosed Markdown block would swallow later release entries.`;
}

/**
 * Why a fragment or a narrative refuses a carriage return, named by its code point.
 *
 * @example
 * ```ts
 * carriageReturnHeld('U+000D', 'fragment');
 * // 'holds the carriage return U+000D. Save the fragment with LF line endings.'
 * ```
 */
function carriageReturnHeld(name: string, source: string): string {
  return `holds the carriage return ${escaped(name)}. Save the ${escaped(source)} with LF line endings.`;
}

/**
 * Why a fragment or a narrative refuses a control character, named by its code point.
 *
 * @example
 * ```ts
 * controlCharacterHeld('U+001B', 'fragment');
 * // 'holds the control character U+001B. Remove it, because a fragment accepts ...'
 * ```
 */
function controlCharacterHeld(name: string, source: string): string {
  return `holds the control character ${escaped(name)}. Remove it, because a ${escaped(source)} accepts no control character but tab and line feed.`;
}

/**
 * Why a fragment or a narrative refuses an invisible format character, named by its code point.
 *
 * @example
 * ```ts
 * formatCharacterHeld('U+202E'); // 'holds the invisible format character U+202E. Remove it.'
 * ```
 */
function formatCharacterHeld(name: string): string {
  return `holds the invisible format character ${escaped(name)}. Remove it.`;
}

/**
 * The failure of a line that holds a character a fragment or a narrative refuses, and why.
 *
 * @example
 * ```ts
 * unsafeLine('.changes/fix.md', 3, formatCharacterHeld('U+202E'));
 * // '.changes/fix.md: line 3 holds the invisible format character U+202E. Remove it.'
 * ```
 */
function unsafeLine(path: string, line: number, sentence: string): string {
  return `${escaped(path)}: line ${String(line)} ${escaped(sentence)}`;
}

/**
 * The failure of a line whose bytes are not UTF-8.
 *
 * @example
 * ```ts
 * invalidUtf8Line('.changes/fix.md', 3, 'fragment');
 * // '.changes/fix.md: line 3 is not valid UTF-8. Save the fragment as UTF-8.'
 * ```
 */
function invalidUtf8Line(path: string, line: number, source: string): string {
  return `${escaped(path)}: line ${String(line)} is not valid UTF-8. Save the ${escaped(source)} as UTF-8.`;
}

/**
 * The failure of a fragment without top-level change bullets.
 *
 * @example
 * ```ts
 * expectedBullets('.changes/fix.md'); // '.changes/fix.md: expected top-level change bullets.'
 * ```
 */
function expectedBullets(path: string): string {
  return `${escaped(path)}: expected top-level change bullets.`;
}

/**
 * The failure of a breaking fragment whose Migration section does not follow its bullets.
 *
 * @example
 * ```ts
 * expectedMigrationAfterBullets('.changes/breaking.x.md');
 * // '.changes/breaking.x.md: expected one ### Migration section after the bullets.'
 * ```
 */
function expectedMigrationAfterBullets(path: string): string {
  return `${escaped(path)}: expected one ### Migration section after the bullets.`;
}

/**
 * The failure of a breaking fragment with more than one section after its bullets.
 *
 * @example
 * ```ts
 * expectedOneMigration('.changes/breaking.x.md');
 * // '.changes/breaking.x.md: expected one ### Migration section.'
 * ```
 */
function expectedOneMigration(path: string): string {
  return `${escaped(path)}: expected one ### Migration section.`;
}

/**
 * The failure of a Migration section that does not hold each label once.
 *
 * @example
 * ```ts
 * migrationLabels('.changes/breaking.x.md', ['Why.', 'Steps.']);
 * // '.changes/breaking.x.md: Migration requires each label once: Why., Steps.'
 * ```
 */
function migrationLabels(path: string, labels: readonly string[]): string {
  return `${escaped(path)}: Migration requires each label once: ${escaped(labels.join(', '))}`;
}

/**
 * The failure of a fragment folder entry that is not a file.
 *
 * @example
 * ```ts
 * expectedFragmentFile('.changes/old', '.changes');
 * // '.changes/old: expected a fragment file. Keep fragments directly in .changes/.'
 * ```
 */
function expectedFragmentFile(path: string, folder: string): string {
  return `${escaped(path)}: expected a fragment file. Keep fragments directly in ${escaped(folder)}/.`;
}

/**
 * The failure of a fragment whose name gives no kind.
 *
 * @example
 * ```ts
 * expectedFragmentName('.changes/notes.txt');
 * // '.changes/notes.txt: expected <slug>.md, feature.<slug>.md, or breaking.<slug>.md.'
 * ```
 */
function expectedFragmentName(path: string): string {
  return `${escaped(path)}: expected <slug>.md, feature.<slug>.md, or breaking.<slug>.md.`;
}

// Versions and cuts.

/**
 * The failure of a prerelease cut whose release part is below the fragment minimum.
 *
 * @example
 * ```ts
 * minimumAboveRelease('2.0.0', '1.5.0', '1.5.0-rc.1');
 * // 'The pending fragments need at least 2.0.0, which is above 1.5.0, the release of 1.5.0-rc.1, ...'
 * ```
 */
function minimumAboveRelease(minimum: string, release: string, current: string): string {
  return `The pending fragments need at least ${escaped(minimum)}, which is above ${escaped(release)}, the release of ${escaped(current)}, so pass --target ${escaped(minimum)} or a higher version.`;
}

/**
 * The failure of a version the bump table cannot advance.
 *
 * @example
 * ```ts
 * versionCannotAdvance('1.2.3'); // 'The version 1.2.3 cannot advance.'
 * ```
 */
function versionCannotAdvance(version: string): string {
  return `The version ${escaped(version)} cannot advance.`;
}

/**
 * The failure of a `--target` that is not a version a cut reads.
 *
 * @example
 * ```ts
 * targetNotVersion('v2', '1.3.0');
 * // 'Target "v2" is not MAJOR.MINOR.PATCH with an optional -prerelease part, ...'
 * ```
 */
function targetNotVersion(target: string, minimum: string): string {
  return `Target ${escaped(JSON.stringify(target))} is not MAJOR.MINOR.PATCH with an optional -prerelease part, such as 1.2.0 or 1.2.0-rc.1, and the version must be at least ${escaped(minimum)}.`;
}

/**
 * The failure of a `--target` that does not rank above the current version.
 *
 * @example
 * ```ts
 * targetNotAbove('1.0.0', '1.2.0', '1.3.0');
 * // 'Target 1.0.0 must rank above the current version 1.2.0 and be at least 1.3.0, ...'
 * ```
 */
function targetNotAbove(target: string, current: string, minimum: string): string {
  return `Target ${escaped(target)} must rank above the current version ${escaped(current)} and be at least ${escaped(minimum)}, the least version the pending fragments allow.`;
}

/**
 * The failure of a `--target` whose release part is below the fragment minimum.
 *
 * @example
 * ```ts
 * targetBelowMinimum('1.2.1', '1.3.0', '1.2.0');
 * // 'Target 1.2.1 must be at least 1.3.0, the least version the pending fragments allow; ...'
 * ```
 */
function targetBelowMinimum(target: string, minimum: string, current: string): string {
  return `Target ${escaped(target)} must be at least ${escaped(minimum)}, the least version the pending fragments allow; the current version is ${escaped(current)}.`;
}

/**
 * The failure of a prerelease cut whose changelog lacks the current release's section.
 *
 * @example
 * ```ts
 * prereleaseNeedsSection('CHANGELOG.md', '1.2.0');
 * // 'A prerelease cut needs CHANGELOG.md to hold the v1.2.0 release section, ...'
 * ```
 */
function prereleaseNeedsSection(file: string, current: string): string {
  return `A prerelease cut needs ${escaped(file)} to hold the v${escaped(current)} release section, because the prerelease reads its last release there, so cut a stable release first or add the section.`;
}

/**
 * The failure of a `package.json` version a cut cannot read.
 *
 * @example
 * ```ts
 * invalidPackageVersion('next');
 * // 'package.json version "next" is not MAJOR.MINOR.PATCH with an optional prerelease part, ...'
 * ```
 */
function invalidPackageVersion(text: string): string {
  return `package.json version ${escaped(JSON.stringify(text))} is not MAJOR.MINOR.PATCH with an optional prerelease part, so set a version such as 1.2.0 or 1.2.0-rc.1.`;
}

/**
 * The failure of a changelog command run outside a git repository.
 *
 * @example
 * ```ts
 * notInRepository('write');
 * // 'loom changelog write orders fragments by the commits that added them, ...'
 * ```
 */
function notInRepository(command: string): string {
  return `loom changelog ${escaped(command)} orders fragments by the commits that added them, so run it inside a git repository with the fragments committed.`;
}

/**
 * The failure of a changelog command run in a shallow clone.
 *
 * @example
 * ```ts
 * shallowHistory('notes');
 * // 'loom changelog notes needs full git history to order the fragments, ...'
 * ```
 */
function shallowHistory(command: string): string {
  return `loom changelog ${escaped(command)} needs full git history to order the fragments, so fetch it with git fetch --unshallow and run it again.`;
}

/**
 * The failure of a package cut with no pending fragment.
 *
 * @example
 * ```ts
 * noFragmentsToCut('.changes');
 * // 'No fragments to release, so add a fragment to .changes/ first.'
 * ```
 */
function noFragmentsToCut(changes: string): string {
  return `No fragments to release, so add a fragment to ${escaped(changes)}/ first.`;
}

/**
 * The failure of a cut that could not put the originals back after a failed write.
 *
 * @example
 * ```ts
 * restoreFailed(['/app/package.json'], '/tmp/loom-cut');
 * // 'Restoring /app/package.json failed, so copy the originals back from /tmp/loom-cut.'
 * ```
 */
function restoreFailed(failed: readonly string[], stage: string): string {
  return `Restoring ${escaped(failed.join(', '))} failed, so copy the originals back from ${escaped(stage)}.`;
}

/**
 * The failure of `loom changelog notes` for a version the changelog does not hold.
 *
 * @example
 * ```ts
 * versionNotCut('CHANGELOG.md', '1.2.0');
 * // 'CHANGELOG.md holds no v1.2.0 section, so the version has not been cut; ...'
 * ```
 */
function versionNotCut(changelog: string, version: string): string {
  return `${escaped(changelog)} holds no v${escaped(version)} section, so the version has not been cut; run loom changelog write first.`;
}

/**
 * The failure of `loom changelog notes` for a prerelease that is not the current version.
 *
 * @example
 * ```ts
 * notCurrentVersion('1.3.0-rc.1', '1.3.0-rc.2');
 * // "1.3.0-rc.1 is not the package's current version 1.3.0-rc.2, ..."
 * ```
 */
function notCurrentVersion(version: string, current: string): string {
  return `${escaped(version)} is not the package's current version ${escaped(current)}, so its fragments are not the ones pending; preview a candidate with loom changelog write --target ${escaped(version)} --dry-run.`;
}

/**
 * The failure of `loom changelog notes` for a prerelease with no pending fragment.
 *
 * @example
 * ```ts
 * noPendingFragments('.changes', '1.3.0-rc.1');
 * // 'No fragments are pending in .changes/ for 1.3.0-rc.1.'
 * ```
 */
function noPendingFragments(changes: string, version: string): string {
  return `No fragments are pending in ${escaped(changes)}/ for ${escaped(version)}.`;
}

// Shared versions.

/**
 * The failure of a `sharedVersion` entry that cannot carry the version, and why.
 *
 * @example
 * ```ts
 * sharedVersionRefused('../hub/package.json', sharedFileMissing);
 * // 'sharedVersion lists ../hub/package.json, which does not exist, so correct the entry ...'
 * ```
 */
function sharedVersionRefused(entry: string, problem: string): string {
  return `sharedVersion lists ${escaped(entry)}, which ${escaped(problem)}, so correct the entry or the file and cut again.`;
}

/**
 * Why a `sharedVersion` entry names a file that does not exist.
 *
 * @example
 * ```ts
 * sharedFileMissing; // 'does not exist'
 * ```
 */
const sharedFileMissing = 'does not exist';

/**
 * Why a `sharedVersion` entry names a file that cannot be read.
 *
 * @example
 * ```ts
 * sharedFileUnreadable('EACCES: permission denied'); // 'cannot be read: EACCES: permission denied'
 * ```
 */
function sharedFileUnreadable(reason: string): string {
  return `cannot be read: ${escaped(reason)}`;
}

/**
 * Why a `sharedVersion` entry names a file that does not parse.
 *
 * @example
 * ```ts
 * sharedFileUnparsed('package.json is not a JSON object, ...');
 * // 'does not parse: package.json is not a JSON object, ...'
 * ```
 */
function sharedFileUnparsed(reason: string): string {
  return `does not parse: ${escaped(reason)}`;
}

/**
 * Why a `sharedVersion` entry names a file with no version string.
 *
 * @example
 * ```ts
 * sharedFileWithoutVersion; // 'has no version string'
 * ```
 */
const sharedFileWithoutVersion = 'has no version string';

/**
 * Why a `sharedVersion` entry names a file at another version.
 *
 * @example
 * ```ts
 * sharedFileOtherVersion('1.1.0', '1.2.0'); // 'holds version 1.1.0, not 1.2.0'
 * ```
 */
function sharedFileOtherVersion(version: string, current: string): string {
  return `holds version ${escaped(version)}, not ${escaped(current)}`;
}

/**
 * The failure of a `sharedVersion` value that is not a list of nonempty strings.
 *
 * @example
 * ```ts
 * sharedVersionNotList; // 'sharedVersion must be a list of nonempty strings, ...'
 * ```
 */
const sharedVersionNotList =
  'sharedVersion must be a list of nonempty strings, so list package.json files such as ["../hub/package.json"] in the configuration file.';

// Commands: changelog.

/**
 * The confirmation of `loom changelog check`.
 *
 * @example
 * ```ts
 * checkedFragments(1); // 'Checked 1 fragment.'
 * ```
 */
function checkedFragments(count: number): string {
  return `Checked ${String(count)} fragment${count === 1 ? '' : 's'}.`;
}

/**
 * The line of `loom changelog write` that names the version it cut.
 *
 * @example
 * ```ts
 * nextVersion('1.3.0'); // 'Next version: 1.3.0'
 * ```
 */
function nextVersion(version: string): string {
  return `Next version: ${escaped(version)}`;
}

/**
 * The line of a prerelease cut that counts the fragments it leaves pending.
 *
 * @example
 * ```ts
 * pendingFragments(2, '1.3.0'); // '2 fragments stay pending for 1.3.0.'
 * ```
 */
function pendingFragments(count: number, release: string): string {
  return `${String(count)} ${count === 1 ? 'fragment stays' : 'fragments stay'} pending for ${escaped(release)}.`;
}

export {
  carriageReturnHeld,
  changelogWithoutTitle,
  checkedFragments,
  controlCharacterHeld,
  expectedBullets,
  expectedFragmentFile,
  expectedFragmentName,
  expectedMigrationAfterBullets,
  expectedOneMigration,
  formatCharacterHeld,
  invalidPackageVersion,
  invalidUtf8Line,
  migrationLabels,
  minimumAboveRelease,
  narrativeHeadings,
  nextVersion,
  noFragmentsToCut,
  noPendingFragments,
  notCalendarDate,
  notCurrentVersion,
  notInRepository,
  pendingFragments,
  prereleaseNeedsSection,
  restoreFailed,
  sectionExists,
  shallowHistory,
  sharedFileMissing,
  sharedFileOtherVersion,
  sharedFileUnparsed,
  sharedFileUnreadable,
  sharedFileWithoutVersion,
  sharedVersionNotList,
  sharedVersionRefused,
  targetBelowMinimum,
  targetNotAbove,
  targetNotVersion,
  unclosedBlock,
  uncommittedFragment,
  unreleasedSection,
  unsafeLine,
  versionCannotAdvance,
  versionNotCut,
};
