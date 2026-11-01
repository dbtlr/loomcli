import type { ReleaseFacts } from '@loomcli/core';

import type { FolderFile } from '../installation/folders.js';
import { carriedBase, carriedSkills } from './carried.js';
import { judged } from './judge.js';
import type { Declared } from './settings.js';
import { folderSkills } from './source.js';
import type { SkillFile } from './types.js';

/** A skill whose files the plugin read or a loader answered and the plugin judged, ready to write. */
interface LoadedSkill {
  readonly name: string;
  /** The files with the mode each is written with, whatever the umask. */
  readonly files: readonly FolderFile[];
}

/** The mode of an executable file. */
const executableMode = 0o755;

/** The mode of any other file. */
const plainMode = 0o644;

/** The files of a judged result with the mode each is written with. */
function withModes(files: readonly SkillFile[]): FolderFile[] {
  return files.map(({ content, executable, path }) => ({
    content,
    mode: executable === true ? executableMode : plainMode,
    path,
  }));
}

/**
 * Reads the skills folder, then calls each listed skill's loader once, in declaration order,
 * awaiting each, then judges every result before anything is written. The folder's skills come
 * first, in name order, then the listed skills. The first fault throws a `DeclarationError`, and a
 * loader that throws or rejects fails the run as it threw.
 */
async function loadSkills(
  declared: Declared,
  build: ReleaseFacts['build'],
): Promise<readonly LoadedSkill[]> {
  const fromFolder = folderSkills({
    base: carriedBase,
    build,
    carried: carriedSkills(),
    listed: declared.skills.map(({ name }) => name),
    setting: declared.folder,
  });
  const answers: { name: string; result: readonly SkillFile[] }[] = [];
  for (const { files, name } of declared.skills) {
    answers.push({ name, result: await files() });
  }
  return [
    ...fromFolder.map(({ files, name }) => ({ files: withModes(files), name })),
    ...answers.map(({ name, result }) => ({ files: withModes(judged(name, result)), name })),
  ];
}

export type { LoadedSkill };
export { loadSkills };
