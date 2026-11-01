/*
 * The skills folder reader: each directory directly inside the folder is one skill named for it,
 * holding every file below it. It reads through `node:fs` alone, so it reads the same way under
 * Node and Bun, and it serves an unbuilt run, a development build, and the build's own judging.
 */
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { join } from 'node:path';

import { DeclarationError, escapeControlCharacters } from '@loomcli/core';

import { skillsFiles, skillsFolder } from '../rules.js';
import { judged } from './judge.js';
import { identity, isSkillName } from './settings.js';
import type { SkillFile } from './types.js';

/** One skill the folder holds: its directory's name and every file below it. */
interface FolderSkill {
  readonly name: string;
  readonly files: readonly SkillFile[];
}

/** Any execute bit of a file's mode. */
const executeBits = 0o111;

/** The count of an empty list. */
const none = 0;

/** A fault of the skills folder, under the plugin's folder rule. */
function folderFault(sentence: string, correction: string): DeclarationError {
  return new DeclarationError(skillsFolder, { correction, sentence });
}

/** The faults of the folder and what it holds, each with its sentence and correction. */
const faults = {
  badName: (folder: string, name: string) =>
    folderFault(
      `The skills folder ${escapeControlCharacters(folder)} holds a folder that is not a skill name: ${escapeControlCharacters(name)}.`,
      "Name each skill's folder with lowercase letters, digits, and single hyphens, such as notes.",
    ),
  brokenLink: (folder: string, name: string) =>
    folderFault(
      `The skills folder ${escapeControlCharacters(folder)} holds ${escapeControlCharacters(name)}, a link that names nothing.`,
      "Point the link at the skill's folder, or remove it.",
    ),
  carriedNone: (folder: string) =>
    folderFault(
      `The build carried no skills folder, and ${escapeControlCharacters(folder)} is not a folder.`,
      'Build with loom build at the version of @loomcli/plugins, which carries the folder skills() names.',
    ),
  empty: (folder: string) =>
    folderFault(
      `The skills folder ${escapeControlCharacters(folder)} holds no skill.`,
      'Add a folder for each skill, holding its SKILL.md, such as skills/notes/SKILL.md.',
    ),
  missing: (folder: string) =>
    folderFault(
      `Plugin "${identity}" setting "folder" names ${escapeControlCharacters(folder)}, which is not a folder.`,
      'Create the folder, or name the folder that holds the skills.',
    ),
  notFile: (skill: string, path: string) =>
    folderFault(
      `The skill ${skill} holds ${escapeControlCharacters(path)}, which is not a file or a folder.`,
      'Replace it with the file it stands for, or remove it.',
    ),
};

/** The fault of a listed skill that holds a folder skill's name, under the files rule. */
function listedTwice(folder: string, name: string): DeclarationError {
  return new DeclarationError(skillsFiles, {
    correction: 'Give the listed skill another name, or remove it from the list or the folder.',
    sentence: `The skills setting lists the skill ${name}, which the skills folder ${escapeControlCharacters(folder)} holds too.`,
  });
}

/** What a path names, following a link, or none for a link that names nothing. */
function followed(path: string): Stats | undefined {
  return statSync(path, { throwIfNoEntry: false });
}

/**
 * The names a directory holds, in name order. A default sort compares by code unit, so no locale
 * reorders them.
 */
function sortedNames(directory: string): string[] {
  // The pack's ES2022 library has no toSorted, and this sorts the list the read returned.
  // oxlint-disable-next-line unicorn/no-array-sort
  return readdirSync(directory).sort();
}

/** A file of a skill, read through a link when it is one, its mode taken from what it names. */
function fileOf(path: string, relative: string, named: Stats): SkillFile {
  return {
    content: readFileSync(path),
    executable: (named.mode & executeBits) !== none,
    path: relative,
  };
}

/**
 * The files one entry of a skill's directory holds: a directory's files below it, or the file a
 * file or a link to a file is. A link to a folder or to nothing, or an entry that is neither a file
 * nor a folder, is a fault.
 */
function entryFiles(skill: string, path: string, relative: string): SkillFile[] {
  const own = lstatSync(path);
  if (own.isDirectory()) {
    return skillFiles(skill, path, `${relative}/`);
  }
  const named = own.isSymbolicLink() ? followed(path) : own;
  if (named?.isFile() !== true) {
    throw faults.notFile(skill, relative);
  }
  return [fileOf(path, relative, named)];
}

/**
 * Every file below a skill's directory, at its path relative to the skill's directory with `/`
 * between segments, in name order, or the first fault an entry holds.
 */
function skillFiles(skill: string, directory: string, prefix = ''): SkillFile[] {
  return sortedNames(directory).flatMap((name) =>
    entryFiles(skill, join(directory, name), `${prefix}${name}`),
  );
}

/** One skill directory directly inside the folder, judged as the plugin judges a loader's files. */
function readSkill(folder: string, name: string): FolderSkill {
  if (!isSkillName(name)) {
    throw faults.badName(folder, name);
  }
  return { files: judged(name, skillFiles(name, join(folder, name))), name };
}

/** How the reader names a folder that is missing: as the setting names it, or as a built run's. */
type Missing = 'setting' | 'built';

/**
 * The skills directly inside the folder, in name order: each directory, or link to one, whose name
 * does not start with `.`, read and judged. A link that names nothing is a fault, and a file or a
 * link to one is ignored.
 */
function skillsIn(folder: string): FolderSkill[] {
  return sortedNames(folder).flatMap((name) => {
    const entry = followed(join(folder, name));
    if (entry === undefined) {
      throw faults.brokenLink(folder, name);
    }
    return entry.isDirectory() && !name.startsWith('.') ? [readSkill(folder, name)] : [];
  });
}

/**
 * Reads and judges the skills folder at an absolute path, throwing the first fault: a path that is
 * not a folder, then in name order a link directly inside it that names nothing, a skill directory
 * whose name is not a skill name, and a skill's files' faults, then a folder that holds no skill
 * when no skill is listed, then a listed skill that holds a folder skill's name. The skills come in
 * name order.
 */
function readSkillsFolder(
  folder: string,
  listed: readonly string[],
  missing: Missing = 'setting',
): readonly FolderSkill[] {
  if (followed(folder)?.isDirectory() !== true) {
    throw missing === 'built' ? faults.carriedNone(folder) : faults.missing(folder);
  }
  const skills = skillsIn(folder);
  if (skills.length === none && listed.length === none) {
    throw faults.empty(folder);
  }
  const twice = skills.find(({ name }) => listed.includes(name));
  if (twice !== undefined) {
    throw listedTwice(folder, twice.name);
  }
  return skills;
}

export type { FolderSkill };
export { folderFault, readSkillsFolder };
