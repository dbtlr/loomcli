/*
 * The operator sentences of `loom build` and the helpers that serve it, under ADR-0164. `loom init`
 * loads this module too. A launch never does. Every value is escaped, except `output`.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const escaped = escapeControlCharacters;

// Application readers.

function bunCouldNotRead(output: string, module: string): string {
  return `${output}\n\nBun could not read ${escaped(module)}, so fix what Bun reported and run the command again.`;
}

const unreadableSkillsRegistry =
  'This @loomcli/loom cannot read the skills() calls the installed @loomcli/plugins recorded, so install @loomcli/plugins and @loomcli/loom at one version, and build again.';

function twoSkillsFolders(module: string, first: string, second: string): string {
  return `${escaped(module)} calls skills() with two folders, ${escaped(first)} and ${escaped(second)}, and a build carries one, so name one folder.`;
}

function skillsFolderJudged(output: string, folder: string): string {
  return `${output}\n\nloom build judged the skills folder ${escaped(folder)} and built nothing, so fix what it reported and run loom build again.`;
}

// Bun.

const missingBun =
  'Bun is not on the PATH, and loom build and loom init do their work under Bun. Install Bun from https://bun.sh and run the command again.';

function bunBuildFailed(output: string): string {
  return `${output}\n\nBun could not build the application, so no output changed. Fix what Bun reported, then run loom build again.`;
}

function watchExited(code: number): string {
  return `bun build --watch exited with ${String(code)}, so fix what Bun reported and run loom build --watch again.`;
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

// The npm launcher packages.

const npmModeOff =
  '--target npm builds the launcher and platform packages, which loom.config.json does not turn on. Set "npm": { "launcher": true } in loom.config.json, or build a bundle with --target node.';

const npmIsDistributed =
  '--target npm builds distributed release binaries, so pass --build distributed or no --build with it.';

const npmDoesNotWatch =
  '--watch rebuilds one development artifact, and --target npm builds release packages, so build them without --watch.';

function npmFactsPerPlatform(option: string): string {
  return `--target npm compiles one binary per platform, each with facts of its own, so read one platform's with --target bun-<platform> --release --${escaped(option)}.`;
}

function npmOutOverlap(out: string, relation: string, directory: string): string {
  return `${escaped(out)}, where loom build writes the npm packages, ${escaped(relation)} the package directory ${escaped(directory)}, and the build replaces each package's directory whole, so name a directory with --out that neither is nor holds the package directory.`;
}

const noNameField =
  'package.json has no name field, and the npm packages are named for it, so set name to build them.';

function npmPackageNameInvalid(name: string): string {
  return `package.json names the package "${escaped(name)}", which npm does not accept, and the npm packages and their folders are named for it, so set name to lowercase letters, digits, "-", ".", "_", and "~", starting with a letter or a digit, with an optional "@scope/" before it.`;
}

function npmApplicationNameInvalid(name: string): string {
  return `The application's name is "${escaped(name)}", which is not a portable name, and the npm packages hold the binary and the launcher's bin entry under it, so set --name, the name key of loom.config.json, or the package.json bin key to letters, digits, ".", "_", and "-", not starting with "-" or ".".`;
}

function npmFolderNotOwned(folder: string, pkg: string): string {
  return `${escaped(folder)} is not a folder whose package.json names ${escaped(pkg)}, and loom build replaces only the npm packages it wrote, so move or remove it, or name another directory with --out.`;
}

function platformPackageDescription(platform: string, pkg: string): string {
  return `The ${escaped(platform)} binary of ${escaped(pkg)}.`;
}

// Platforms in a list that reads as a sentence: a, b, and c.
function series(items: readonly string[]): string {
  return items.length > 2
    ? [items.slice(0, -1).join(', '), items.slice(-1).join('')].join(', and ')
    : items.join(' and ');
}

/*
 * The launcher's sentences, which the build renders into it under ADR-0213. Each starts with the
 * application's name, and `{platform}`, `{path}`, and `{cause}` are what only the launcher's run
 * knows: it fills them with the host's platform, the binary's path, each escaped, and the cause.
 */

function launcherNoPlatform(name: string, pkg: string, platforms: readonly string[]): string {
  return `${escaped(name)}: ${escaped(pkg)} has no binary for {platform}. It runs on ${escaped(series(platforms))}.`;
}

function launcherMissingPackage(name: string, pkg: string, version: string): string {
  return `${escaped(name)}: The package ${escaped(pkg)}-{platform}@${escaped(version)}, which holds the binary for {platform}, is not installed. Install ${escaped(pkg)} again without --omit=optional, or install ${escaped(pkg)}-{platform}@${escaped(version)} beside it.`;
}

function launcherCannotStart(name: string, pkg: string, version: string): string {
  return `${escaped(name)}: Cannot start {path} from ${escaped(pkg)}-{platform}{cause}. Install ${escaped(pkg)}-{platform}@${escaped(version)} again so its binary is an executable file on disk.`;
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
  launcherCannotStart,
  launcherMissingPackage,
  launcherNoPlatform,
  missingBun,
  missingModule,
  noNameField,
  npmApplicationNameInvalid,
  npmDoesNotWatch,
  npmFactsPerPlatform,
  npmFolderNotOwned,
  npmIsDistributed,
  npmModeOff,
  npmOutOverlap,
  npmPackageNameInvalid,
  optionLine,
  outputIsDirectory,
  platformPackageDescription,
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
