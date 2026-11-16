/*
 * The operator sentences of the `loom` bin, under ADR-0164: the issues its option and argument
 * validators report, the failures its commands and helpers raise, the questions and warnings
 * `loom init` writes, the lines a release record and a release plan print, and the confirmation
 * each command prints when it is done. The commands keep theirs here too, because a run loads no
 * module under `src/commands` but the declarations and the routed command's own work. Each is a
 * function of the values it repeats, or a constant, and the code that raises the failure or writes
 * the line calls it. Every value a sentence repeats is escaped, except `output`: the text another
 * program, a service, or another failure wrote, which a sentence repeats whole, its lines included.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** Escapes one value a sentence repeats. */
const escaped = escapeControlCharacters;

// Application readers.

/**
 * The failure of `loom init`'s read of a package that does not resolve `@loomcli/core`.
 *
 * @example
 * ```ts
 * coreUnresolved('src/application.ts');
 * // '@loomcli/core does not resolve from the package, so install it before init reads src/application.ts.'
 * ```
 */
function coreUnresolved(module: string): string {
  return `@loomcli/core does not resolve from the package, so install it before init reads ${escaped(module)}.`;
}

/**
 * The failure of `loom init`'s read of a package whose `@loomcli/core` exports no Application.
 *
 * @example
 * ```ts
 * coreWithoutApplication('src/application.ts');
 * // 'The @loomcli/core the package resolves exports no Application to read src/application.ts with.'
 * ```
 */
function coreWithoutApplication(module: string): string {
  return `The @loomcli/core the package resolves exports no Application to read ${escaped(module)} with.`;
}

/**
 * The failure of `loom init`'s read of a module that exports no Application.
 *
 * @example
 * ```ts
 * noApplicationExport('src/application.ts');
 * // 'src/application.ts exports no Application, so export the Application the entry runs.'
 * ```
 */
function noApplicationExport(module: string): string {
  return `${escaped(module)} exports no Application, so export the Application the entry runs.`;
}

/**
 * The failure of `loom init`'s read of a module that exports more than one Application.
 *
 * @example
 * ```ts
 * manyApplicationExports('src/application.ts', 2);
 * // 'src/application.ts exports 2 Applications, so export one Application from it.'
 * ```
 */
function manyApplicationExports(module: string, count: number): string {
  return `${escaped(module)} exports ${String(count)} Applications, so export one Application from it.`;
}

/**
 * The failure of a reader process that ended without a result: what Bun wrote, then the sentence.
 *
 * @example
 * ```ts
 * bunCouldNotRead('error: Cannot find module', 'src/application.ts');
 * // 'error: Cannot find module\n\nBun could not read src/application.ts.'
 * ```
 */
function bunCouldNotRead(output: string, module: string): string {
  return `${output}\n\nBun could not read ${escaped(module)}.`;
}

/**
 * The failure of a skills registry this `loom` cannot read.
 *
 * @example
 * ```ts
 * unreadableSkillsRegistry; // 'This @loomcli/loom cannot read the skills() calls ...'
 * ```
 */
const unreadableSkillsRegistry =
  'This @loomcli/loom cannot read the skills() calls the installed @loomcli/plugins recorded, so install @loomcli/plugins and @loomcli/loom at one version, and build again.';

/**
 * The failure of an application module whose `skills()` calls name two folders.
 *
 * @example
 * ```ts
 * twoSkillsFolders('src/application.ts', '/app/skills', '/app/more');
 * // 'src/application.ts calls skills() with two folders, /app/skills and /app/more, ...'
 * ```
 */
function twoSkillsFolders(module: string, first: string, second: string): string {
  return `${escaped(module)} calls skills() with two folders, ${escaped(first)} and ${escaped(second)}, and a build carries one, so name one folder.`;
}

/**
 * The failure of a skills folder the plugin's judging refused: the plugin's own report, then the
 * sentence naming the folder.
 *
 * @example
 * ```ts
 * skillsFolderJudged('Skill "notes" has no SKILL.md.', '/app/skills');
 * // 'Skill "notes" has no SKILL.md.\n\nloom build judged the skills folder /app/skills and built nothing.'
 * ```
 */
function skillsFolderJudged(output: string, folder: string): string {
  return `${output}\n\nloom build judged the skills folder ${escaped(folder)} and built nothing.`;
}

// Build facts and targets.

/**
 * The failure of a release build whose `package.json` names no repository.
 *
 * @example
 * ```ts
 * noRepositoryField; // 'package.json has no repository field, so pass --repository <owner/name> ...'
 * ```
 */
const noRepositoryField =
  'package.json has no repository field, so pass --repository <owner/name> to name the repository the release belongs to.';

/**
 * The failure of a release build whose `repository` field does not read as owner/name.
 *
 * @example
 * ```ts
 * unreadableRepositoryField; // 'The package.json repository field does not read as owner/name, ...'
 * ```
 */
const unreadableRepositoryField =
  'The package.json repository field does not read as owner/name, so pass --repository <owner/name>.';

/**
 * The failure of a release build whose `package.json` has no version.
 *
 * @example
 * ```ts
 * noVersionField; // 'package.json has no version field, so set version to build a release.'
 * ```
 */
const noVersionField = 'package.json has no version field, so set version to build a release.';

/**
 * The failure of a release build whose `package.json` version is not a semantic version.
 *
 * @example
 * ```ts
 * invalidVersionField('next');
 * // 'The package.json version field "next" is not a semantic version, so set it to one, such as 1.0.0.'
 * ```
 */
function invalidVersionField(version: unknown): string {
  return `The package.json version field ${escaped(JSON.stringify(version))} is not a semantic version, so set it to one, such as 1.0.0.`;
}

/**
 * The failure of a build that needs the application's name when `bin` names none.
 *
 * @example
 * ```ts
 * noBinName; // 'package.json names no application in bin, a string or an object with one key, ...'
 * ```
 */
const noBinName =
  'package.json names no application in bin, a string or an object with one key, so pass --name <name>.';

/**
 * The failure of a scaffold whose `package.json` names no application.
 *
 * @example
 * ```ts
 * noApplicationName; // 'package.json names no application in bin or name, ...'
 * ```
 */
const noApplicationName =
  'package.json names no application in bin or name, so set its name field and run loom init again.';

/**
 * The sentence every refused target ends with, naming the targets a build accepts.
 *
 * @example
 * ```ts
 * acceptedTargets; // 'Use node, bun, or a Bun compile target bun-<os>-<arch> ...'
 * ```
 */
const acceptedTargets =
  'Use node, bun, or a Bun compile target bun-<os>-<arch> for linux or darwin on x64 or arm64, with -musl on linux and -baseline or -modern on x64, such as bun-linux-x64.';

/**
 * The issue of a `--target` value a build refuses, then the targets it accepts.
 *
 * @example
 * ```ts
 * refusedTarget('wasm'); // '"wasm" is not a target. Use node, bun, ...'
 * ```
 */
function refusedTarget(value: string): string {
  const problem =
    value === 'browser'
      ? 'browser is refused, because a Loom application runs as a command.'
      : `${escaped(JSON.stringify(value))} is not a target.`;
  return [problem, acceptedTargets].join(' ');
}

/**
 * The failure of a build on a host Bun compiles for no target on.
 *
 * @example
 * ```ts
 * noHostTarget('bun-win32-x64'); // 'Bun compiles for no target on this host (bun-win32-x64), so pass --target.'
 * ```
 */
function noHostTarget(name: string): string {
  return `Bun compiles for no target on this host (${escaped(name)}), so pass --target.`;
}

// Bun.

/**
 * The failure of a command that needs Bun when none is on the PATH.
 *
 * @example
 * ```ts
 * missingBun; // 'Bun is not on the PATH, and loom build and loom init do their work under Bun. ...'
 * ```
 */
const missingBun =
  'Bun is not on the PATH, and loom build and loom init do their work under Bun. Install Bun from https://bun.sh and run the command again.';

/**
 * The failure of a build Bun refused: what Bun wrote, then the sentence.
 *
 * @example
 * ```ts
 * bunBuildFailed('error: Could not resolve "x"');
 * // 'error: Could not resolve "x"\n\nBun could not build the application, so no output changed.'
 * ```
 */
function bunBuildFailed(output: string): string {
  return `${output}\n\nBun could not build the application, so no output changed.`;
}

