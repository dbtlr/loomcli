import type { CommandGraph } from '@loomcli/core';

import { pluginsMissing, pluginsExportMissing, pluginsFoldersInvalid } from './messages.js';

/** Files read at the optional companion boundary, independent of the plugin package's build order. */
interface SkillFolder {
  readonly name: string;
  readonly files: readonly { path: string; content: string | Uint8Array; executable: boolean }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFolder(value: unknown): value is SkillFolder {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    Array.isArray(value.files) &&
    value.files.every(
      (file: unknown) =>
        isRecord(file) &&
        typeof file.path === 'string' &&
        (typeof file.content === 'string' || file.content instanceof Uint8Array) &&
        typeof file.executable === 'boolean',
    )
  );
}

/**
 * Imports the optional companion. It is missing only when its own specifier does not resolve: a
 * module it imports that is missing rejects with the same code, and that failure names the file
 * to repair, so it is left as it is.
 */
async function loadCompanion(specifier: string): Promise<unknown> {
  try {
    import.meta.resolve(specifier);
  } catch (error) {
    if (isRecord(error) && error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(pluginsMissing, { cause: error });
    }
    throw error;
  }
  return import(specifier);
}

/** Loads the optional companion only for this assertion and reads its public function at one boundary. */
export async function skillFolders(
  graph: CommandGraph,
  options: { readonly moduleDirectory?: string } = {},
): Promise<readonly SkillFolder[] | undefined> {
  const namespace: unknown = await loadCompanion('@loomcli/plugins/skills');
  if (!isRecord(namespace) || typeof namespace.skillFolders !== 'function') {
    throw new Error(pluginsExportMissing);
  }
  const folders: unknown = await Reflect.apply(namespace.skillFolders, undefined, [graph, options]);
  if (folders === undefined) {
    return undefined;
  }
  if (!Array.isArray(folders) || !folders.every((folder: unknown) => isFolder(folder))) {
    throw new Error(pluginsFoldersInvalid);
  }
  return folders;
}

export type { SkillFolder };
