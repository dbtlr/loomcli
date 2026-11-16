/*
 * The `loom` bin's operator sentences that every launch loads, under ADR-0164: the issues the
 * command declarations' option and argument validators report, the sentences of the helpers a
 * declaration imports, which read build facts and targets, manifests, `loom.config.json`, and the
 * repository, and the package-directory helper's one sentence, which build and changelog share.
 * Because every launch loads this module, it holds no other sentence: each command keeps its own,
 * with those of the helpers that serve it, in `src/commands/<command>/messages.ts`, which a run
 * loads only on a route that needs it. Each is a function of the values it repeats, or a constant,
 * and the code that raises the failure or writes the line calls it. Every value a sentence repeats
 * is escaped, except `output`: the text another program wrote, which a sentence repeats whole, its
 * lines included. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** Escapes one value a sentence repeats. */
const escaped = escapeControlCharacters;

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

// Modules and the package directory.

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

export {
  acceptedTargets,
  expectedRegularFile,
  expectedVersionString,
  gitFailed,
  invalidVersionField,
  libraryNamesRepeat,
  libraryVersionsDiffer,
  manifestNotJson,
  manifestNotJsonAt,
  manifestNotObject,
  noApplicationName,
  noBinName,
  noHostTarget,
  noLibraries,
  noPackageJson,
  noRepositoryField,
  noVersionField,
  notAString,
  notAWordList,
  notAnObject,
  refusedTarget,
  releaseShallow,
  symlinkedPackage,
  unreadableRepositoryField,
  unstableLibraryVersions,
  useBuild,
  useLinter,
  useOwnerName,
  usePiece,
  useTestRunner,
  useVersion,
  useWholeNumber,
};
