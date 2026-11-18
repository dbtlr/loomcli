import type { CommandGraph, ReleaseFacts } from '@loomcli/core';

import type { FolderFile } from '../installation/folders.js';
import { carriedBase, carriedSkills } from './carried.js';
import { judged } from './judge.js';
import { renderReferences } from './references.js';
import { referencesFolder } from './selection.js';
import type { Declared } from './settings.js';
import { folderSkills } from './source.js';
import type { SkillFile, SkillFolder } from './types.js';

/** A skill whose files the plugin read or a loader answered and the plugin judged, ready to write. */
interface LoadedSkill {
  readonly name: string;
  /** The files with the mode each is written with, whatever the umask. */
  readonly files: readonly FolderFile[];
}

/** An author's file the install leaves out, because the plugin owns its name. */
interface LeftOut {
  readonly skill: string;
  readonly path: string;
}

/** Every skill an install writes, in install order, and the author's files it leaves out. */
interface LoadedSkills {
  readonly skills: readonly SkillFolder[];
  readonly leftOut: readonly LeftOut[];
}

/** What a load reads beside the declaration: the run's build and graph, and the module's directory. */
interface LoadRequest {
  readonly build: ReleaseFacts['build'];
  readonly graph: CommandGraph;
  /** The application module's directory, which a relative folder setting resolves against. */
  readonly moduleDirectory?: string | undefined;
}

/** The mode of an executable file. */
const executableMode = 0o755;

/** The mode of any other file. */
const plainMode = 0o644;

/** The files of a judged result with the mode each is written with. */
function withModes(files: readonly SkillFile[]): (FolderFile & { readonly mode: number })[] {
  return files.map(({ content, executable, path }) => ({
    content,
    mode: executable === true ? executableMode : plainMode,
    path,
  }));
}

/**
 * Whether the plugin owns a path in a skill that selects Commands: `index.md`, `<app>.md`, or any
 * `<app>-*.md` directly under `references/commands/`. The `loom` bin's `loom docs` states the same
 * three names for its output directory, in `packages/loom/src/commands/docs/write.ts`; change the two
 * together.
 */
function isOwned(path: string, application: string): boolean {
  if (!path.startsWith(referencesFolder)) {
    return false;
  }
  const name = path.slice(referencesFolder.length);
  return (
    !name.includes('/') &&
    (name === 'index.md' ||
      name === `${application}.md` ||
      (name.startsWith(`${application}-`) && name.endsWith('.md')))
  );
}

/**
 * One skill's author files and generated files as one set. A skill that selects Commands leaves out
 * each author's file at a name the plugin owns and lists the generated files after the author's;
 * one that selects none keeps exactly its author's files.
 */
function withReferences(
  skill: { readonly name: string; readonly files: readonly SkillFile[] },
  {
    commands,
    graph,
  }: { readonly commands: readonly (readonly string[])[]; readonly graph: CommandGraph },
): { name: string; files: readonly SkillFile[]; leftOut: readonly LeftOut[] } {
  const [first] = commands;
  if (first === undefined) {
    return { files: skill.files, leftOut: [], name: skill.name };
  }
  const kept = skill.files.filter(({ path }) => !isOwned(path, graph.name));
  const leftOut = skill.files
    .filter(({ path }) => isOwned(path, graph.name))
    .map(({ path }) => ({ path, skill: skill.name }));
  const generated = renderReferences(graph, { commands, guidance: true }, skill.name).map(
    ({ content, name }) => ({ content, executable: false, path: `${referencesFolder}${name}` }),
  );
  return { files: [...kept, ...generated], leftOut, name: skill.name };
}

/**
 * Reads the skills folder, then calls each listed skill's loader once, in declaration order,
 * awaiting each, then judges every result before anything is written, then generates each
 * selecting skill's command references from the graph. The folder's skills come first, in name
 * order, then the listed skills. The first fault throws a `DeclarationError`, and a loader that
 * throws or rejects fails the run as it threw.
 */
async function loadSkills(declared: Declared, request: LoadRequest): Promise<LoadedSkills> {
  const fromFolder = folderSkills({
    base: carriedBase,
    build: request.build,
    carried: carriedSkills(),
    moduleDirectory: request.moduleDirectory,
    names: {
      listed: declared.skills.map(({ name }) => name),
      selecting: declared.folderEntries,
    },
    setting: declared.folder,
  });
  const answers: { name: string; files: readonly SkillFile[] }[] = [];
  for (const { files, name } of declared.skills) {
    answers.push({ files: await files(), name });
  }
  const authored = [
    ...fromFolder,
    ...answers.map(({ files, name }) => ({ files: judged(name, files), name })),
  ];
  const sets = authored.map((skill) =>
    withReferences(skill, {
      commands: declared.selections.find(({ name }) => name === skill.name)?.commands ?? [],
      graph: request.graph,
    }),
  );
  return {
    leftOut: sets.flatMap(({ leftOut }) => leftOut),
    skills: sets.map(({ files, name }) => ({
      files: files.map(({ content, executable, path }) => ({
        content,
        executable: executable === true,
        path,
      })),
      name,
    })),
  };
}

export type { LeftOut, LoadedSkill, LoadedSkills };
export { isOwned, loadSkills, withModes };