/**
 * The failure of a watch build whose Bun exited with an error.
 *
 * @example
 * ```ts
 * watchExited(1); // 'bun build --watch exited with 1.'
 * ```
 */
function watchExited(code: number): string {
  return `bun build --watch exited with ${String(code)}.`;
}

// Modules and the package directory.

/**
 * The failure of a module an option, a key, or a convention places where none exists.
 *
 * @example
 * ```ts
 * missingModule('src/main.ts', '--entry');
 * // 'src/main.ts does not exist, so create it or name the module with --entry.'
 * ```
 */
function missingModule(path: string, naming: string): string {
  return `${escaped(path)} does not exist, so create it or name the module with ${escaped(naming)}.`;
}

/**
 * The failure of a `loom` command run outside a package.
 *
 * @example
 * ```ts
 * noPackageJson('/tmp'); // 'No package.json at or above /tmp. Run loom inside a package directory.'
 * ```
 */
function noPackageJson(cwd: string): string {
  return `No package.json at or above ${escaped(cwd)}. Run loom inside a package directory.`;
}

// Manifests.

/**
 * The failure of a `package.json` with no version string where a cut sets one.
 *
 * @example
 * ```ts
 * expectedVersionString; // 'package.json: expected a version string.'
 * ```
 */
const expectedVersionString = 'package.json: expected a version string.';

/**
 * The failure of a `package.json` that is not JSON, where the scanner found no position.
 *
 * @example
 * ```ts
 * manifestNotJson('package.json');
 * // 'package.json is not valid JSON, so fix it there and run loom again.'
 * ```
 */
function manifestNotJson(path: string): string {
  return `${escaped(path)} is not valid JSON, so fix it there and run loom again.`;
}

/**
 * The failure of a `package.json` that is not JSON, naming where it breaks and what JSON needs.
 *
 * @example
 * ```ts
 * manifestNotJsonAt('package.json', { column: 7, expected: 'a value', line: 3 });
 * // 'package.json is not valid JSON: line 3, column 7 needs a value, so fix it there and run loom again.'
 * ```
 */
function manifestNotJsonAt(
  path: string,
  { column, expected, line }: { column: number; expected: string; line: number },
): string {
  return `${escaped(path)} is not valid JSON: line ${String(line)}, column ${String(column)} needs ${escaped(expected)}, so fix it there and run loom again.`;
}

/**
 * The failure of a `package.json` that is JSON but not an object.
 *
 * @example
 * ```ts
 * manifestNotObject('package.json');
 * // 'package.json is not a JSON object, so write its fields between { and } and run loom again.'
 * ```
 */
function manifestNotObject(path: string): string {
  return `${escaped(path)} is not a JSON object, so write its fields between { and } and run loom again.`;
}

/**
 * The issue of a manifest value that is not a JSON object.
 *
 * @example
 * ```ts
 * notAnObject; // 'Invalid type: Expected Object'
 * ```
 */
const notAnObject = 'Invalid type: Expected Object';

/**
 * The issue of a manifest map's value that is not a string.
 *
 * @example
 * ```ts
 * notAString(3); // 'Invalid type: Expected string but received 3'
 * ```
 */
function notAString(value: unknown): string {
  return `Invalid type: Expected string but received ${escaped(JSON.stringify(value))}`;
}

/**
 * The issue of a post-install declaration whose words are not a list of strings.
 *
 * @example
 * ```ts
 * notAWordList; // 'Expected a non-empty array of strings'
 * ```
 */
const notAWordList = 'Expected a non-empty array of strings';

/**
 * The warning a managed file draws once its content no longer matches its header.
 *
 * @example
 * ```ts
 * driftedManagedFile('.changes/README.md');
 * // 'warning: .changes/README.md differs from what loom init wrote. Run loom init --force ...'
 * ```
 */
function driftedManagedFile(path: string): string {
  return `warning: ${escaped(path)} differs from what loom init wrote. Run loom init --force to restore it, or delete its header to keep your edits.`;
}

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

// Repository reads.

/**
 * The failure of a git command, with what git wrote to stderr.
 *
 * @example
 * ```ts
 * gitFailed('show', "fatal: invalid object name 'v1'.");
 * // "git show failed: fatal: invalid object name 'v1'."
 * ```
 */
function gitFailed(command: string, output: string): string {
  return `git ${escaped(command)} failed: ${output}`;
}

/**
 * The failure of a path that is not a regular file.
 *
 * @example
 * ```ts
 * expectedRegularFile('CHANGELOG.md'); // 'CHANGELOG.md: expected a regular file.'
 * ```
 */
function expectedRegularFile(path: string): string {
  return `${escaped(path)}: expected a regular file.`;
}

/**
 * The failure of a release preparation in a shallow clone.
 *
 * @example
 * ```ts
 * releaseShallow; // 'Release preparation requires full Git history.'
 * ```
 */
const releaseShallow = 'Release preparation requires full Git history.';

/**
 * The failure of a package directory that is a symbolic link.
 *
 * @example
 * ```ts
 * symlinkedPackage('core'); // 'packages/core: symlinks are not supported.'
 * ```
 */
function symlinkedPackage(name: string): string {
  return `packages/${escaped(name)}: symlinks are not supported.`;
}

/**
 * The failure of two publishable libraries with one name.
 *
 * @example
 * ```ts
 * libraryNamesRepeat; // 'Publishable library names must be unique.'
 * ```
 */
const libraryNamesRepeat = 'Publishable library names must be unique.';

/**
 * The failure of publishable libraries at different versions.
 *
 * @example
 * ```ts
 * libraryVersionsDiffer; // 'Publishable library versions must match.'
 * ```
 */
const libraryVersionsDiffer = 'Publishable library versions must match.';

/**
 * The failure of a repository with no publishable library.
 *
 * @example
 * ```ts
 * noLibraries; // 'No publishable libraries in packages/*.'
 * ```
 */
const noLibraries = 'No publishable libraries in packages/*.';

/**
 * The failure of library versions that are not stable 0.x versions.
 *
 * @example
 * ```ts
 * unstableLibraryVersions; // 'Library versions must be stable 0.x versions.'
 * ```
 */
const unstableLibraryVersions = 'Library versions must be stable 0.x versions.';

/**
 * The failure of a version no first-parent commit sets.
 *
 * @example
 * ```ts
 * noVersionCommit('0.4.0'); // 'No first-parent commit sets version 0.4.0.'
 * ```
 */
function noVersionCommit(version: string): string {
  return `No first-parent commit sets version ${escaped(version)}.`;
}

// Synchronized releases.

/**
 * The failure of `--initial` on libraries past 0.0.0.
 *
 * @example
 * ```ts
 * initialNeedsZero; // '--initial requires library version 0.0.0.'
 * ```
 */
const initialNeedsZero = '--initial requires library version 0.0.0.';

/**
 * The failure of a synchronized cut with no fragment.
 *
 * @example
 * ```ts
 * noFragments; // 'No fragments to release.'
 * ```
 */
const noFragments = 'No fragments to release.';

/**
 * The failure of a synchronized release target that is not a stable 0.x version.
 *
 * @example
 * ```ts
 * stableTargetOnly; // 'Release target must be a stable 0.x version.'
 * ```
 */
const stableTargetOnly = 'Release target must be a stable 0.x version.';

/**
 * The failure of a synchronized release target below the minimum.
 *
 * @example
 * ```ts
 * targetBelowRelease('0.5.0', '0.4.2');
 * // 'Release target must be at least 0.5.0; current version is 0.4.2.'
 * ```
 */
function targetBelowRelease(minimum: string, current: string): string {
  return `Release target must be at least ${escaped(minimum)}; current version is ${escaped(current)}.`;
}

/**
 * The failure of a release that carries no entries and no narrative.
 *
 * @example
 * ```ts
 * releaseWithoutEntries('0.1.0');
 * // 'Release v0.1.0 carries no entries, so it requires a narrative for its notes.'
 * ```
 */
function releaseWithoutEntries(version: string): string {
  return `Release v${escaped(version)} carries no entries, so it requires a narrative for its notes.`;
}

/**
 * The failure of a release cut whose version already has a tag.
 *
 * @example
 * ```ts
 * tagExists('0.5.0'); // 'Tag v0.5.0 already exists.'
 * ```
 */
