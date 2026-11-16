/*
 * The operator sentences of `loom init`, under ADR-0164: the questions and warnings it writes, the
 * failures its work and the helpers that serve it raise, which read the application module's
 * exports and the files init manages, and the lines it prints for each file it writes. `loom pr
 * check` checks managed files through the same helper, so its route loads this module too. A launch
 * never loads it, because only init's work and those helpers import it. Each is a function of the
 * values it repeats, or a constant, and the code that raises the failure or writes the line calls
 * it. Every value a sentence repeats is escaped. `tests/message-voice.test.ts` holds this module to
 * the failure message voice.
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

// Manifests.

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
  addedKey,
  cannotRemove,
  cannotWrite,
  coreUnresolved,
  coreWithoutApplication,
  createPackageQuestion,
  driftedManagedFile,
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
