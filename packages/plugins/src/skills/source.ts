/*
 * Where a run's folder skills come from. An unbuilt run, or one with no carried folder, reads the
 * folder its setting names; an artifact `loom build` made reads what `__LOOM_SKILLS__` says the
 * build carried: the source folder for a development build, or the judged copy in `loom-skills/`
 * beside the bundle's chunks or inside the binary for a distributed one.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReleaseFacts } from '@loomcli/core';
import { escapeControlCharacters } from '@loomcli/core';

import { isRecord } from '../plain-data.js';
import { folderFault, readSkillsFolder } from './folder.js';
import type { FolderSkill } from './folder.js';
import { identity } from './settings.js';
import type { SkillFile } from './types.js';

/** The format of `__LOOM_SKILLS__` this plugin reads, which `loom build` at its version bakes. */
const carriedFormat = 1;

/** The folder a carried copy sits in, beside the bundle's chunks or the binary's program. */
const carriedFolder = 'loom-skills';

/** What a run reads its folder skills from. */
interface FolderRequest {
  /** The `folder` setting as the application gave it, or none. */
  readonly setting: URL | string | undefined;
  /** The names of the listed skills, which a folder skill may not hold. */
  readonly listed: readonly string[];
  /** The value `loom build` baked into `__LOOM_SKILLS__`, or `undefined` when it baked none. */
  readonly carried: unknown;
  /** The address `loom-skills/` sits beside in an artifact that carries a copy. */
  readonly base: string;
  /** The run's build, from its release facts. */
  readonly build: ReleaseFacts['build'];
}

/** The correction of an artifact that `loom build` made without a folder. */
const exportCorrection =
  'Export the Application from the module paths.application names, src/application.ts by convention, call skills() as it loads, and build again.';

/** The faults of what an artifact carried. */
const faults = {
  none: () =>
    folderFault('loom build found no skills folder in the application module.', exportCorrection),
  relative: (path: string) =>
    folderFault(
      `Plugin "${identity}" setting "folder" is the relative path ${escapeControlCharacters(path)}, which only loom build resolves.`,
      `Name the folder with new URL('${escapeControlCharacters(path)}', import.meta.url), resolved against the module that calls skills().`,
    ),
  unread: () =>
    folderFault(
      'loom build could not read the skills folder, because it could not load the application module.',
      exportCorrection,
    ),
  versions: () =>
    folderFault(
      'This @loomcli/plugins cannot read the skills folder the installed @loomcli/loom carried.',
      'Install @loomcli/plugins and @loomcli/loom at one version, and build again.',
    ),
};

/**
 * The folder an unbuilt run reads: a URL's path, a `file:` string's, or an absolute path. A
 * relative path resolves against the application module, which only `loom build` knows, so it
 * fails.
 */
function unbuiltFolder(setting: URL | string): string {
  if (setting instanceof URL || setting.startsWith('file:')) {
    return resolve(fileURLToPath(setting));
  }
  if (!isAbsolute(setting)) {
    throw faults.relative(setting);
  }
  return resolve(setting);
}

/** One carried file as the define names it, or `undefined` when it is not one. */
function carriedFile(value: unknown): { path: string; executable: boolean } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { executable, path } = value;
  return typeof path === 'string' && typeof executable === 'boolean'
    ? { executable, path }
    : undefined;
}

/** The address of one carried file: `loom-skills/<name>/<path>` beside the base, each part encoded. */
function carriedAddress(base: string, name: string, path: string): URL {
  const parts = [carriedFolder, name, ...path.split('/')].map((part) => encodeURIComponent(part));
  return new URL(parts.join('/'), base);
}

/** One carried skill's files, each read from `loom-skills/<name>/` beside the base. */
function carriedFiles(base: string, name: string, listed: readonly unknown[]): SkillFile[] {
  return listed.map((value: unknown) => {
    const file = carriedFile(value);
    if (file === undefined) {
      throw faults.versions();
    }
    const content = readFileSync(carriedAddress(base, name, file.path));
    return { content, executable: file.executable, path: file.path };
  });
}

/**
 * The copy a distributed artifact carries: each skill the define names with its files, read from
 * `loom-skills/` beside the base, each executable as the define names it, because an embedded file
 * keeps no mode. A define of any other shape is one this plugin's version does not know.
 */
function carriedCopy(skills: unknown, base: string): readonly FolderSkill[] {
  if (!Array.isArray(skills)) {
    throw faults.versions();
  }
  return skills.map((skill: unknown) => {
    const name = isRecord(skill) ? skill.name : undefined;
    const listed = isRecord(skill) ? skill.files : undefined;
    if (typeof name !== 'string' || !Array.isArray(listed)) {
      throw faults.versions();
    }
    return { files: carriedFiles(base, name, listed), name };
  });
}

/**
 * The folder skills of what `loom build` carried, by its kind: the source folder, the copy, or the
 * reason the build carried nothing. A value of another format or kind is one this plugin's version
 * does not know.
 */
function carriedFolderSkills(request: FolderRequest, carried: unknown): readonly FolderSkill[] {
  if (!isRecord(carried) || carried.format !== carriedFormat) {
    throw faults.versions();
  }
  if (carried.kind === 'source' && typeof carried.folder === 'string') {
    return readSkillsFolder(carried.folder, request.listed);
  }
  if (carried.kind === 'carried') {
    return carriedCopy(carried.skills, request.base);
  }
  if (carried.kind === 'unread') {
    throw faults.unread();
  }
  throw carried.kind === 'none' ? faults.none() : faults.versions();
}

/**
 * The folder skills a run installs, in name order, read and judged when a skills Command loads
 * files. A setting that names no folder reads none. With nothing carried, the setting is read as an
 * unbuilt run reads it, and a missing folder in a built run says the build carried none.
 */
function folderSkills(request: FolderRequest): readonly FolderSkill[] {
  const { carried, setting } = request;
  if (setting === undefined) {
    return [];
  }
  if (carried === undefined) {
    const missing = request.build === 'source' ? 'setting' : 'built';
    return readSkillsFolder(unbuiltFolder(setting), request.listed, missing);
  }
  return carriedFolderSkills(request, carried);
}

export type { FolderRequest };
export { folderSkills };