function tagExists(version: string): string {
  return `Tag v${escaped(version)} already exists.`;
}

// Pull request checks.

/**
 * The failure of PR checks in a shallow clone.
 *
 * @example
 * ```ts
 * prShallow; // 'PR checks require full Git history.'
 * ```
 */
const prShallow = 'PR checks require full Git history.';

/**
 * The failure of a release PR whose title is not the release title.
 *
 * @example
 * ```ts
 * expectedReleaseTitle; // 'Expected release title: chore(release): Release v<version> - <description>'
 * ```
 */
const expectedReleaseTitle =
  'Expected release title: chore(release): Release v<version> - <description>';

/**
 * The failure of a release branch that does not hold the base commit.
 *
 * @example
 * ```ts
 * releaseBranchBehind; // 'Release branch must include the current base commit. Update the release cut.'
 * ```
 */
const releaseBranchBehind =
  'Release branch must include the current base commit. Update the release cut.';

/**
 * The failure of a release PR that leaves fragments.
 *
 * @example
 * ```ts
 * fragmentsAfterCut; // 'No fragments may remain after a release cut.'
 * ```
 */
const fragmentsAfterCut = 'No fragments may remain after a release cut.';

/**
 * The failure of an ordinary PR that changes a library's version.
 *
 * @example
 * ```ts
 * versionMustStay('packages/core/package.json', '0.5.0');
 * // 'packages/core/package.json: ordinary PR version must stay 0.5.0.'
 * ```
 */
function versionMustStay(path: string, current: string): string {
  return `${escaped(path)}: ordinary PR version must stay ${escaped(current)}.`;
}

/**
 * The failure of a build-affecting PR without a fragment or `skip-changelog`.
 *
 * @example
 * ```ts
 * fragmentRequired; // 'Build-affecting PRs require an added or modified fragment or skip-changelog.'
 * ```
 */
const fragmentRequired =
  'Build-affecting PRs require an added or modified fragment or skip-changelog.';

/**
 * The failure of a release PR whose authoring skill is not a regular file at its head, with the
 * read's own failure.
 *
 * @example
 * ```ts
 * skillMissing('.agents/skills/loom/SKILL.md', 'git show failed: ...');
 * // '.agents/skills/loom/SKILL.md must exist at the head of a release PR as a regular file, ...'
 * ```
 */
function skillMissing(path: string, output: string): string {
  return `${escaped(path)} must exist at the head of a release PR as a regular file, so add it in an ordinary PR before the cut: ${output}`;
}

/**
 * Why the authoring skill names no version: it has no frontmatter.
 *
 * @example
 * ```ts
 * skillWithoutFrontmatter; // 'has no YAML frontmatter'
 * ```
 */
const skillWithoutFrontmatter = 'has no YAML frontmatter';

/**
 * Why the authoring skill names no version: its frontmatter is not YAML, with the parser's report.
 *
 * @example
 * ```ts
 * skillInvalidYaml('YAMLParseError: ...'); // 'has frontmatter that is not valid YAML: YAMLParseError: ...'
 * ```
 */
function skillInvalidYaml(output: string): string {
  return `has frontmatter that is not valid YAML: ${output}`;
}

/**
 * Why the authoring skill names no version: its frontmatter has no `metadata.version`.
 *
 * @example
 * ```ts
 * skillWithoutVersion; // 'has no metadata.version'
 * ```
 */
const skillWithoutVersion = 'has no metadata.version';

/**
 * Why the authoring skill names no version: its `metadata.version` is not a string.
 *
 * @example
 * ```ts
 * skillVersionNotString; // 'has a metadata.version that is not a string, so quote it'
 * ```
 */
const skillVersionNotString = 'has a metadata.version that is not a string, so quote it';

/**
 * The failure of a release PR whose authoring skill names no version, and why. The reason is a
 * sentence part of this module, and the YAML parser's report it may hold keeps its lines.
 *
 * @example
 * ```ts
 * skillVersionUnset('.agents/skills/loom/SKILL.md', skillWithoutVersion, '0.5.0');
 * // '.agents/skills/loom/SKILL.md has no metadata.version. Set its metadata.version to "0.5.0" ...'
 * ```
 */
function skillVersionUnset(path: string, output: string, version: string): string {
  return `${escaped(path)} ${output}. Set its metadata.version to "${escaped(version)}" in an ordinary PR before the cut.`;
}

/**
 * The failure of a release PR whose authoring skill names another version.
 *
 * @example
 * ```ts
 * skillVersionMismatch('.agents/skills/loom/SKILL.md', '0.4.0', '0.5.0');
 * // '.agents/skills/loom/SKILL.md carries metadata.version 0.4.0, not title version 0.5.0. ...'
 * ```
 */
function skillVersionMismatch(path: string, found: string, version: string): string {
  return `${escaped(path)} carries metadata.version ${escaped(found)}, not title version ${escaped(version)}. Review the skill against the release and set its metadata.version to "${escaped(version)}" in an ordinary PR before the cut.`;
}

/**
 * The failure of a release PR that rewrites the changelog's introduction or earlier releases.
 *
 * @example
 * ```ts
 * changelogRewritten; // 'CHANGELOG.md must preserve its introduction and earlier releases.'
 * ```
 */
const changelogRewritten = 'CHANGELOG.md must preserve its introduction and earlier releases.';

/**
 * The failure of a release PR whose section has no compiled heading and date.
 *
 * @example
 * ```ts
 * noCompiledHeading; // 'CHANGELOG.md requires a compiled release heading and date.'
 * ```
 */
const noCompiledHeading = 'CHANGELOG.md requires a compiled release heading and date.';

/**
 * The failure of a release PR whose libraries do not carry the title version.
 *
 * @example
 * ```ts
 * librariesOffTitle('0.5.0'); // 'Every participating library must carry title version 0.5.0.'
 * ```
 */
function librariesOffTitle(version: string): string {
  return `Every participating library must carry title version ${escaped(version)}.`;
}

/**
 * The failure of a release PR that changes the set of participating libraries.
 *
 * @example
 * ```ts
 * librariesChanged; // 'Release cuts cannot change participating libraries.'
 * ```
 */
const librariesChanged = 'Release cuts cannot change participating libraries.';

/**
 * The failure of a release PR that changes a library's manifest beyond its version.
 *
 * @example
 * ```ts
 * onlyVersionField('packages/core/package.json');
 * // 'packages/core/package.json: release cuts change only the version field.'
 * ```
 */
function onlyVersionField(path: string): string {
  return `${escaped(path)}: release cuts change only the version field.`;
}

/**
 * The failure of a release PR that changes a file outside the cut.
 *
 * @example
 * ```ts
 * outsideCut('README.md'); // 'README.md: outside the release cut.'
 * ```
 */
function outsideCut(path: string): string {
  return `${escaped(path)}: outside the release cut.`;
}

/**
 * The failure of a release PR that changes a file's mode.
 *
 * @example
 * ```ts
 * fileModeChanged('install.sh'); // 'install.sh: release cuts cannot change a file mode.'
 * ```
 */
function fileModeChanged(path: string): string {
  return `${escaped(path)}: release cuts cannot change a file mode.`;
}

/**
 * The failure of a release PR whose lockfile is not the version writer's.
 *
 * @example
 * ```ts
 * lockfileMismatch; // 'pnpm-lock.yaml must match the version writer; ...'
 * ```
 */
const lockfileMismatch =
  'pnpm-lock.yaml must match the version writer; unrelated lockfile changes need an ordinary PR.';

/**
 * The failure of a release PR whose section is not the compiler's output.
 *
 * @example
 * ```ts
 * sectionNotCompiled; // 'CHANGELOG.md must contain the compiler output for the consumed fragments.'
 * ```
 */
const sectionNotCompiled =
  'CHANGELOG.md must contain the compiler output for the consumed fragments.';

/**
 * The failure of a release PR with more or less than one compiled section.
 *
 * @example
 * ```ts
 * oneCompiledSection; // 'CHANGELOG.md must contain exactly one compiled release section.'
 * ```
 */
const oneCompiledSection = 'CHANGELOG.md must contain exactly one compiled release section.';

