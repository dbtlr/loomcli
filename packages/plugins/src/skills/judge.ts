import { DeclarationError, escapeControlCharacters } from '@loomcli/core';

import { skillsFiles } from '../rules.js';
import type { SkillFile } from './types.js';

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
 * A skill's files, a loader's or a folder's, or the first fault they hold, in the order the
 * contract lists them. The name passed the skill-name grammar, so a sentence repeats it as it is.
 */
function judged(name: string, files: readonly SkillFile[]): readonly SkillFile[] {
  const found = pathFault(name, files) ?? entryFileFault(name, files);
  if (found !== undefined) {
    throw found;
  }
  return files;
}

export { judged };
