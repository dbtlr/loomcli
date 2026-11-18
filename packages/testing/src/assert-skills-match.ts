import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Application } from '@loomcli/core';

import { noSkills, skillDiff, skillsUnavailable, unknownSkill } from './messages.js';
import type { SkillFolder } from './skill-folders.js';
import { skillFolders } from './skill-folders.js';

/** Lists files without following links, including links so they differ from installed files. */
async function filesUnder(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch(
    (error: unknown) => {
      missingPath(error);
      return [];
    },
  );
  const paths: string[] = [];
  for (const entry of entries.filter((item) => !item.name.startsWith('.'))) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    paths.push(...(entry.isDirectory() ? await filesUnder(root, path) : [path]));
  }
  return paths;
}

/** Throws when a link or a file is where a skill's folder belongs: neither is a committed copy. */
async function assertIsFolder(root: string, name: string): Promise<void> {
  const held = await lstat(root).catch(missingPath);
  if (held !== undefined && !held.isDirectory()) {
    throw new Error(skillDiff(name));
  }
}

/** Compares one skill in sorted path order, including files no longer generated. */
async function assertFolderMatches(folder: SkillFolder, directory: string): Promise<void> {
  const root = join(directory, folder.name);
  await assertIsFolder(root, folder.name);
  const expected = new Map(folder.files.map((file) => [file.path, file]));
  const actual = await filesUnder(root);
  // The testing package targets ES2022; this list is newly allocated and owned here.
  // eslint-disable-next-line unicorn/no-array-sort
  const paths = [...new Set([...expected.keys(), ...actual])].sort();
  for (const path of paths) {
    if (!(await fileMatches(join(root, path), expected.get(path)))) {
      throw new Error(skillDiff(join(folder.name, path)));
    }
  }
}

/** Whether a committed path is the regular file the skill supplies, with its bytes and executable bit. */
async function fileMatches(target: string, file: SkillFolder['files'][number] | undefined) {
  const stats = await lstat(target).catch(missingPath);
  return (
    file !== undefined &&
    stats !== undefined &&
    stats.isFile() &&
    ((stats.mode & executeBits) !== noExecuteBits) === file.executable &&
    Buffer.from(file.content).equals(await readFile(target))
  );
}

const executeBits = 0o111;

/** A missing path, including one below a file, is a missing committed file. */
function missingPath(error: unknown): undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  ) {
    return undefined;
  }
  throw error;
}

const noExecuteBits = 0;
const noFolders = 0;

/**
 * Regenerates each declared skill and throws an Error naming the first differing file in a
 * committed copy. Compares bytes and executable bits, and rejects extra files inside each skill.
 * Dot entries at every depth and other skill folders are ignored. options.skills selects names;
 * omitting it checks every declared skill. options.moduleDirectory resolves a relative folder.
 * Loads the optional `@loomcli/plugins` companion only when called. Imports no test runner.
 *
 * @example
 * ```ts
 * import { test } from 'vitest';
 * import { assertSkillsMatch } from '@loomcli/testing';
 * import { application } from './application.js';
 *
 * test('committed skills match', async () => {
 *   await assertSkillsMatch(application, 'committed-skills', { moduleDirectory: import.meta.dirname });
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/testing.md#assertskillsmatch
 * @public
 */
export async function assertSkillsMatch(
  application: Pick<Application, 'inspect'>,
  directory: string,
  options: { readonly skills?: readonly string[]; readonly moduleDirectory?: string } = {},
): Promise<void> {
  const folders = await skillFolders(application.inspect(), options);
  if (folders === undefined) {
    throw new Error(skillsUnavailable);
  }
  if (folders.length === noFolders) {
    throw new Error(noSkills);
  }
  for (const name of options.skills ?? []) {
    if (!folders.some((folder) => folder.name === name)) {
      throw new Error(unknownSkill(name));
    }
  }
  for (const folder of folders.filter(
    (item) => options.skills === undefined || options.skills.includes(item.name),
  )) {
    await assertFolderMatches(folder, directory);
  }
}
