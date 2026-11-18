/*
 * The `loom` bin's operator sentences that every launch loads, under ADR-0164. Each command keeps its
 * other sentences in its own module. `tests/message-voice.test.ts` holds this module to the voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const escaped = escapeControlCharacters;

// System errors.

// A system error's code in parentheses, or nothing for a throw that carries no string code.
function codeNote(code: string | undefined): string {
  return code === undefined ? '' : ` (${escaped(code)})`;
}

/*
 * The cause of a system error in Loom's words, from its code, which every sentence about a file the
 * bin cannot use reads, so one cause reads the same at every site. A code no line names gives the
 * bare code in parentheses.
 */
function systemCause(code: string | undefined): string {
  switch (code) {
    case 'ENOENT': {
      return ', because it does not exist';
    }
    case 'EISDIR': {
      return ', because it is a folder';
    }
    case 'ENOTDIR': {
      return ', because a path on the way is a file';
    }
    case 'EACCES':
    case 'EPERM': {
      return ', because permission was denied';
    }
    case 'EROFS': {
      return ', because the file system is read-only';
    }
    case 'ENOSPC': {
      return ', because no space is left';
    }
    default: {
      return codeNote(code);
    }
  }
}

// What a failed system call was doing to its path, as a verb, such as read for a read of a file.
function systemVerb(syscall: string): string {
  switch (syscall) {
    case 'access':
    case 'lstat':
    case 'opendir':
    case 'read':
    case 'readlink':
    case 'scandir':
    case 'stat': {
      return 'read';
    }
    case 'mkdir':
    case 'mkdtemp': {
      return 'create';
    }
    case 'open': {
      return 'open';
    }
    case 'rm':
    case 'rmdir':
    case 'unlink': {
      return 'remove';
    }
    case 'write': {
      return 'write';
    }
    default: {
      return 'use';
    }
  }
}

// The step for a file the bin cannot use, from the system error's code.
function fileStep(verb: string, code: string): string {
  switch (code) {
    case 'ENOENT': {
      return 'Check the path and each folder on the way to it, then run the command again.';
    }
    case 'EISDIR': {
      return 'Name a file, not a folder, then run the command again.';
    }
    case 'ENOTDIR': {
      return 'Check each folder on the way to it, then run the command again.';
    }
    case 'EACCES':
    case 'EPERM': {
      return `Check that your user can ${escaped(verb)} it and has execute access to each folder above it, then run the command again.`;
    }
    case 'EROFS': {
      return 'Name a path on a writable file system, then run the command again.';
    }
    case 'ENOSPC': {
      return 'Free some space, then run the command again.';
    }
    default: {
      return `Check that you can ${escaped(verb)} it, then run the command again.`;
    }
  }
}

function cannotUseFile(verb: string, path: string, code: string): string {
  return `Cannot ${escaped(verb)} ${escaped(path)}${systemCause(code)}. ${fileStep(verb, code)}`;
}

function systemFailure(code: string): string {
  return `The command failed on a system error (${escaped(code)}). Check the files it reads and writes, then run it again.`;
}

const gitMissing =
  'git is not on the PATH, and loom reads the repository with it. Install git and run the command again.';

function cannotRun(program: string, code: string | undefined): string {
  return `Cannot run ${escaped(program)}${codeNote(code)}. Check that ${escaped(program)} is installed and that you can run it, then run the command again.`;
}

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
  return `git ${escaped(command)} failed, so fix what git reported and run the command again: ${output}`;
}

function expectedRegularFile(path: string): string {
  return `${escaped(path)}: expected a regular file.`;
}

const releaseShallow = 'Release preparation requires full Git history.';

function symlinkedPackage(name: string): string {
  return `packages/${escaped(name)}: symlinks are not supported, so replace the link with the package's own directory.`;
}

const libraryNamesRepeat = 'Publishable library names must be unique.';

const libraryVersionsDiffer = 'Publishable library versions must match.';

const noLibraries =
  'No publishable libraries in packages/*, so run the command at the root of a repository whose packages/* holds a package that is not private.';

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

const useHttpUrl = 'Use an http or https URL.';

export {
  acceptedTargets,
  cannotRun,
  cannotUseFile,
  codeNote,
  expectedRegularFile,
  expectedVersionString,
  gitFailed,
  gitMissing,
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
  systemCause,
  systemFailure,
  systemVerb,
  unreadableRepositoryField,
  unstableLibraryVersions,
  useBuild,
  useHttpUrl,
  useLinter,
  useOwnerName,
  usePiece,
  useTestRunner,
  useVersion,
  useWholeNumber,
};

export const skillsUnavailable =
  'The application records no skills plugin. Install a current @loomcli/plugins and declare skills(), then export again.';
export const noSkills =
  'The application declares no skills. Add a skill to skills(), then export again.';
export function unknownSkill(name: string): string {
  return `Skill "${escaped(name)}" is not declared. Name a declared skill or omit --skill to export all skills.`;
}
export function exportedSkills(path: string): string {
  return `Exported skills to ${escaped(path)}.\n`;
}

export function sourceSkillsOutput(path: string): string {
  return `Cannot export to ${escaped(path)}: export would write into the application's skills folder, which holds the source. Name another directory.`;
}
export function occupiedSkillOutput(path: string): string {
  return `Cannot replace ${escaped(path)}: it is not a skill folder, which holds a SKILL.md. Move or remove it, or name another directory.`;
}
