/*
 * The operator sentences of `loom changelog` and the helpers that serve it, under ADR-0164. `loom pr
 * check` and `loom release cut` load it too. A launch never does. `tests/message-voice.test.ts`
 * holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

import { codeNote } from '../../helpers/messages.js';

const escaped = escapeControlCharacters;

// Changelogs and fragments.

const notCalendarDate = 'Expected a calendar date: YYYY-MM-DD.';

function uncommittedFragment(path: string): string {
  return `${escaped(path)}: commit the fragment before preparing a release.`;
}

const narrativeHeadings = 'Narrative must contain prose without level-one or level-two headings.';

function changelogWithoutTitle(file: string): string {
  return `${escaped(file)} needs a level-one title, so add one such as # Changelog above its release sections.`;
}

function unreleasedSection(file: string, changes: string): string {
  return `${escaped(file)} has an Unreleased section, so move its entries into fragments in ${escaped(changes)}/ and delete the section.`;
}

function sectionExists(file: string, version: string): string {
  return `${escaped(file)} already has a v${escaped(version)} section, so set the version in package.json to the latest release it records and cut again.`;
}

function unclosedBlock(label: string): string {
  return `${escaped(label)}: unclosed Markdown block would swallow later release entries, so close the block, such as a code fence, before the text ends.`;
}

function carriageReturnHeld(name: string, source: string): string {
  return `holds the carriage return ${escaped(name)}. Save the ${escaped(source)} with LF line endings.`;
}

function controlCharacterHeld(name: string, source: string): string {
  return `holds the control character ${escaped(name)}. Remove it, because a ${escaped(source)} accepts no control character but tab and line feed.`;
}

function formatCharacterHeld(name: string): string {
  return `holds the invisible format character ${escaped(name)}. Remove it.`;
}

function unsafeLine(path: string, line: number, sentence: string): string {
  return `${escaped(path)}: line ${String(line)} ${escaped(sentence)}`;
}

function invalidUtf8Line(path: string, line: number, source: string): string {
  return `${escaped(path)}: line ${String(line)} is not valid UTF-8. Save the ${escaped(source)} as UTF-8.`;
}

function expectedBullets(path: string): string {
  return `${escaped(path)}: expected top-level change bullets.`;
}

function expectedMigrationAfterBullets(path: string): string {
  return `${escaped(path)}: expected one ### Migration section after the bullets.`;
}

function expectedOneMigration(path: string): string {
  return `${escaped(path)}: expected one ### Migration section.`;
}

function migrationLabels(path: string, labels: readonly string[]): string {
  return `${escaped(path)}: Migration requires each label once: ${escaped(labels.join(', '))}`;
}

function expectedFragmentFile(path: string, folder: string): string {
  return `${escaped(path)}: expected a fragment file. Keep fragments directly in ${escaped(folder)}/.`;
}

function fragmentUnreadable(path: string, code: string): string {
  return `Cannot read ${escaped(path)}${codeNote(code)}. Check that you can read it, then run the command again.`;
}

function expectedFragmentName(path: string): string {
  return `${escaped(path)}: expected <slug>.md, feature.<slug>.md, or breaking.<slug>.md.`;
}

// Versions and cuts.

function minimumAboveRelease(minimum: string, release: string, current: string): string {
  return `The pending fragments need at least ${escaped(minimum)}, which is above ${escaped(release)}, the release of ${escaped(current)}, so pass --target ${escaped(minimum)} or a higher version.`;
}

function versionCannotAdvance(version: string): string {
  return `The version ${escaped(version)} cannot advance, because the part a cut raises is too large to count up, so set a smaller version in package.json.`;
}

function targetNotVersion(target: string, minimum: string): string {
  return `Target ${escaped(JSON.stringify(target))} is not MAJOR.MINOR.PATCH with an optional -prerelease part, such as 1.2.0 or 1.2.0-rc.1, and the version must be at least ${escaped(minimum)}.`;
}

function targetNotAbove(target: string, current: string, minimum: string): string {
  return `Target ${escaped(target)} must rank above the current version ${escaped(current)} and be at least ${escaped(minimum)}, the least version the pending fragments allow.`;
}

function targetBelowMinimum(target: string, minimum: string, current: string): string {
  return `Target ${escaped(target)} must be at least ${escaped(minimum)}, the least version the pending fragments allow; the current version is ${escaped(current)}.`;
}

function prereleaseNeedsSection(file: string, current: string): string {
  return `A prerelease cut needs ${escaped(file)} to hold the v${escaped(current)} release section, because the prerelease reads its last release there, so cut a stable release first or add the section.`;
}

function invalidPackageVersion(text: string): string {
  return `package.json version ${escaped(JSON.stringify(text))} is not MAJOR.MINOR.PATCH with an optional prerelease part, so set a version such as 1.2.0 or 1.2.0-rc.1.`;
}

function notInRepository(command: string): string {
  return `loom changelog ${escaped(command)} orders fragments by the commits that added them, so run it inside a git repository with the fragments committed.`;
}

function shallowHistory(command: string): string {
  return `loom changelog ${escaped(command)} needs full git history to order the fragments, so fetch it with git fetch --unshallow and run it again.`;
}

function noFragmentsToCut(changes: string): string {
  return `No fragments to release, so add a fragment to ${escaped(changes)}/ first.`;
}

function restoreFailed(failed: readonly string[], stage: string): string {
  return `Restoring ${escaped(failed.join(', '))} failed, so copy the originals back from ${escaped(stage)}.`;
}

function versionNotCut(changelog: string, version: string): string {
  return `${escaped(changelog)} holds no v${escaped(version)} section, so the version has not been cut; run loom changelog write first.`;
}

function notCurrentVersion(version: string, current: string): string {
  return `${escaped(version)} is not the package's current version ${escaped(current)}, so its fragments are not the ones pending; preview a candidate with loom changelog write --target ${escaped(version)} --dry-run.`;
}

function noPendingFragments(changes: string, version: string): string {
  return `No fragments are pending in ${escaped(changes)}/ for ${escaped(version)}, so add a fragment there first.`;
}

// Shared versions.

function sharedVersionRefused(entry: string, problem: string): string {
  return `sharedVersion lists ${escaped(entry)}, which ${escaped(problem)}, so correct the entry or the file and cut again.`;
}

const sharedFileMissing = 'does not exist';

const sharedFileIrregular = 'is not a regular file';

function sharedFileDenied(entry: string): string {
  return `sharedVersion lists ${escaped(entry)}, which cannot be read, because permission was denied. Give your user read access to it, then cut again.`;
}

function sharedFileUnreadable(entry: string, code: string | undefined): string {
  return `sharedVersion lists ${escaped(entry)}, which cannot be read${codeNote(code)}. Check that you can read it, then cut again.`;
}

function sharedFileUnparsed(reason: string): string {
  return `does not parse: ${escaped(reason)}`;
}

const sharedFileWithoutVersion = 'has no version string';

function sharedFileOtherVersion(version: string, current: string): string {
  return `holds version ${escaped(version)}, not ${escaped(current)}`;
}

const sharedVersionNotList =
  'sharedVersion must be a list of nonempty strings, so list package.json files such as ["../hub/package.json"] in the configuration file.';

// Commands: changelog.

function checkedFragments(count: number): string {
  return `Checked ${String(count)} fragment${count === 1 ? '' : 's'}.`;
}

function nextVersion(version: string): string {
  return `Next version: ${escaped(version)}`;
}

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
  fragmentUnreadable,
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
  sharedFileDenied,
  sharedFileIrregular,
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
