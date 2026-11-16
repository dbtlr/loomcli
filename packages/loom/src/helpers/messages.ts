/*
 * The `loom` bin's operator sentences that every launch loads, under ADR-0164. Each command keeps its
 * other sentences in its own module. `tests/message-voice.test.ts` holds this module to the voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const escaped = escapeControlCharacters;

// Build facts and targets.

const noRepositoryField =
  'package.json has no repository field, so pass --repository <owner/name> to name the repository the release belongs to.';

const unreadableRepositoryField =
  'The package.json repository field does not read as owner/name, so pass --repository <owner/name>.';

const noVersionField = 'package.json has no version field, so set version to build a release.';

function invalidVersionField(version: unknown): string {
  return `The package.json version field ${escaped(JSON.stringify(version))} is not a semantic version, so set it to one, such as 1.0.0.`;
}

const noBinName =
  'package.json names no application in bin, a string or an object with one key, so pass --name <name>.';

const noApplicationName =
  'package.json names no application in bin or name, so set its name field and run loom init again.';

const acceptedTargets =
  'Use node, bun, or a Bun compile target bun-<os>-<arch> for linux or darwin on x64 or arm64, with -musl on linux and -baseline or -modern on x64, such as bun-linux-x64.';

function refusedTarget(value: string): string {
  const problem =
    value === 'browser'
      ? 'browser is refused, because a Loom application runs as a command.'
      : `${escaped(JSON.stringify(value))} is not a target.`;
  return [problem, acceptedTargets].join(' ');
}

function noHostTarget(name: string): string {
  return `Bun compiles for no target on this host (${escaped(name)}), so pass --target.`;
}

// Modules and the package directory.

function noPackageJson(cwd: string): string {
  return `No package.json at or above ${escaped(cwd)}. Run loom inside a package directory.`;
}

// Manifests.

const expectedVersionString = 'package.json: expected a version string.';

function manifestNotJson(path: string): string {
  return `${escaped(path)} is not valid JSON, so fix it there and run loom again.`;
}

function manifestNotJsonAt(
  path: string,
  { column, expected, line }: { column: number; expected: string; line: number },
): string {
  return `${escaped(path)} is not valid JSON: line ${String(line)}, column ${String(column)} needs ${escaped(expected)}, so fix it there and run loom again.`;
}

function manifestNotObject(path: string): string {
  return `${escaped(path)} is not a JSON object, so write its fields between { and } and run loom again.`;
}

const notAnObject = 'Invalid type: Expected Object';

function notAString(value: unknown): string {
  return `Invalid type: Expected string but received ${escaped(JSON.stringify(value))}`;
}

const notAWordList = 'Expected a non-empty array of strings';

// Repository reads.

function gitFailed(command: string, output: string): string {
  return `git ${escaped(command)} failed: ${output}`;
}

function expectedRegularFile(path: string): string {
  return `${escaped(path)}: expected a regular file.`;
}

const releaseShallow = 'Release preparation requires full Git history.';

function symlinkedPackage(name: string): string {
  return `packages/${escaped(name)}: symlinks are not supported.`;
}

const libraryNamesRepeat = 'Publishable library names must be unique.';

const libraryVersionsDiffer = 'Publishable library versions must match.';

const noLibraries = 'No publishable libraries in packages/*.';

const unstableLibraryVersions = 'Library versions must be stable 0.x versions.';

// Commands: option and argument issues.

const useBuild = 'Use development or distributed.';

const useOwnerName = 'Use owner/name, such as acme/notes.';

const useVersion =
  'Use MAJOR.MINOR.PATCH with an optional -prerelease part, such as 1.5.0 or 1.5.0-rc.1, and no leading v or build metadata.';

const usePiece =
  'Use application, entry, tsconfig, test, lint, package, changes, skill, or install.';

const useLinter = 'Use oxlint or eslint.';

const useTestRunner = 'Use bun or vitest.';

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