/**
 * The failure of a release PR that changes a decision record beyond accepting it.
 *
 * @example
 * ```ts
 * decisionRecordChanged('docs/decisions/0001-x.md', '2026-11-16', '0.5.0');
 * // 'docs/decisions/0001-x.md: a release cut changes a decision record only to mark ...'
 * ```
 */
function decisionRecordChanged(path: string, date: string, version: string): string {
  return `${escaped(path)}: a release cut changes a decision record only to mark a proposed decision accepted, with status accepted, modified ${escaped(date)}, and a Status section that reads "Accepted in ${escaped(version)}.". Make any other change in an ordinary PR.`;
}

/**
 * The failure of a release PR that changes the decision index beyond accepting records.
 *
 * @example
 * ```ts
 * decisionIndexChanged('docs/decisions/README.md');
 * // 'docs/decisions/README.md: a release cut changes the decision index only to mark ...'
 * ```
 */
function decisionIndexChanged(index: string): string {
  return `${escaped(index)}: a release cut changes the decision index only to mark each decision it accepts from proposed to accepted. Make any other change in an ordinary PR.`;
}

// Lockfiles.

/**
 * The failure of lockfile preparation without the optional pnpm peer.
 *
 * @example
 * ```ts
 * pnpmMissing; // 'Preparing pnpm-lock.yaml requires pnpm, an optional peer dependency ...'
 * ```
 */
const pnpmMissing =
  'Preparing pnpm-lock.yaml requires pnpm, an optional peer dependency of @loomcli/loom. Install pnpm 12.16.1 beside @loomcli/loom and run the command again.';

/**
 * The failure of a lockfile that is not YAML.
 *
 * @example
 * ```ts
 * lockfileInvalidYaml; // 'pnpm-lock.yaml is invalid YAML.'
 * ```
 */
const lockfileInvalidYaml = 'pnpm-lock.yaml is invalid YAML.';

/**
 * The failure of lockfile preparation that ran past its limit, in seconds.
 *
 * @example
 * ```ts
 * lockfileTimedOut(60);
 * // 'Lockfile preparation did not finish within 60 seconds, so pnpm was stopped.'
 * ```
 */
function lockfileTimedOut(seconds: number): string {
  return `Lockfile preparation did not finish within ${String(seconds)} seconds, so pnpm was stopped.`;
}

/**
 * The failure of lockfile preparation pnpm refused, with what pnpm wrote.
 *
 * @example
 * ```ts
 * lockfilePreparationFailed('ERR_PNPM_OUTDATED_LOCKFILE ...\n');
 * // 'Lockfile preparation failed:\nERR_PNPM_OUTDATED_LOCKFILE ...\n'
 * ```
 */
function lockfilePreparationFailed(output: string): string {
  return `Lockfile preparation failed:\n${output}`;
}

// Services.

/**
 * The failure of a service that answered with a body that is not JSON.
 *
 * @example
 * ```ts
 * invalidJsonAnswer('https://api.github.com/x'); // 'https://api.github.com/x answered with invalid JSON.'
 * ```
 */
function invalidJsonAnswer(url: string): string {
  return `${escaped(url)} answered with invalid JSON.`;
}

/**
 * The failure of a request a service refused, with the status and what it answered.
 *
 * @example
 * ```ts
 * refusedRequest('GET', 'https://api.github.com/x', 404, '{"message":"Not Found"}');
 * // 'GET https://api.github.com/x answered 404: {"message":"Not Found"}'
 * ```
 */
function refusedRequest(method: string, url: string, status: number, output: string): string {
  return `${escaped(method)} ${escaped(url)} answered ${String(status)}: ${output}`;
}

/**
 * The failure of a request that did not answer within its deadline.
 *
 * @example
 * ```ts
 * requestTimedOut('GET', 'https://api.github.com/x', 30_000);
 * // 'GET https://api.github.com/x did not answer within 30000 ms.'
 * ```
 */
function requestTimedOut(method: string, url: string, deadlineMs: number): string {
  return `${escaped(method)} ${escaped(url)} did not answer within ${String(deadlineMs)} ms.`;
}

/**
 * The failure of a read retried until its attempts ran out.
 *
 * @example
 * ```ts
 * neverAppeared(onRegistry('@acme/notes@1.0.0'), 5);
 * // '@acme/notes@1.0.0 on the registry did not appear after 5 attempts.'
 * ```
 */
function neverAppeared(subject: string, attempts: number): string {
  return `${escaped(subject)} did not appear after ${String(attempts)} attempts.`;
}

/**
 * The failure of a tag whose tag object the API does not return.
 *
 * @example
 * ```ts
 * tagObjectMissing('v1.0.0', 'abc123');
 * // 'Tag v1.0.0 names tag object abc123, which the API does not return.'
 * ```
 */
function tagObjectMissing(tag: string, sha: string): string {
  return `Tag ${escaped(tag)} names tag object ${escaped(sha)}, which the API does not return.`;
}

/**
 * The failure of a Release whose upload endpoint lies at another origin.
 *
 * @example
 * ```ts
 * uploadOriginRefused('https://evil.example', 'https://api.github.com', 'https://uploads.github.com');
 * // 'The Release publishes its upload endpoint at https://evil.example, which is neither ...'
 * ```
 */
function uploadOriginRefused(origin: string, api: string, upload: string): string {
  return `The Release publishes its upload endpoint at ${escaped(origin)}, which is neither ${escaped(api)} nor ${escaped(upload)}.`;
}

/**
 * The failure of provenance that attests other packages than the one read.
 *
 * @example
 * ```ts
 * provenanceElsewhere('@acme/notes', '1.0.0', [], 'pkg:npm/%40acme/notes@1.0.0');
 * // '@acme/notes@1.0.0: its provenance attests nothing, not pkg:npm/%40acme/notes@1.0.0.'
 * ```
 */
function provenanceElsewhere(
  name: string,
  version: string,
  attested: readonly string[],
  purl: string,
): string {
  return `${escaped(name)}@${escaped(version)}: its provenance attests ${escaped(attested.join(', ') || 'nothing')}, not ${escaped(purl)}.`;
}

/**
 * The failure of provenance that resolves no source repository.
 *
 * @example
 * ```ts
 * provenanceWithoutSource('@acme/notes', '1.0.0');
 * // '@acme/notes@1.0.0: its provenance resolves no source repository.'
 * ```
 */
function provenanceWithoutSource(name: string, version: string): string {
  return `${escaped(name)}@${escaped(version)}: its provenance resolves no source repository.`;
}

/**
 * The failure of an integrity the registry reports in a form loom does not verify.
 *
 * @example
 * ```ts
 * unsupportedIntegrity('@acme/notes@1.0.0', 'sha1-abc');
 * // '@acme/notes@1.0.0: the registry reports unsupported integrity sha1-abc.'
 * ```
 */
function unsupportedIntegrity(subject: string, integrity: string): string {
  return `${escaped(subject)}: the registry reports unsupported integrity ${escaped(integrity)}.`;
}

/**
 * The failure of a tarball whose hash is not the registry's integrity.
 *
 * @example
 * ```ts
 * integrityMismatch('@acme/notes@1.0.0', 'xyz', 'sha512-abc');
 * // '@acme/notes@1.0.0: the downloaded tarball hashes to sha512-xyz, not sha512-abc.'
 * ```
 */
function integrityMismatch(subject: string, actual: string, integrity: string): string {
  return `${escaped(subject)}: the downloaded tarball hashes to sha512-${escaped(actual)}, not ${escaped(integrity)}.`;
}

// Release plans.

/**
 * The failure of a plan whose changelog lacks the version's section.
 *
 * @example
 * ```ts
 * noChangelogSection('0.5.0'); // 'CHANGELOG.md has no v0.5.0 section.'
 * ```
 */
function noChangelogSection(version: string): string {
  return `CHANGELOG.md has no v${escaped(version)} section.`;
}

/**
 * The failure of a plan whose version section carries no notes.
 *
 * @example
 * ```ts
 * sectionWithoutNotes('0.5.0'); // 'CHANGELOG.md: the v0.5.0 section has no notes.'
 * ```
 */
function sectionWithoutNotes(version: string): string {
  return `CHANGELOG.md: the v${escaped(version)} section has no notes.`;
}

/**
 * The failure of an unpublished version publication can no longer attest, and why.
 *
 * @example
 * ```ts
 * abandonedVersion('0.5.0', tagNamesOther('v0.5.0', 'abc', 'def'));
 * // 'Version 0.5.0 is absent from the registry and tag v0.5.0 already names abc instead of ...'
 * ```
 */
