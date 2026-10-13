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

/** A control character, U+0000 to U+001F or U+007F to U+009F. */
const controlCharacter = /\p{Cc}/u;

/** The corrections of the faults, each declared once beside its sentence. */
const corrections = {
  duplicate: 'List each file once.',
  list: "Return a list of { path, content } files from the skill's files function.",
  missing: "Add the skill's SKILL.md at the top of its files.",
  path: 'Use a relative path with / between its parts and no empty, ., or .. part, such as references/commands.md.',
};

/** The fault a skill's loaded files hold: its sentence, and the correction beside it. */
function fault(sentence: string, correction: string): DeclarationError {
  return new DeclarationError(skillsFiles, { correction, sentence });
}

/** Whether a value is a file as the loader lists it: a path and text or bytes for content. */
function isFile(value: unknown): value is SkillFile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const path: unknown = Reflect.get(value, 'path');
  const content: unknown = Reflect.get(value, 'content');
  return typeof path === 'string' && (typeof content === 'string' || content instanceof Uint8Array);
}

/** Whether a path is a plain relative one: no leading `/`, `\`, control character, or empty, `.`, or `..` part. */
function isPlainPath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || controlCharacter.test(path)) {
    return false;
  }
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** The fault of a path listed a second time, or none. */
function duplicateFault(shown: string, files: readonly SkillFile[]): DeclarationError | undefined {
  const seen = new Set<string>();
  for (const { path } of files) {
    if (seen.has(path)) {
      return fault(
        `Skill "${shown}" lists the file ${escapeControlCharacters(path)} twice.`,
        corrections.duplicate,
      );
    }
    seen.add(path);
  }
  return undefined;
}

/** The files a result lists, or none when it is not a list of files. */
function listOf(result: unknown): readonly SkillFile[] | undefined {
  return Array.isArray(result) && result.every(isFile) ? result : undefined;
}

/** The fault of a path that is not a plain relative one, or none. */
function pathFault(shown: string, files: readonly SkillFile[]): DeclarationError | undefined {
  const unplain = files.find(({ path }) => !isPlainPath(path));
  return unplain === undefined
    ? undefined
    : fault(
        `Skill "${shown}" lists a file path that is not a plain relative path: ${escapeControlCharacters(unplain.path)}.`,
        corrections.path,
      );
}

/** The fault of a skill that lists no `SKILL.md`, or none. */
function entryFileFault(shown: string, files: readonly SkillFile[]): DeclarationError | undefined {
  return files.some(({ path }) => path === entryFile)
    ? undefined
    : fault(`Skill "${shown}" lists no ${entryFile}.`, corrections.missing);
}

/** The first fault of a skill's loaded result, in the order the contract lists them, or none. */
function resultFault(
  shown: string,
  files: readonly SkillFile[] | undefined,
): DeclarationError | undefined {
  if (files === undefined) {
    return fault(
      `Skill "${shown}" loaded something that is not a list of files.`,
      corrections.list,
    );
  }
  return pathFault(shown, files) ?? duplicateFault(shown, files) ?? entryFileFault(shown, files);
}

/** The files of a skill's loaded result, or the first fault they hold. */
function judged(name: string, result: unknown): readonly SkillFile[] {
  const files = listOf(result);
  const found = resultFault(escapeControlCharacters(name), files);
  if (found !== undefined) {
    throw found;
  }
  return files ?? [];
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
  const answers: { name: string; result: unknown }[] = [];
  for (const { files, name } of skills) {
    answers.push({ name, result: await files() });
  }
  return answers.map(({ name, result }) => ({ files: withModes(judged(name, result)), name }));
}

export type { LoadedSkill };
export { loadSkills };
