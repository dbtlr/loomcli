import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { CommandGraph } from '@loomcli/core';

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
 * The application module reader for init, skill export, and docs, run under Bun in a process of its own,
 * so the module imports as source, TypeScript included, and nothing it loads stays in `loom`. The
 * arguments name the result file, the package directory, the module, and the module as the
 * operator reads it, followed by an optional projection. The result file receives export names,
 * skill files, command reference files, or a read failure as JSON, and the process
 * ends once it is written, whatever the module left running when it loaded, such as an interval.
 * It bundles no message module, so it answers facts, and the `loom` process words each one.
 */

/** The global symbol the skills plugin records the reader of each graph it built under. */
const graphsKey = Symbol.for('@loomcli/plugins/skills/graphs');

/** The format of a recorded reader this `loom` calls itself, which the plugin records. */
const graphsFormat = 1;

/**
 * What a reader that reports its loaders told of them: whether the reader reports at all, and the
 * skills whose loaders it reported started and not finished.
 */
interface Loaders {
  reporting: boolean;
  readonly running: Set<string>;
}

/**
 * The reader the skills plugin recorded for the graph when it reports each loader, or `undefined`
 * when the plugin recorded none, or one of an earlier copy, which reports nothing.
 */
function reportingReader(graph: CommandGraph): unknown {
  const graphs: unknown = Reflect.get(globalThis, graphsKey);
  const entry: unknown = graphs instanceof WeakMap ? graphs.get(graph) : undefined;
  return member(entry, 'format') === graphsFormat && member(entry, 'reportsLoaders') === true
    ? member(entry, 'read')
    : undefined;
}

/** Notes one report of a skill's loader: started, or finished once its files are judged. */
function noteLoader(loaders: Loaders, event: unknown): void {
  const skill = member(event, 'skill');
  const loader = member(event, 'loader');
  if (typeof skill !== 'string') {
    return;
  }
  if (loader === 'started') {
    loaders.running.add(skill);
  } else if (loader === 'finished') {
    loaders.running.delete(skill);
  }
}

/**
 * The skills the application declares, read by the plugin's recorded reader with each loader
 * reported to `loaders`, or, for a plugin whose reader reports nothing, by the package's
 * `skillFolders`, or `null` when the package resolves neither.
 */
async function recordedFolders(
  directory: string,
  path: string,
  graph: CommandGraph,
  loaders: Loaders,
): Promise<unknown> {
  const options = { moduleDirectory: dirname(path) };
  const reader = reportingReader(graph);
  if (typeof reader === 'function') {
    loaders.reporting = true;
    return await Reflect.apply(reader, undefined, [
      graph,
      options,
      (event: unknown) => {
        noteLoader(loaders, event);
      },
    ]);
  }
  const address = packageAddress(directory, '@loomcli/plugins/skills');
  if (address === undefined) {
    return null;
  }
  const namespace: unknown = await import(address);
  const readFolders = member(namespace, 'skillFolders');
  if (typeof readFolders !== 'function') {
    return null;
  }
  return await Reflect.apply(readFolders, undefined, [graph, options]);
}

/** The skill folders the application's skills plugin installs, or none when it records no skills. */
async function skillFoldersResult(
  directory: string,
  path: string,
  graph: CommandGraph,
  loaders: Loaders,
): Promise<{ folders: unknown; sources: string[] }> {
  const folders = await recordedFolders(directory, path, graph, loaders);
  if (folders === null) {
    return { folders, sources: [] };
  }
  const registry: unknown = Reflect.get(globalThis, Symbol.for('@loomcli/plugins/skills/registry'));
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
}

/**
 * What a throw while the skills were read, other than a `DeclarationError`, reads as: the skill
 * whose loader was the one running, a loader the reader could not tell apart, as an earlier
 * plugin's reader, which reports none, or two running loaders, or the reader itself, when it
 * reports and no loader was running.
 */
function skillsThrow(
  reason: string,
  loaders: Loaders,
): { loaderThrew: string } | { loaderThrew: string; skill: string } | { readerThrew: string } {
  if (!loaders.reporting) {
    return { loaderThrew: reason };
  }
  const [skill, second] = loaders.running;
  if (skill === undefined) {
    return { readerThrew: reason };
  }
  return second === undefined ? { loaderThrew: reason, skill } : { loaderThrew: reason };
}

/** The command reference files of the whole application, or none when the package has no renderer. */
async function commandReferencesResult(
  directory: string,
  graph: CommandGraph,
): Promise<{ application: string; files: unknown }> {
  const address = packageAddress(directory, '@loomcli/plugins/skills');
  if (address === undefined) {
    return { application: graph.name, files: null };
  }
  const namespace: unknown = await import(address);
  const render = member(namespace, 'commandReferences');
  if (typeof render !== 'function') {
    return { application: graph.name, files: null };
  }
  const files: unknown = Reflect.apply(render, undefined, [
    graph,
    { commands: [[]], guidance: false },
  ]);
  return { application: graph.name, files };
}

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
): Promise<
  | ApplicationRead
  | { files: unknown }
  | { folders: unknown; sources: string[] }
  | ReturnType<typeof skillsThrow>
  | { rendererThrew: string }
> {
  if (projection === 'skills' || projection === 'docs') {
    const inspected = await loadAndInspectApplication(directory, path);
    if (!('graph' in inspected)) {
      return inspected;
    }
    const loaders: Loaders = { reporting: false, running: new Set() };
    try {
      return projection === 'skills'
        ? await skillFoldersResult(directory, path, inspected.graph, loaders)
        : await commandReferencesResult(directory, inspected.graph);
    } catch (error) {
      const core: unknown = await import(coreAddress(directory) ?? '');
      const declarationError = coreClass(core, 'DeclarationError');
      const thrown = loadThrow(
        error,
        (value) => declarationError !== undefined && value instanceof declarationError,
      );
      if ('threw' in thrown) {
        return projection === 'docs'
          ? { rendererThrew: thrown.threw }
          : skillsThrow(thrown.threw, loaders);
      }
      return { ...thrown, loaded: true };
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
