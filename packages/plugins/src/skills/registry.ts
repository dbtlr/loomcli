/*
 * The registry of `skills()` calls: the channel `loom build` reads, in a process of its own, after
 * it imports the application module, to learn the folder the declaration names and judge it as this
 * plugin does. It lives on `globalThis` under the global symbol
 * `Symbol.for('@loomcli/plugins/skills/registry')`, so every copy of the plugin a module graph loads
 * records into one list, and it holds one entry per call:
 *
 *   { format: 2,
 *     folder: (moduleDirectory: string) => string | undefined,
 *     read: (folder: string) => Promise<{ skills: { name, files: { path, executable }[] }[] }> }
 *
 * `folder` takes the application module's directory and answers the absolute folder the call's
 * setting names, resolving a relative path against that directory as no unbuilt run can, or
 * `undefined` for a call that names no folder, so the rule that reads the setting lives here alone.
 * `read` takes that folder and reads and judges it as `install` does, rejecting with the plugin's
 * own `DeclarationError` at the first fault. The registry is a channel between `@loomcli/plugins`
 * and `@loomcli/loom`, which publish at one version, so no export names it, and a change to an
 * entry's shape raises its format.
 */
import { readSkillsFolder } from './folder.js';
import type { Declared } from './settings.js';
import { folderPath } from './source.js';

/** The global symbol the registry lives under. */
const registryKey = Symbol.for('@loomcli/plugins/skills/registry');

/** The format of a registry entry, which `loom build` at the same version reads. */
const registryFormat = 2;

/** What a read of the folder tells the build: each skill's name and its files' paths and modes. */
interface ReadFolder {
  readonly skills: readonly {
    readonly name: string;
    readonly files: readonly { readonly path: string; readonly executable: boolean }[];
  }[];
}

/** One `skills()` call as the registry records it. */
interface RegistryEntry {
  readonly format: typeof registryFormat;
  readonly folder: (moduleDirectory: string) => string | undefined;
  readonly read: (folder: string) => Promise<ReadFolder>;
}

/** Records one `skills()` call in the registry, creating the registry on the first call. */
function recordCall(declared: Declared): void {
  const names = declared.skills.map(({ name }) => name);
  const { folder: setting } = declared;
  const entry: RegistryEntry = {
    folder: (moduleDirectory) =>
      setting === undefined ? undefined : folderPath(setting, moduleDirectory),
    format: registryFormat,
    // A fault the read throws rejects the promise, so the build reads it as the read's failure.
    read: (folder) =>
      Promise.resolve().then(() => ({
        skills: readSkillsFolder(folder, names).map((skill) => ({
          files: skill.files.map(({ executable, path }) => ({
            executable: executable === true,
            path,
          })),
          name: skill.name,
        })),
      })),
  };
  const registry: unknown = Reflect.get(globalThis, registryKey);
  if (Array.isArray(registry)) {
    registry.push(entry);
  } else {
    Reflect.set(globalThis, registryKey, [entry]);
  }
}

export { recordCall };
