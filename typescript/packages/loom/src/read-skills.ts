import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { coreAddress, coreClass, loadThrow, member, readerArguments } from './application-load.js';
import type { SkillsRead } from './helpers/skills-declaration.js';

/*
 * The read of the skills folder that `loom build` makes, run under Bun in a process of its own, as
 * `loom init` reads an application module, so the module imports as source and nothing it loads
 * stays in `loom`. It imports the application module, reads the registry the skills plugin records
 * each `skills()` call in, under the global symbol `@loomcli/plugins/skills/registry`, and has the
 * plugin resolve and judge the one folder a call names, so the build reads the setting and judges
 * the folder exactly as the plugin does. It applies none of init's checks of the module's exports.
 * The arguments name the result file, the package directory, the module, and the module as the
 * operator reads it. The result file receives one `SkillsRead` as JSON, and the process ends once
 * it is written, whatever the module left running when it loaded. It bundles no message module, so
 * it answers facts, and the `loom` process words each one.
 */

/** The global symbol the skills plugin records its calls under. */
const registryKey = Symbol.for('@loomcli/plugins/skills/registry');

/** The format of a registry entry this `loom` reads, which the plugin at its version records. */
const registryFormat = 2;

/** The count of an empty registry. */
const none = 0;

/** The fact of a registry whose format this `loom` does not know, which the `loom` process words. */
const versions: SkillsRead = { problem: 'registry-format' };

/**
 * Whether a value is the package's own `DeclarationError`, read from the `@loomcli/core` the
 * package resolves, so a fault the module throws while it loads prints its own diagnostic.
 */
async function declarationErrorTest(directory: string): Promise<(value: unknown) => boolean> {
  const address = coreAddress(directory);
  try {
    const core: unknown = address === undefined ? undefined : await import(address);
    const declarationError = coreClass(core, 'DeclarationError');
    return (value) => declarationError !== undefined && value instanceof declarationError;
  } catch {
    return () => false;
  }
}

/**
 * The absolute folder an entry's call names, which the plugin resolves against the application
 * module's directory, `undefined` for a call that names none, or `false` for an entry this `loom`
 * cannot read.
 */
function folderOf(entry: unknown, path: string): string | undefined | false {
  const folder = member(entry, 'folder');
  if (typeof folder !== 'function') {
    return false;
  }
  const named: unknown = Reflect.apply(folder, undefined, [dirname(path)]);
  if (named === undefined || typeof named === 'string') {
    return named;
  }
  return false;
}

/** The entries the registry holds once the module loaded, or none when no call recorded one. */
function registryEntries(): readonly unknown[] {
  const registry: unknown = Reflect.get(globalThis, registryKey);
  return Array.isArray(registry) ? registry : [];
}

/** What the plugin's read of the folder answered, or the fault it raised, with the folder. */
async function judgedFolder(entry: unknown, folder: string): Promise<SkillsRead> {
  const read = member(entry, 'read');
  if (typeof read !== 'function') {
    return versions;
  }
  try {
    const answer: unknown = await Reflect.apply(read, undefined, [folder]);
    return { folder, kind: 'read', skills: member(answer, 'skills') };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { folder, problem: 'judged', reason };
  }
}

/** Imports the application module and reads the folder `skills()` was given, or why it cannot. */
async function readDeclaration(directory: string, path: string): Promise<SkillsRead> {
  const isDeclarationError = await declarationErrorTest(directory);
  try {
    await import(pathToFileURL(path).href);
  } catch (error) {
    return loadThrow(error, isDeclarationError);
  }
  const entries = registryEntries();
  if (entries.length === none) {
    return { kind: 'uncalled' };
  }
  if (entries.some((entry) => member(entry, 'format') !== registryFormat)) {
    return versions;
  }
  const folders = entries.map((entry) => ({ entry, folder: folderOf(entry, path) }));
  if (folders.some(({ folder }) => folder === false)) {
    return versions;
  }
  const naming = folders.flatMap(({ entry, folder }) =>
    typeof folder === 'string' ? [{ entry, folder }] : [],
  );
  const [first, second] = naming;
  if (first === undefined) {
    return { kind: 'none' };
  }
  if (second !== undefined) {
    return { first: first.folder, problem: 'two-folders', second: second.folder };
  }
  return await judgedFolder(first.entry, first.folder);
}

const { directory, path, resultFile } = readerArguments(process.argv.slice(2), 'read-skills');
writeFileSync(resultFile, JSON.stringify(await readDeclaration(directory, path)));
process.exit(0);