function abandonedVersion(version: string, reason: string): string {
  return `Version ${escaped(version)} is absent from the registry and ${escaped(reason)} Publication attests the head, so ${escaped(version)} must be abandoned as unpublished and superseded by the next cut.`;
}

/**
 * Why a version is abandoned: build inputs changed after its cut commit.
 *
 * @example
 * ```ts
 * changedSinceCut(['packages/core'], 'abc', 'def');
 * // 'packages/core changed between the cut commit abc and the head def.'
 * ```
 */
function changedSinceCut(paths: readonly string[], cutCommit: string, head: string): string {
  return `${escaped(paths.join(', '))} changed between the cut commit ${escaped(cutCommit)} and the head ${escaped(head)}.`;
}

/**
 * Why a version is abandoned: its tag names another commit than the head.
 *
 * @example
 * ```ts
 * tagNamesOther('v0.5.0', 'abc', 'def'); // 'tag v0.5.0 already names abc instead of the head def.'
 * ```
 */
function tagNamesOther(tag: string, tagCommit: string, head: string): string {
  return `tag ${escaped(tag)} already names ${escaped(tagCommit)} instead of the head ${escaped(head)}.`;
}

/**
 * The failure of libraries whose provenance names different commits.
 *
 * @example
 * ```ts
 * provenanceConflict('@acme/b', '0.5.0', 'def', 'abc');
 * // '@acme/b@0.5.0 was published from def, but an earlier library names abc.'
 * ```
 */
function provenanceConflict(
  name: string,
  version: string,
  commit: string,
  earlier: string,
): string {
  return `${escaped(name)}@${escaped(version)} was published from ${escaped(commit)}, but an earlier library names ${escaped(earlier)}.`;
}

/**
 * The failure of a tag for a version the registry reports no provenance for.
 *
 * @example
 * ```ts
 * tagWithoutProvenance('v0.5.0', 'abc', '0.5.0');
 * // 'Tag v0.5.0 names abc, but the registry reports no provenance for 0.5.0, ...'
 * ```
 */
function tagWithoutProvenance(tag: string, tagCommit: string, version: string): string {
  return `Tag ${escaped(tag)} names ${escaped(tagCommit)}, but the registry reports no provenance for ${escaped(version)}, so the commit it was published from is unknown.`;
}

/**
 * The failure of a tag at another commit than the one its version was published from.
 *
 * @example
 * ```ts
 * tagAwayFromPublication('v0.5.0', 'abc', '0.5.0', 'def');
 * // 'Tag v0.5.0 names abc, but 0.5.0 was published from def; recording never moves a tag.'
 * ```
 */
function tagAwayFromPublication(
  tag: string,
  tagCommit: string,
  version: string,
  commit: string,
): string {
  return `Tag ${escaped(tag)} names ${escaped(tagCommit)}, but ${escaped(version)} was published from ${escaped(commit)}; recording never moves a tag.`;
}

/**
 * The issue of a plan for a released version that carries no notes.
 *
 * @example
 * ```ts
 * planWithoutNotes; // 'A plan for a released version carries notes.'
 * ```
 */
const planWithoutNotes = 'A plan for a released version carries notes.';

/**
 * The plan of the unreleased version, which has nothing to reconcile.
 *
 * @example
 * ```ts
 * unreleasedPlan('0.0.0', 'abc');
 * // '0.0.0 is the unreleased version at head abc, so there is nothing to reconcile.\nPublish: no. Record: no.'
 * ```
 */
function unreleasedPlan(version: string, head: string): string {
  return `${escaped(version)} is the unreleased version at head ${escaped(head)}, so there is nothing to reconcile.\nPublish: no. Record: no.`;
}

/**
 * A plan's first line: the tag, the head, and the cut commit.
 *
 * @example
 * ```ts
 * planHeading('v0.5.0', 'def', 'abc'); // 'Plan v0.5.0 at head def, cut commit abc.'
 * ```
 */
function planHeading(tag: string, head: string, cutCommit: string): string {
  return `Plan ${escaped(tag)} at head ${escaped(head)}, cut commit ${escaped(cutCommit)}.`;
}

/**
 * A plan's line for one library: whether the registry carries it.
 *
 * @example
 * ```ts
 * libraryState('@acme/notes', true); // '@acme/notes: published.'
 * ```
 */
function libraryState(name: string, published: boolean): string {
  return `${escaped(name)}: ${published ? 'published' : 'absent from the registry'}.`;
}

/**
 * A plan's line for the tag: absent, or the commit it names.
 *
 * @example
 * ```ts
 * tagState('v0.5.0', null); // 'Tag v0.5.0: absent.'
 * ```
 */
function tagState(tag: string, commit: string | null): string {
  return `Tag ${escaped(tag)}: ${commit === null ? 'absent' : `present at ${escaped(commit)}`}.`;
}

/**
 * A plan's line for the GitHub Release: present or absent.
 *
 * @example
 * ```ts
 * releaseState('v0.5.0', false); // 'Release v0.5.0: absent.'
 * ```
 */
function releaseState(tag: string, present: boolean): string {
  return `Release ${escaped(tag)}: ${present ? 'present' : 'absent'}.`;
}

/**
 * A plan's last line: whether to publish and whether to record.
 *
 * @example
 * ```ts
 * planDecision(true, true); // 'Publish: yes. Record: yes.'
 * ```
 */
function planDecision(publish: boolean, record: boolean): string {
  return `Publish: ${publish ? 'yes' : 'no'}. Record: ${record ? 'yes' : 'no'}.`;
}

// Release records.

/**
 * What a record waits for: a version on the registry.
 *
 * @example
 * ```ts
 * onRegistry('@acme/notes@1.0.0'); // '@acme/notes@1.0.0 on the registry'
 * ```
 */
function onRegistry(subject: string): string {
  return `${escaped(subject)} on the registry`;
}

/**
 * What a record waits for: a version's provenance.
 *
 * @example
 * ```ts
 * provenanceOf('@acme/notes@1.0.0'); // 'the provenance of @acme/notes@1.0.0'
 * ```
 */
function provenanceOf(subject: string): string {
  return `the provenance of ${escaped(subject)}`;
}

/**
 * What a record waits for: a version's tarball.
 *
 * @example
 * ```ts
 * tarballOf('@acme/notes@1.0.0'); // 'the @acme/notes@1.0.0 tarball'
 * ```
 */
function tarballOf(subject: string): string {
  return `the ${escaped(subject)} tarball`;
}

/**
 * What a record waits for: the tag it created.
 *
 * @example
 * ```ts
 * theTag('v1.0.0'); // 'the tag v1.0.0'
 * ```
 */
function theTag(tag: string): string {
  return `the tag ${escaped(tag)}`;
}

/**
 * What a record waits for: the Release it created.
 *
 * @example
 * ```ts
 * theRelease('v1.0.0'); // 'the v1.0.0 Release'
 * ```
 */
function theRelease(tag: string): string {
  return `the ${escaped(tag)} Release`;
}

/**
 * What a record waits for: the asset it uploaded.
 *
 * @example
 * ```ts
 * theAsset('acme-notes-1.0.0.tgz'); // 'the acme-notes-1.0.0.tgz asset'
 * ```
 */
function theAsset(name: string): string {
  return `the ${escaped(name)} asset`;
}

/**
 * A record's line for a version it read from the registry.
 *
 * @example
 * ```ts
 * readFromRegistry('@acme/notes@1.0.0'); // 'Read @acme/notes@1.0.0 from the registry.'
 * ```
 */
function readFromRegistry(subject: string): string {
  return `Read ${escaped(subject)} from the registry.`;
}

/**
 * The failure of provenance that names another build than this repository's main branch.
 *
 * @example
 * ```ts
 * provenanceNotOurs('@acme/notes@1.0.0', 'git+https://github.com/x/y@refs/heads/dev', 'git+https://github.com/acme/notes@refs/heads/main');
 * // '@acme/notes@1.0.0: its provenance names git+https://github.com/x/y@refs/heads/dev, which is not a build of ...'
 * ```
 */
function provenanceNotOurs(subject: string, uri: string, source: string): string {
  return `${escaped(subject)}: its provenance names ${escaped(uri)}, which is not a build of ${escaped(source)}.`;
}

