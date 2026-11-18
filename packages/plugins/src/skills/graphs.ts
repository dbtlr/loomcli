/*
 * The record of which `skills()` call built each graph, so a tool given a graph finds the skills
 * that application declares. The plugin's `onGraphBuilt` hook records one entry per graph it
 * receives, in a `WeakMap` keyed by the graph object, so the graphs a test builds are collected
 * with it. The map lives on `globalThis` under the global symbol
 * `Symbol.for('@loomcli/plugins/skills/graphs')`, so every copy of `@loomcli/plugins` in the process
 * finds what the application's copy recorded, and the first copy that needs the map creates it.
 * Each entry is:
 *
 *   { format: 1,
 *     read: (graph: CommandGraph, options: { moduleDirectory?: string })
 *       => Promise<{ name: string, files: { path, content, executable }[] }[]> }
 *
 * `read` is the reader of the `skills()` call that built the graph: it reads the skills folder and
 * calls the loaders as that copy's install does, and generates each selecting skill's command
 * references from the graph, so the copy that would install the skills reads and generates them. A
 * change to an entry's shape raises its format, and a copy that finds a format it does not know
 * fails. The hook adds nothing to the graph.
 */
import type { CommandGraph } from '@loomcli/core';

import { isRecord } from '../plain-data.js';
import { folderFault } from './folder-fault.js';
import type { SkillFile, SkillFolder, SkillFoldersOptions } from './types.js';

/** The global symbol the map lives under. */
const graphsKey = Symbol.for('@loomcli/plugins/skills/graphs');

/** The format of an entry this copy records and reads. */
const graphsFormat = 1;

/** The reader of one `skills()` call: every declared skill with every file an install writes. */
type SkillsReader = (
  graph: CommandGraph,
  options: SkillFoldersOptions,
) => Promise<readonly SkillFolder[]>;

/** The map every copy shares, created by the first copy that needs it. */
function graphs(): WeakMap<object, unknown> {
  const existing: unknown = Reflect.get(globalThis, graphsKey);
  if (existing instanceof WeakMap) {
    return existing;
  }
  const created = new WeakMap<object, unknown>();
  Reflect.set(globalThis, graphsKey, created);
  return created;
}

/** Records the reader of the `skills()` call that built a graph. */
function recordGraph(graph: CommandGraph, read: SkillsReader): void {
  graphs().set(graph, { format: graphsFormat, read });
}

/** The fault of an entry, or what its reader answered, whose shape this copy does not know. */
function unknownFormat() {
  return folderFault(
    "This @loomcli/plugins cannot read the skills the application's @loomcli/plugins recorded.",
    'Install @loomcli/plugins at one version, and run again.',
  );
}

/** Whether a value is one file as a reader answers it. */
function isSkillFile(value: unknown): value is SkillFile {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    (typeof value.content === 'string' || value.content instanceof Uint8Array) &&
    typeof value.executable === 'boolean'
  );
}

/** Whether a value is a reader's answer: each skill's name and its files. */
function isSkillFolders(value: unknown): value is readonly SkillFolder[] {
  return (
    Array.isArray(value) &&
    value.every(
      (skill: unknown) =>
        isRecord(skill) &&
        typeof skill.name === 'string' &&
        Array.isArray(skill.files) &&
        skill.files.every((file: unknown) => isSkillFile(file)),
    )
  );
}

/**
 * The skills the `skills()` call that built a graph declares, read by that call's reader, or
 * `undefined` when no call recorded the graph. An entry, or an answer, of a shape this copy does
 * not know throws the folder rule's `DeclarationError`.
 */
async function recordedSkills(
  graph: CommandGraph,
  options: SkillFoldersOptions,
): Promise<readonly SkillFolder[] | undefined> {
  const entry = graphs().get(graph);
  if (entry === undefined) {
    return undefined;
  }
  if (!isRecord(entry) || entry.format !== graphsFormat || typeof entry.read !== 'function') {
    throw unknownFormat();
  }
  const answer: unknown = await Reflect.apply(entry.read, undefined, [graph, options]);
  if (!isSkillFolders(answer)) {
    throw unknownFormat();
  }
  return answer;
}

export type { SkillsReader };
export { recordedSkills, recordGraph };
