import { DeclarationError, escapeControlCharacters } from '@loomcli/core';

import type { FolderFile } from '../installation/folders.js';
import { skillsFiles } from '../rules.js';
import type { Skill, SkillFile } from './types.js';

/** A skill whose files the loader answered and the plugin judged, ready to write. */
interface LoadedSkill {
  readonly name: string;
  /** The files with the mode each is written with, whatever the umask. */
  readonly files: readonly FolderFile[];
}

/** The mode of an executable file. */
const executableMode = 0o755;

/** The mode of any other file. */
const plainMode = 0o644;

/** The file every skill lists. */
const entryFile = 'SKILL.md';

/** The corrections of the faults, each declared once beside its sentence. */
const corrections = {
  missing: "Add the skill's SKILL.md at the top of its files.",
  path: 'Use a relative path with no .. part, such as references/commands.md.',
};

/** The fault a skill's loaded files hold: its sentence, and the correction beside it. */
function fault(sentence: string, correction: string): DeclarationError {
  return new DeclarationError(skillsFiles, { correction, sentence });
}

/** Whether a path leaves the skill's folder: it is absolute, or one of its parts is `..`. */
function leavesFolder(path: string): boolean {
  return path.startsWith('/') || path.split('/').includes('..');
}

/** The fault of a path that leaves the skill's folder, or none. */
function pathFault(shown: string, files: readonly SkillFile[]): DeclarationError | undefined {
  const outside = files.find(({ path }) => leavesFolder(path));
  return outside === undefined
    ? undefined
    : fault(
        `Skill "${shown}" lists a file path outside its folder: ${escapeControlCharacters(outside.path)}.`,
        corrections.path,
      );
}

/** The fault of a skill that lists no `SKILL.md`, or none. */
function entryFileFault(shown: string, files: readonly SkillFile[]): DeclarationError | undefined {
  return files.some(({ path }) => path === entryFile)
    ? undefined
    : fault(`Skill "${shown}" lists no ${entryFile}.`, corrections.missing);
}

/**
 * A skill's loaded files, or the first fault they hold, in the order the contract lists them. The
 * name passed the skill-name grammar, so a sentence repeats it as it is.
 */
function judged(name: string, files: readonly SkillFile[]): readonly SkillFile[] {
  const found = pathFault(name, files) ?? entryFileFault(name, files);
  if (found !== undefined) {
    throw found;
  }
  return files;
}

/** The files of a judged result with the mode each is written with. */
function withModes(files: readonly SkillFile[]): FolderFile[] {
  return files.map(({ content, executable, path }) => ({
    content,
    mode: executable === true ? executableMode : plainMode,
    path,
  }));
}

/**
 * Calls each skill's loader once, in declaration order, awaiting each, then judges every result
 * before anything is written. The first fault throws a `DeclarationError`, and a loader that
 * throws or rejects fails the run as it threw.
 */
async function loadSkills(skills: readonly Skill[]): Promise<readonly LoadedSkill[]> {
  const answers: { name: string; result: readonly SkillFile[] }[] = [];
  for (const { files, name } of skills) {
    answers.push({ name, result: await files() });
  }
  return answers.map(({ name, result }) => ({ files: withModes(judged(name, result)), name }));
}

export type { LoadedSkill };
export { loadSkills };