/**
 * A record's line for a tarball it verified.
 *
 * @example
 * ```ts
 * verifiedTarball('@acme/notes@1.0.0', 'sha512-abc');
 * // 'Verified the @acme/notes@1.0.0 tarball against sha512-abc.'
 * ```
 */
function verifiedTarball(subject: string, integrity: string): string {
  return `Verified the ${escaped(subject)} tarball against ${escaped(integrity)}.`;
}

/**
 * The failure of a publication commit the checkout does not carry.
 *
 * @example
 * ```ts
 * commitOutsideCheckout('v1.0.0', 'abc', 'def');
 * // 'v1.0.0 was published from abc, which is neither the head def of the checkout nor an ancestor of it.'
 * ```
 */
function commitOutsideCheckout(subject: string, commit: string, head: string): string {
  return `${escaped(subject)} was published from ${escaped(commit)}, which is neither the head ${escaped(head)} of the checkout nor an ancestor of it.`;
}

/**
 * The failure of two libraries published from different commits.
 *
 * @example
 * ```ts
 * uploadsDisagree('@acme/b@1.0.0', 'def', '@acme/a@1.0.0', 'abc');
 * // '@acme/b@1.0.0 was published from def, but @acme/a@1.0.0 was published from abc.'
 * ```
 */
function uploadsDisagree(
  subject: string,
  commit: string,
  firstSubject: string,
  firstCommit: string,
): string {
  return `${escaped(subject)} was published from ${escaped(commit)}, but ${escaped(firstSubject)} was published from ${escaped(firstCommit)}.`;
}

/**
 * A record's line for the tag it created.
 *
 * @example
 * ```ts
 * createdTag('v1.0.0', 'abc'); // 'Created the annotated tag v1.0.0 at abc.'
 * ```
 */
function createdTag(tag: string, commit: string): string {
  return `Created the annotated tag ${escaped(tag)} at ${escaped(commit)}.`;
}

/**
 * A record's line for the tag it found in place.
 *
 * @example
 * ```ts
 * reusedTag('v1.0.0', 'abc'); // 'Reused the tag v1.0.0 at abc.'
 * ```
 */
function reusedTag(tag: string, commit: string): string {
  return `Reused the tag ${escaped(tag)} at ${escaped(commit)}.`;
}

/**
 * A record's line for the Release it created.
 *
 * @example
 * ```ts
 * createdRelease('v1.0.0'); // 'Created the v1.0.0 Release.'
 * ```
 */
function createdRelease(tag: string): string {
  return `Created the ${escaped(tag)} Release.`;
}

/**
 * A record's line for the Release it found in place.
 *
 * @example
 * ```ts
 * reusedRelease('v1.0.0'); // 'Reused the v1.0.0 Release.'
 * ```
 */
function reusedRelease(tag: string): string {
  return `Reused the ${escaped(tag)} Release.`;
}

/**
 * A record's line for an asset it kept.
 *
 * @example
 * ```ts
 * keptAsset('acme-notes-1.0.0.tgz'); // 'Kept the acme-notes-1.0.0.tgz asset.'
 * ```
 */
function keptAsset(name: string): string {
  return `Kept the ${escaped(name)} asset.`;
}

/**
 * A record's line for an unfinished asset it deleted.
 *
 * @example
 * ```ts
 * deletedAsset('acme-notes-1.0.0.tgz'); // 'Deleted the unfinished acme-notes-1.0.0.tgz asset.'
 * ```
 */
function deletedAsset(name: string): string {
  return `Deleted the unfinished ${escaped(name)} asset.`;
}

/**
 * A record's line for an asset it uploaded.
 *
 * @example
 * ```ts
 * uploadedAsset('acme-notes-1.0.0.tgz'); // 'Uploaded the acme-notes-1.0.0.tgz asset.'
 * ```
 */
function uploadedAsset(name: string): string {
  return `Uploaded the ${escaped(name)} asset.`;
}

/**
 * A record's last line.
 *
 * @example
 * ```ts
 * recorded('v1.0.0'); // 'Recorded v1.0.0.'
 * ```
 */
function recorded(tag: string): string {
  return `Recorded ${escaped(tag)}.`;
}

// Commands: option and argument issues.

/**
 * The issue of a `--build` value that names no build.
 *
 * @example
 * ```ts
 * useBuild; // 'Use development or distributed.'
 * ```
 */
const useBuild = 'Use development or distributed.';

/**
 * The issue of a `--repository` value that is not owner/name.
 *
 * @example
 * ```ts
 * useOwnerName; // 'Use owner/name, such as acme/notes.'
 * ```
 */
const useOwnerName = 'Use owner/name, such as acme/notes.';

/**
 * The issue of a version argument that is not a version `loom changelog notes` reads.
 *
 * @example
 * ```ts
 * useVersion; // 'Use MAJOR.MINOR.PATCH with an optional -prerelease part, ...'
 * ```
 */
const useVersion =
  'Use MAJOR.MINOR.PATCH with an optional -prerelease part, such as 1.5.0 or 1.5.0-rc.1, and no leading v or build metadata.';

/**
 * The issue of an `--only` value that names no piece.
 *
 * @example
 * ```ts
 * usePiece; // 'Use application, entry, tsconfig, test, lint, package, changes, skill, or install.'
 * ```
 */
const usePiece =
  'Use application, entry, tsconfig, test, lint, package, changes, skill, or install.';

/**
 * The issue of a `--linter` value that names no linter.
 *
 * @example
 * ```ts
 * useLinter; // 'Use oxlint or eslint.'
 * ```
 */
const useLinter = 'Use oxlint or eslint.';

/**
 * The issue of a `--test-runner` value that names no test runner.
 *
 * @example
 * ```ts
 * useTestRunner; // 'Use bun or vitest.'
 * ```
 */
const useTestRunner = 'Use bun or vitest.';

/**
 * The issue of a count option that is not a whole number.
 *
 * @example
 * ```ts
 * useWholeNumber; // 'Supply a whole number.'
 * ```
 */
const useWholeNumber = 'Supply a whole number.';

// Commands: build.

/**
 * The line of an option a build refuses beside another: the option, then why.
 *
 * @example
 * ```ts
 * optionLine('define', factsWithDefine);
 * // 'Option "--define": --facts and --define exclude each other, so pass one of them.'
 * ```
 */
function optionLine(name: string, sentence: string): string {
  return `Option "--${escaped(name)}": ${escaped(sentence)}`;
}

/**
 * Why a build refuses `--define` beside `--facts`.
 *
 * @example
 * ```ts
 * factsWithDefine; // '--facts and --define exclude each other, so pass one of them.'
 * ```
 */
const factsWithDefine = '--facts and --define exclude each other, so pass one of them.';

/**
 * Why a build refuses `--application` for a target that is not a bundle.
 *
 * @example
 * ```ts
 * applicationNeedsBundle; // '--application applies to a node or bun bundle, ...'
 * ```
 */
const applicationNeedsBundle =
  '--application applies to a node or bun bundle, so pass --target node or --target bun with it.';

/**
 * Why a build refuses `--repository` without `--release`.
 *
 * @example
 * ```ts
 * repositoryNeedsRelease; // '--repository applies to a --release build, so pass --release with it.'
 * ```
 */
const repositoryNeedsRelease =
  '--repository applies to a --release build, so pass --release with it.';

/**
 * Why a build refuses `--watch` with a distributed build.
 *
 * @example
 * ```ts
 * watchIsDevelopment; // '--watch builds development, so pass --watch or --build distributed.'
 * ```
 */
const watchIsDevelopment = '--watch builds development, so pass --watch or --build distributed.';

/**
 * The failure of a bundle whose entry and application module build to one file.
 *
 * @example
 * ```ts
 * sameEntryFile('src/main.ts', 'lib/main.ts', 'main.js');
 * // 'The entry src/main.ts and the application module lib/main.ts both build to main.js, ...'
 * ```
 */
function sameEntryFile(entry: string, application: string, file: string): string {
  return `The entry ${escaped(entry)} and the application module ${escaped(application)} both build to ${escaped(file)}, so rename one of them or name another module with --entry or --application.`;
}

