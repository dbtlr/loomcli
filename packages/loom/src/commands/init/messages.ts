/*
 * The operator sentences of `loom init` and the helpers that serve it, under ADR-0164. `loom pr
 * check` loads this module too. A launch never does. Every value is escaped. `tests/message-
 * voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

import { codeNote, systemCause } from '../../helpers/messages.js';

const escaped = escapeControlCharacters;

// Application readers.

function coreUnresolved(module: string): string {
  return `@loomcli/core does not resolve from the package, so install it before init reads ${escaped(module)}.`;
}

function coreWithoutApplication(module: string): string {
  return `The @loomcli/core the package resolves exports no Application to read ${escaped(module)} with.`;
}

function noApplicationExport(module: string): string {
  return `${escaped(module)} exports no Application, so export the Application the entry runs.`;
}

function manyApplicationExports(module: string, count: number): string {
  return `${escaped(module)} exports ${String(count)} Applications, so export one Application from it.`;
}

// Manifests.

function driftedManagedFile(path: string): string {
  return `warning: ${escaped(path)} differs from what loom init wrote. Run loom init --force to restore it, or delete its header to keep your edits.`;
}

// Commands: init.

function invalidDirectoryName(name: string): string {
  return `The directory name "${escaped(name)}" is not a valid package name, so rename the directory or write a package.json with the name to use.`;
}

function notEmptyWithoutPackage(cwd: string): string {
  return `${escaped(cwd)} is not empty and no package.json is at or above it, so create one with npm init -y, or your package manager's equivalent, and run loom init again.`;
}

const createPackageQuestion = 'No package.json is here or above it. Create one in this directory?';

const linterQuestion = 'Which linter should the scaffold use?';

const testRunnerQuestion = 'Which test runner should the scaffold use?';

// Each sentence of a file init cannot write, remove, or read names the cause from the code.
function cannotWrite(path: string, code: string | undefined): string {
  switch (code) {
    case 'EISDIR': {
      return `Cannot write ${escaped(path)}${systemCause(code)}. Remove or rename the folder, then run loom init again.`;
    }
    case 'ENOTDIR': {
      return `Cannot write ${escaped(path)}${systemCause(code)}. Remove or rename the file on the way, then run loom init again.`;
    }
    case 'EACCES':
    case 'EPERM': {
      return `Cannot write ${escaped(path)}${systemCause(code)}. Give your user write access to it and its folder, and execute access to each folder above it, then run loom init again.`;
    }
    case 'EROFS': {
      return `Cannot write ${escaped(path)}${systemCause(code)}. Run loom init in a package on a writable file system.`;
    }
    case 'ENOSPC': {
      return `Cannot write ${escaped(path)}${systemCause(code)}. Free some space, then run loom init again.`;
    }
    default: {
      return `Cannot write ${escaped(path)}${codeNote(code)}. Check that you can write to it and its directory, then run loom init again.`;
    }
  }
}

function fileInTheWay(path: string, file: string): string {
  return `Cannot write ${escaped(path)}, because ${escaped(file)} is a file. Remove or rename it, then run loom init again.`;
}

function cannotRemove(path: string, code: string | undefined): string {
  switch (code) {
    case 'EACCES':
    case 'EPERM': {
      return `Cannot remove ${escaped(path)}${systemCause(code)}. Give your user write access to its folder, and execute access to each folder above it, then run loom init again.`;
    }
    case 'EROFS': {
      return `Cannot remove ${escaped(path)}${systemCause(code)}. Run loom init in a package on a writable file system.`;
    }
    default: {
      return `Cannot remove ${escaped(path)}${codeNote(code)}. Check that you can write to its directory, then run loom init again.`;
    }
  }
}

function cannotRead(path: string, code: string | undefined): string {
  switch (code) {
    case 'EISDIR': {
      return `Cannot read ${escaped(path)}${systemCause(code)}. Remove or rename the folder, then run loom init again.`;
    }
    case 'EACCES':
    case 'EPERM': {
      return `Cannot read ${escaped(path)}${systemCause(code)}. Give your user read access to it, and execute access to each folder above it, then run loom init again.`;
    }
    default: {
      return `Cannot read ${escaped(path)}${codeNote(code)}. Check that you can read it, then run loom init again.`;
    }
  }
}

function wroteFile(path: string): string {
  return `Wrote ${escaped(path)}.`;
}

function removedFile(path: string): string {
  return `Removed ${escaped(path)}.`;
}

function addedKey(key: string): string {
  return `Added ${escaped(key)} to package.json.`;
}

function staleSkillFile(path: string): string {
  return `warning: ${escaped(path)} differs from what loom init wrote, and the running loom no longer ships it. Run loom init --force to remove it, or delete its header to keep it.`;
}

function installerWithoutRepository(path: string): string {
  return `warning: ${escaped(path)} was not written because package.json names no GitHub repository. Set repository to a GitHub address such as owner/name, then run loom init again.`;
}

function plainTypescript(range: string, alias: string, guide: string): string {
  return `warning: package.json declares typescript as ${escaped(range)}, and typescript-eslint supports TypeScript below 6.1, so eslint . fails on TypeScript 7. Set typescript to npm:@typescript/typescript6@${escaped(alias)} and add @typescript/native as npm:typescript@${escaped(range)}, which keeps tsc on your compiler. See ${escaped(guide)}.`;
}

// The reason a read that failed on a system error gives, with its code when it carries one.
function unreadReason(code: string | undefined): string {
  return `it could not be read${codeNote(code)}`;
}

function unloadedApplication(
  path: string,
  application: string,
  reason: string,
  noun: string,
  command = 'loom init',
): string {
  return `warning: ${escaped(path)} was not written because ${escaped(application)} could not be loaded: ${escaped(reason)}. Install the package and run ${escaped(command)} again, or write the ${escaped(noun)} by hand.`;
}

function unexportedApplication(path: string, application: string, noun: string): string {
  return `warning: ${escaped(path)} was not written because ${escaped(application)} exports no Application loom can read. Write the ${escaped(noun)} by hand.`;
}

export {
  addedKey,
  cannotRead,
  cannotRemove,
  cannotWrite,
  coreUnresolved,
  coreWithoutApplication,
  createPackageQuestion,
  driftedManagedFile,
  fileInTheWay,
  installerWithoutRepository,
  invalidDirectoryName,
  linterQuestion,
  manyApplicationExports,
  noApplicationExport,
  notEmptyWithoutPackage,
  plainTypescript,
  removedFile,
  staleSkillFile,
  testRunnerQuestion,
  unexportedApplication,
  unloadedApplication,
  unreadReason,
  wroteFile,
};
