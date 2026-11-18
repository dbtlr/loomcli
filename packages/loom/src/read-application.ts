import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  coreAddress,
  coreClass,
  loadThrow,
  member,
  packageAddress,
  readerArguments,
} from './application-load.js';
import type { ApplicationRead } from './helpers/application-exports.js';
import { loadAndInspectApplication, loadApplication } from './helpers/inspect-application.js';

/*
 * The application module reader for init and skill export, run under Bun in a process of its own,
 * so the module imports as source, TypeScript included, and nothing it loads stays in `loom`. The
 * arguments name the result file, the package directory, the module, and the module as the
 * operator reads it, followed by an optional projection. The result file receives export names,
 * skill files, or a read failure as JSON, and the process
 * ends once it is written, whatever the module left running when it loaded, such as an interval.
 * It bundles no message module, so it answers facts, and the `loom` process words each one.
 */

/**
 * Imports the application module and reads the names its one exported Application is exported
 * under, or why it has none, as a fact the `loom` process words. The Application class comes from
 * the `@loomcli/core` the package itself resolves, which is the copy the module's own declarations
 * are instances of.
 */
async function read(
  directory: string,
  path: string,
  projection?: string,
): Promise<ApplicationRead | { folders: unknown; sources: string[] } | { loaderThrew: string }> {
  if (projection === 'skills') {
    const inspected = await loadAndInspectApplication(directory, path);
    if (!('graph' in inspected)) {
      return inspected;
    }
    try {
      const address = packageAddress(directory, '@loomcli/plugins/skills');
      if (address === undefined) {
        return { folders: null, sources: [] };
      }
      const namespace: unknown = await import(address);
      const readFolders = member(namespace, 'skillFolders');
      if (typeof readFolders !== 'function') {
        return { folders: null, sources: [] };
      }
      const folders: unknown = await Reflect.apply(readFolders, undefined, [
        inspected.graph,
        { moduleDirectory: dirname(path) },
      ]);
      const registry: unknown = Reflect.get(
        globalThis,
        Symbol.for('@loomcli/plugins/skills/registry'),
      );
      const sources: string[] = [];
      if (Array.isArray(registry)) {
        for (const entry of registry) {
          const folder = member(entry, 'folder');
          if (typeof folder === 'function') {
            const source: unknown = Reflect.apply(folder, undefined, [dirname(path)]);
            if (typeof source === 'string') {
              sources.push(source);
            }
          }
        }
      }
      return { folders: folders ?? null, sources };
    } catch (error) {
      const core: unknown = await import(coreAddress(directory) ?? '');
      const declarationError = coreClass(core, 'DeclarationError');
      const thrown = loadThrow(
        error,
        (value) => declarationError !== undefined && value instanceof declarationError,
      );
      return 'threw' in thrown ? { loaderThrew: thrown.threw } : { ...thrown, loaded: true };
    }
  }
  const loaded = await loadApplication(directory, path);
  return 'application' in loaded ? { names: loaded.names } : loaded;
}

/** Reads the holder's original content before Buffer.toJSON turns disk bytes into a plain object. */
function encodedContent(this: unknown, key: string, value: unknown): unknown {
  const original = member(this, key);
  return key === 'content' && (typeof original === 'string' || original instanceof Uint8Array)
    ? Buffer.from(original).toString('base64')
    : value;
}

const { directory, path, projection, resultFile } = readerArguments(
  process.argv.slice(2),
  'read-application',
);
writeFileSync(resultFile, JSON.stringify(await read(directory, path, projection), encodedContent));
process.exit(0);
