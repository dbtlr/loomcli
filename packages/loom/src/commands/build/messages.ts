/*
 * The operator sentences of `loom build` and the helpers that serve it, under ADR-0164. `loom init`
 * loads this module too. A launch never does. Every value is escaped, except `output`.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const escaped = escapeControlCharacters;

// Application readers.

function bunCouldNotRead(output: string, module: string): string {
  return `${output}\n\nBun could not read ${escaped(module)}.`;
}

const unreadableSkillsRegistry =
  'This @loomcli/loom cannot read the skills() calls the installed @loomcli/plugins recorded, so install @loomcli/plugins and @loomcli/loom at one version, and build again.';

function twoSkillsFolders(module: string, first: string, second: string): string {
  return `${escaped(module)} calls skills() with two folders, ${escaped(first)} and ${escaped(second)}, and a build carries one, so name one folder.`;
}

function skillsFolderJudged(output: string, folder: string): string {
  return `${output}\n\nloom build judged the skills folder ${escaped(folder)} and built nothing.`;
}

// Bun.

const missingBun =
  'Bun is not on the PATH, and loom build and loom init do their work under Bun. Install Bun from https://bun.sh and run the command again.';

function bunBuildFailed(output: string): string {
  return `${output}\n\nBun could not build the application, so no output changed.`;
}

function watchExited(code: number): string {
  return `bun build --watch exited with ${String(code)}.`;
}

// Modules and the package directory.

function missingModule(path: string, naming: string): string {
  return `${escaped(path)} does not exist, so create it or name the module with ${escaped(naming)}.`;
}

// Commands: build.

function optionLine(name: string, sentence: string): string {
  return `Option "--${escaped(name)}": ${escaped(sentence)}`;
}

const factsWithDefine = '--facts and --define exclude each other, so pass one of them.';

const applicationNeedsBundle =
  '--application applies to a node or bun bundle, so pass --target node or --target bun with it.';

const repositoryNeedsRelease =
  '--repository applies to a --release build, so pass --release with it.';

const watchIsDevelopment = '--watch builds development, so pass --watch or --build distributed.';

function sameEntryFile(entry: string, application: string, file: string): string {
  return `The entry ${escaped(entry)} and the application module ${escaped(application)} both build to ${escaped(file)}, so rename one of them or name another module with --entry or --application.`;
}

function outputIsDirectory(output: string): string {
  return `${escaped(output)} is a directory, and a binary is one file, so name the binary's file with --out.`;
}

function carriedFolderOverlap(carried: string, relation: string, folder: string): string {
  return `${escaped(carried)}, where the bundle carries the skills, ${escaped(relation)} the skills folder ${escaped(folder)}, and loom build never writes into the source tree, so name another directory with --out.`;
}

function skillsNotCalled(name: string): string {
  return `${escaped(name)} carries the skills plugin, but skills() did not run while loom build loaded the application module, so it carried no skills folder. Call skills() as the module paths.application names loads, src/application.ts by convention, if it names a folder.`;
}

function skillsNotLoaded(name: string): string {
  return `${escaped(name)} carries the skills plugin, but loom build could not load the application module, so it carried no skills folder. Export the Application from the module paths.application names, src/application.ts by convention, if skills() names a folder.`;
}

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
