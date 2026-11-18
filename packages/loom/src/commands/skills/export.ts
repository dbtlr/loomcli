import {
  chmodSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  lstatSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';

import type { ActionHandler } from '@loomcli/core';
import { array, boolean, nullable, strictObject, string } from 'valibot';

import { readApplicationProjection } from '../../helpers/application-exports.js';
import { packagePaths } from '../../helpers/loom-config.js';
import {
  skillsUnavailable,
  noSkills,
  unknownSkill,
  exportedSkills,
  sourceSkillsOutput,
  occupiedSkillOutput,
} from '../../helpers/messages.js';
import { existingModule, shown } from '../../helpers/modules.js';
import { packageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';
import type { exportSkills } from './command.js';

const fileSchema = strictObject({ content: string(), executable: boolean(), path: string() });
const folderSchema = strictObject({ files: array(fileSchema), name: string() });
const resultSchema = strictObject({
  folders: nullable(array(folderSchema)),
  sources: array(string()),
});

/** Resolves existing ancestors too, so a linked output parent cannot disguise the source. */
function physicalPath(path: string): string {
  if (existsSync(path)) {
    return realpathSync(path);
  }
  const parent = dirname(path);
  return parent === path ? path : join(physicalPath(parent), relative(parent, path));
}

function within(parent: string, path: string): boolean {
  const suffix = relative(parent, path);
  return (
    suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
  );
}

export const exportApplicationSkills: ActionHandler<typeof exportSkills> = async (context) => {
  await report(context, async () => {
    const { cwd } = context.host;
    const directory = packageDirectory(cwd);
    const paths = packagePaths(directory, context.provided.config);
    const path = existingModule(
      cwd,
      context.options.application === undefined
        ? paths.application
        : resolve(cwd, context.options.application),
      context.options.application === undefined ? 'paths.application' : '--application',
    );
    const result = await readApplicationProjection(
      context,
      {
        directory,
        module: shown(cwd, path),
        path,
        projection: 'skills',
        reader: 'read-application',
      },
      resultSchema,
    );
    if (result.folders === null) {
      throw new Error(skillsUnavailable);
    }
    if (result.folders.length === 0) {
      throw new Error(noSkills);
    }
    const names = context.options.skill ?? [];
    for (const name of names) {
      if (!result.folders.some((folder) => folder.name === name)) {
        throw new Error(unknownSkill(name));
      }
    }
    const folders = result.folders.filter(
      (folder) => names.length === 0 || names.includes(folder.name),
    );
    const output = resolve(cwd, context.args.directory);
    for (const source of result.sources) {
      const physicalSource = physicalPath(source);
      if (
        within(physicalSource, physicalPath(output)) ||
        folders.some((folder) => within(physicalPath(join(output, folder.name)), physicalSource))
      ) {
        throw new Error(sourceSkillsOutput(output));
      }
    }
    for (const folder of folders) {
      const target = join(output, folder.name);
      let stats: Stats | undefined = undefined;
      try {
        stats = lstatSync(target);
      } catch (error) {
        if (
          !(
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        ) {
          throw error;
        }
      }
      if (
        stats !== undefined &&
        (!stats.isDirectory() ||
          lstatSync(join(target, 'SKILL.md'), { throwIfNoEntry: false })?.isFile() !== true)
      ) {
        throw new Error(occupiedSkillOutput(target));
      }
    }
    for (const folder of folders) {
      const target = join(output, folder.name);
      rmSync(target, { force: true, recursive: true });
      for (const file of folder.files) {
        const destination = join(target, file.path);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, Buffer.from(file.content, 'base64'));
        chmodSync(destination, file.executable ? 0o755 : 0o644);
      }
    }
    return exportedSkills(output);
  });
};
