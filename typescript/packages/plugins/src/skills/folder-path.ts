/*
 * The absolute folder a `folder` setting names. The registry `loom build` reads resolves it on every
 * `skills()` call's behalf, so this module holds the rule alone and reads no folder.
 */
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeControlCharacters } from '@loomcli/core';

import { folderFault } from './folder-fault.js';
import { identity } from './settings.js';

/** The fault of a relative folder that a run with no module directory cannot resolve. */
function relativeFolder(path: string) {
  return folderFault(
    `Plugin "${identity}" setting "folder" is the relative path ${escapeControlCharacters(path)}, which only loom build resolves.`,
    `Name the folder with new URL('${escapeControlCharacters(path)}', import.meta.url), resolved against the module that calls skills().`,
  );
}

/**
 * The absolute folder a `folder` setting names: a URL's path, a `file:` string's, an absolute path,
 * or a relative path resolved against the application module's directory. Only `loom build` knows
 * that directory, so a run that passes none, an unbuilt run, fails on a relative path.
 */
function folderPath(setting: URL | string, moduleDirectory?: string): string {
  if (setting instanceof URL || setting.startsWith('file:')) {
    return resolve(fileURLToPath(setting));
  }
  if (isAbsolute(setting)) {
    return resolve(setting);
  }
  if (moduleDirectory === undefined) {
    throw relativeFolder(setting);
  }
  return resolve(moduleDirectory, setting);
}

export { folderPath };
