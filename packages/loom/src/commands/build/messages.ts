/*
 * The operator sentences of `loom build`, under ADR-0164: the failures its work and the helpers that
 * serve it raise, which run Bun, read an application module and its `skills()` calls, and resolve
 * its modules, and the confirmation it prints when it is done. `loom init` reads an application
 * module through the same helpers, so its route loads this module too. A launch never loads it,
 * because only the build's work and those helpers import it. Each is a function of the values it
 * repeats, or a constant, and the code that raises the failure or writes the line calls it. Every
 * value a sentence repeats is escaped, except `output`: the text another program or another failure
 * wrote, which a sentence repeats whole, its lines included. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** Escapes one value a sentence repeats. */
const escaped = escapeControlCharacters;

// Application readers.

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

export {
  applicationNeedsBundle,
  built,
  bunBuildFailed,
  bunCouldNotRead,
  carriedFolderOverlap,
  factsWithDefine,
  missingBun,
  missingModule,
  optionLine,
  outputIsDirectory,
  repositoryNeedsRelease,
  sameEntryFile,
  skillsFolderJudged,
  skillsNotCalled,
  skillsNotLoaded,
  twoSkillsFolders,
  unreadableSkillsRegistry,
  watchExited,
  watchIsDevelopment,
};