/**
 * The failure of a binary whose output names a directory.
 *
 * @example
 * ```ts
 * outputIsDirectory('dist');
 * // "dist is a directory, and a binary is one file, so name the binary's file with --out."
 * ```
 */
function outputIsDirectory(output: string): string {
  return `${escaped(output)} is a directory, and a binary is one file, so name the binary's file with --out.`;
}

/**
 * The failure of a bundle whose carried skills folder would be, sit inside, or hold the skills
 * folder.
 *
 * @example
 * ```ts
 * carriedFolderOverlap('skills/loom-skills', 'is inside', 'skills');
 * // 'skills/loom-skills, where the bundle carries the skills, is inside the skills folder skills, ...'
 * ```
 */
function carriedFolderOverlap(carried: string, relation: string, folder: string): string {
  return `${escaped(carried)}, where the bundle carries the skills, ${escaped(relation)} the skills folder ${escaped(folder)}, and loom build never writes into the source tree, so name another directory with --out.`;
}

/**
 * The warning of a bundle that carries the skills plugin when `skills()` did not run while the
 * build loaded the application module.
 *
 * @example
 * ```ts
 * skillsNotCalled('notes'); // 'notes carries the skills plugin, but skills() did not run ...'
 * ```
 */
function skillsNotCalled(name: string): string {
  return `${escaped(name)} carries the skills plugin, but skills() did not run while loom build loaded the application module, so it carried no skills folder. Call skills() as the module paths.application names loads, src/application.ts by convention, if it names a folder.`;
}

/**
 * The warning of a bundle that carries the skills plugin when the build could not load the
 * application module.
 *
 * @example
 * ```ts
 * skillsNotLoaded('notes'); // 'notes carries the skills plugin, but loom build could not load ...'
 * ```
 */
function skillsNotLoaded(name: string): string {
  return `${escaped(name)} carries the skills plugin, but loom build could not load the application module, so it carried no skills folder. Export the Application from the module paths.application names, src/application.ts by convention, if skills() names a folder.`;
}

/**
 * The confirmation of a build.
 *
 * @example
 * ```ts
 * built('dist', 'node'); // 'Built dist for node.'
 * ```
 */
function built(output: string, target: string): string {
  return `Built ${escaped(output)} for ${escaped(target)}.`;
}

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

// Commands: pull requests.

/**
 * The confirmation of `loom pr check`.
 *
 * @example
 * ```ts
 * prChecksPassed; // 'PR checks passed.'
 * ```
 */
const prChecksPassed = 'PR checks passed.';

// Commands: releases.

/**
 * The failure of `loom release cut` run below the repository root.
 *
 * @example
 * ```ts
 * cutFromRoot; // 'Run release cut from the repository root.'
 * ```
 */
const cutFromRoot = 'Run release cut from the repository root.';

/**
 * The failure of `loom release cut` in a checkout with changes.
 *
 * @example
 * ```ts
 * cleanCheckoutRequired; // 'release cut requires a clean checkout. Commit the release inputs first.'
 * ```
 */
const cleanCheckoutRequired =
  'release cut requires a clean checkout. Commit the release inputs first.';

/**
 * The failure of a cut whose checkout moved while it prepared the release.
 *
 * @example
 * ```ts
 * checkoutChanged; // 'Checkout changed during release preparation.'
 * ```
 */
const checkoutChanged = 'Checkout changed during release preparation.';

/**
 * The failure of a cut whose file changed while it prepared the release.
 *
 * @example
 * ```ts
 * changedDuringPreparation('CHANGELOG.md'); // 'CHANGELOG.md: changed during release preparation.'
 * ```
 */
function changedDuringPreparation(path: string): string {
  return `${escaped(path)}: changed during release preparation.`;
}

/**
 * The failure of a cut that could not restore the files it wrote.
 *
 * @example
 * ```ts
 * rollbackIncomplete(['CHANGELOG.md']);
 * // 'Release rollback incomplete for CHANGELOG.md. Use a fresh isolated checkout.'
 * ```
 */
function rollbackIncomplete(failed: readonly string[]): string {
  return `Release rollback incomplete for ${escaped(failed.join(', '))}. Use a fresh isolated checkout.`;
}

/**
 * The failure of a cut whose release lock another writer holds.
 *
 * @example
 * ```ts
 * lockExists('/repo/.git/release-cut.lock');
 * // 'Release lock already exists at /repo/.git/release-cut.lock. Another writer may be active. ...'
 * ```
 */
function lockExists(lock: string): string {
  return `Release lock already exists at ${escaped(lock)}. Another writer may be active. After an interrupted write, use a fresh isolated checkout.`;
}

/**
 * The failure of `loom release record` without a token.
 *
 * @example
 * ```ts
 * tokenRequired; // 'Recording a release requires GH_TOKEN.'
 * ```
 */
const tokenRequired = 'Recording a release requires GH_TOKEN.';

// Commands: init.

/**
 * The failure of `loom init` in a directory whose name is no valid package name.
 *
 * @example
 * ```ts
 * invalidDirectoryName('My App');
 * // 'The directory name "My App" is not a valid package name, so rename the directory ...'
 * ```
 */
function invalidDirectoryName(name: string): string {
  return `The directory name "${escaped(name)}" is not a valid package name, so rename the directory or write a package.json with the name to use.`;
}

/**
 * The failure of `loom init` in a directory that is neither empty nor inside a package.
 *
 * @example
 * ```ts
 * notEmptyWithoutPackage('/work/notes');
 * // '/work/notes is not empty and no package.json is at or above it, so create one with npm init -y, ...'
 * ```
 */
function notEmptyWithoutPackage(cwd: string): string {
  return `${escaped(cwd)} is not empty and no package.json is at or above it, so create one with npm init -y, or your package manager's equivalent, and run loom init again.`;
}

/**
 * The question `loom init` asks before it creates a `package.json` in such a directory.
 *
 * @example
 * ```ts
 * createPackageQuestion; // 'No package.json is here or above it. Create one in this directory?'
 * ```
 */
const createPackageQuestion = 'No package.json is here or above it. Create one in this directory?';

/**
 * The question `loom init` asks for the scaffold's linter.
 *
 * @example
 * ```ts
 * linterQuestion; // 'Which linter should the scaffold use?'
 * ```
 */
const linterQuestion = 'Which linter should the scaffold use?';

/**
 * The question `loom init` asks for the scaffold's test runner.
 *
 * @example
 * ```ts
 * testRunnerQuestion; // 'Which test runner should the scaffold use?'
 * ```
 */
const testRunnerQuestion = 'Which test runner should the scaffold use?';

/**
 * The failure of a file `loom init` cannot write, with the system's reason.
 *
 * @example
 * ```ts
 * cannotWrite('src/main.ts', 'EACCES: permission denied');
 * // 'Cannot write src/main.ts: EACCES: permission denied.'
 * ```
 */
function cannotWrite(path: string, reason: string): string {
  return `Cannot write ${escaped(path)}: ${escaped(reason)}.`;
}

/**
 * The failure of a file `loom init` cannot remove, with the system's reason.
 *
 * @example
 * ```ts
 * cannotRemove('.agents/skills/loom/old.md', 'EACCES: permission denied');
 * // 'Cannot remove .agents/skills/loom/old.md: EACCES: permission denied.'
 * ```
 */
function cannotRemove(path: string, reason: string): string {
  return `Cannot remove ${escaped(path)}: ${escaped(reason)}.`;
}

/**
 * The line `loom init` writes for each file it wrote.
 *
 * @example
 * ```ts
 * wroteFile('src/main.ts'); // 'Wrote src/main.ts.'
 * ```
 */
function wroteFile(path: string): string {
  return `Wrote ${escaped(path)}.`;
}

/**
 * The line `loom init` writes for each file it removed.
 *
 * @example
 * ```ts
 * removedFile('.agents/skills/loom/old.md'); // 'Removed .agents/skills/loom/old.md.'
 * ```
 */
function removedFile(path: string): string {
  return `Removed ${escaped(path)}.`;
}

/**
 * The line `loom init` writes for each `package.json` key it added.
 *
 * @example
 * ```ts
 * addedKey('scripts.build'); // 'Added scripts.build to package.json.'
 * ```
 */
function addedKey(key: string): string {
  return `Added ${escaped(key)} to package.json.`;
}

