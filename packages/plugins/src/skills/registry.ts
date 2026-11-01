/*
 * The registry of `skills()` calls: the channel `loom build` reads, in a process of its own, after
 * it imports the application module, to learn the folder the declaration names and judge it as this
 * plugin does. It lives on `globalThis` under the global symbol
 * `Symbol.for('@loomcli/plugins/skills/registry')`, so every copy of the plugin a module graph loads
 * records into one list, and it holds one entry per call:
 *
 *   { format: 1, folder: <the folder setting as given, a URL, a string, or undefined>,
 *     names: <the listed skills' names>,
 *     read: (folder: string) => Promise<{ skills: { name, files: { path, executable }[] }[] }> }
 *
 * `read` takes the folder as an absolute path, which the build resolves, and reads and judges it as
 * `install` does, rejecting with the plugin's own `DeclarationError` at the first fault. The
 * registry is a channel between `@loomcli/plugins` and `@loomcli/loom`, which publish at one
 * version, so no export names it, and a change to an entry's shape raises its format.
 */
import { readSkillsFolder } from './folder.js';
import type { Declared } from './settings.js';

/** The global symbol the registry lives under. */
const registryKey = Symbol.for('@loomcli/plugins/skills/registry');

/** The format of a registry entry, which `loom build` at the same version reads. */
const registryFormat = 1;

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
  readonly folder: URL | string | undefined;
  readonly names: readonly string[];
  readonly read: (folder: string) => Promise<ReadFolder>;
}

/** Records one `skills()` call in the registry, creating the registry on the first call. */
function recordCall(declared: Declared): void {
  const names = declared.skills.map(({ name }) => name);
  const entry: RegistryEntry = {
    folder: declared.folder,
    format: registryFormat,
    names,
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