/**
 * The warning of an edited file of the authoring skill that the running loom no longer ships.
 *
 * @example
 * ```ts
 * staleSkillFile('.agents/skills/loom/old.md');
 * // 'warning: .agents/skills/loom/old.md differs from what loom init wrote, and the running loom no longer ships it. ...'
 * ```
 */
function staleSkillFile(path: string): string {
  return `warning: ${escaped(path)} differs from what loom init wrote, and the running loom no longer ships it. Run loom init --force to remove it, or delete its header to keep it.`;
}

/**
 * The warning of an installer script `loom init` did not write, because the package names no
 * GitHub repository.
 *
 * @example
 * ```ts
 * installerWithoutRepository('install.sh');
 * // 'warning: install.sh was not written because package.json names no GitHub repository. ...'
 * ```
 */
function installerWithoutRepository(path: string): string {
  return `warning: ${escaped(path)} was not written because package.json names no GitHub repository. Set repository to a GitHub address such as owner/name, then run loom init again.`;
}

/**
 * The warning of a package whose `typescript` typescript-eslint cannot run on, with the alias to
 * set and the guide that describes it.
 *
 * @example
 * ```ts
 * plainTypescript('^7.0.2', '^6.0.0', 'https://example.com/guide');
 * // 'warning: package.json declares typescript as ^7.0.2, and typescript-eslint supports ...'
 * ```
 */
function plainTypescript(range: string, alias: string, guide: string): string {
  return `warning: package.json declares typescript as ${escaped(range)}, and typescript-eslint supports TypeScript below 6.1, so eslint . fails on TypeScript 7. Set typescript to npm:@typescript/typescript6@${escaped(alias)} and add @typescript/native as npm:typescript@${escaped(range)}, which keeps tsc on your compiler. See ${escaped(guide)}.`;
}

/**
 * The reason a warning gives for an application module that could not be read, when the failure
 * holds no line of its own.
 *
 * @example
 * ```ts
 * unreadReason; // 'it could not be read'
 * ```
 */
const unreadReason = 'it could not be read';

/**
 * The warning of a file `loom init` did not write, because the application module could not be
 * loaded, with the first line of why.
 *
 * @example
 * ```ts
 * unloadedApplication('src/main.ts', 'src/application.ts', 'it could not be read', 'entry');
 * // 'warning: src/main.ts was not written because src/application.ts could not be loaded: ...'
 * ```
 */
function unloadedApplication(
  path: string,
  application: string,
  reason: string,
  noun: string,
): string {
  return `warning: ${escaped(path)} was not written because ${escaped(application)} could not be loaded: ${escaped(reason)}. Install the package and run loom init again, or write the ${escaped(noun)} by hand.`;
}

/**
 * The warning of a file `loom init` did not write, because the application module exports no
 * single Application.
 *
 * @example
 * ```ts
 * unexportedApplication('src/main.ts', 'src/application.ts', 'entry');
 * // 'warning: src/main.ts was not written because src/application.ts exports no Application loom can read. ...'
 * ```
 */
function unexportedApplication(path: string, application: string, noun: string): string {
  return `warning: ${escaped(path)} was not written because ${escaped(application)} exports no Application loom can read. Write the ${escaped(noun)} by hand.`;
}

export {
  abandonedVersion,
  acceptedTargets,
  addedKey,
  applicationNeedsBundle,
  built,
  bunBuildFailed,
  bunCouldNotRead,
  cannotRemove,
  cannotWrite,
  carriageReturnHeld,
  carriedFolderOverlap,
  changedDuringPreparation,
  changedSinceCut,
  changelogRewritten,
  changelogWithoutTitle,
  checkedFragments,
  checkoutChanged,
  cleanCheckoutRequired,
  commitOutsideCheckout,
  controlCharacterHeld,
  coreUnresolved,
  coreWithoutApplication,
  createdRelease,
  createdTag,
  createPackageQuestion,
  cutFromRoot,
  decisionIndexChanged,
  decisionRecordChanged,
  deletedAsset,
  driftedManagedFile,
  expectedBullets,
  expectedFragmentFile,
  expectedFragmentName,
  expectedMigrationAfterBullets,
  expectedOneMigration,
  expectedRegularFile,
  expectedReleaseTitle,
  expectedVersionString,
  factsWithDefine,
  fileModeChanged,
  formatCharacterHeld,
  fragmentRequired,
  fragmentsAfterCut,
  gitFailed,
  initialNeedsZero,
  installerWithoutRepository,
  integrityMismatch,
  invalidDirectoryName,
  invalidJsonAnswer,
  invalidPackageVersion,
  invalidUtf8Line,
  invalidVersionField,
  keptAsset,
  librariesChanged,
  librariesOffTitle,
  libraryNamesRepeat,
  libraryState,
  libraryVersionsDiffer,
  linterQuestion,
  lockExists,
  lockfileInvalidYaml,
  lockfileMismatch,
  lockfilePreparationFailed,
  lockfileTimedOut,
  manifestNotJson,
  manifestNotJsonAt,
  manifestNotObject,
  manyApplicationExports,
  migrationLabels,
  minimumAboveRelease,
  missingBun,
  missingModule,
  narrativeHeadings,
  neverAppeared,
  nextVersion,
  noApplicationExport,
  noApplicationName,
  noBinName,
  noChangelogSection,
  noCompiledHeading,
  noFragments,
  noFragmentsToCut,
  noHostTarget,
  noLibraries,
  noPackageJson,
  noPendingFragments,
  noRepositoryField,
  notAnObject,
  notAString,
  notAWordList,
  notCalendarDate,
  notCurrentVersion,
  notEmptyWithoutPackage,
  notInRepository,
  noVersionCommit,
  noVersionField,
  oneCompiledSection,
  onlyVersionField,
  onRegistry,
  optionLine,
  outputIsDirectory,
  outsideCut,
  pendingFragments,
  plainTypescript,
  planDecision,
  planHeading,
  planWithoutNotes,
  pnpmMissing,
  prChecksPassed,
  prereleaseNeedsSection,
  provenanceConflict,
  provenanceElsewhere,
  provenanceNotOurs,
  provenanceOf,
  provenanceWithoutSource,
  prShallow,
  readFromRegistry,
  recorded,
  refusedRequest,
  refusedTarget,
  releaseBranchBehind,
  releaseShallow,
  releaseState,
  releaseWithoutEntries,
  removedFile,
  repositoryNeedsRelease,
  requestTimedOut,
  restoreFailed,
  reusedRelease,
  reusedTag,
  rollbackIncomplete,
  sameEntryFile,
  sectionExists,
  sectionNotCompiled,
  sectionWithoutNotes,
  shallowHistory,
  sharedFileMissing,
  sharedFileOtherVersion,
  sharedFileUnparsed,
  sharedFileUnreadable,
  sharedFileWithoutVersion,
  sharedVersionNotList,
  sharedVersionRefused,
  skillInvalidYaml,
  skillMissing,
  skillsFolderJudged,
  skillsNotCalled,
  skillsNotLoaded,
  skillVersionMismatch,
  skillVersionNotString,
  skillVersionUnset,
  skillWithoutFrontmatter,
  skillWithoutVersion,
  stableTargetOnly,
  staleSkillFile,
  symlinkedPackage,
  tagAwayFromPublication,
  tagExists,
  tagNamesOther,
  tagObjectMissing,
  tagState,
  tagWithoutProvenance,
  tarballOf,
  targetBelowMinimum,
  targetBelowRelease,
  targetNotAbove,
  targetNotVersion,
  testRunnerQuestion,
  theAsset,
  theRelease,
  theTag,
  tokenRequired,
  twoSkillsFolders,
  unclosedBlock,
  uncommittedFragment,
  unexportedApplication,
  unloadedApplication,
  unreadableRepositoryField,
  unreadableSkillsRegistry,
  unreadReason,
  unreleasedPlan,
  unreleasedSection,
  unsafeLine,
  unstableLibraryVersions,
  unsupportedIntegrity,
  uploadedAsset,
  uploadOriginRefused,
  uploadsDisagree,
  useBuild,
  useLinter,
  useOwnerName,
  usePiece,
  useTestRunner,
  useVersion,
  useWholeNumber,
  verifiedTarball,
  versionCannotAdvance,
  versionMustStay,
  versionNotCut,
  watchExited,
  watchIsDevelopment,
  wroteFile,
};
