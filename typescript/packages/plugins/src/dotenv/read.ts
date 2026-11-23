import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EnvironmentContext } from '@loomcli/core';

import { expandValue } from './expand.js';
import type { Lookup } from './expand.js';
import { parseDotenv } from './parse.js';
import type { DotenvAssignment } from './parse.js';
import { dotenvPhrase } from './phrases.js';
import { imported, skippedName } from './wording.js';
import type { SkipReason } from './wording.js';

/** The mode the test runner sets, under which `.env.local` is not read. */
const testMode = 'test';

/**
 * The files the plugin reads for a mode, from the most to the least specific, which is the order
 * Bun and Next.js load them in. A file the list names twice is kept at its more specific place.
 */
function dotenvFiles(mode: string | undefined): string[] {
  const named = mode === undefined || mode === '' ? undefined : mode;
  const files = [
    ...(named === undefined ? [] : [`.env.${named}.local`]),
    ...(named === testMode ? [] : ['.env.local']),
    ...(named === undefined ? [] : [`.env.${named}`]),
    '.env',
  ];
  return files.filter((file, index) => files.indexOf(file) === index);
}

async function fileText(
  cwd: string,
  file: string,
  out: EnvironmentContext['out'],
): Promise<string | undefined> {
  try {
    return await readFile(join(cwd, file), 'utf8');
  } catch (error) {
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EISDIR') {
      await out.warn(dotenvPhrase('fileUnreadable', file));
    }
    return undefined;
  }
}

/**
 * One file's assignments with their references read, in order. A reference reads the hook's
 * environment first, then the names more specific files gave, then the file's own earlier lines.
 */
function expandFile(
  assignments: readonly DotenvAssignment[],
  outer: Lookup,
): ReadonlyMap<string, string> {
  const own = new Map<string, string>();
  const lookup: Lookup = (name) => outer(name) ?? own.get(name);
  for (const { name, quote, value } of assignments) {
    own.set(name, expandValue(value, quote, lookup));
  }
  return own;
}

/** Only file access errors are lenient; parser and output defects use the ordinary failure path. */
async function readLayer(
  file: string,
  context: Pick<EnvironmentContext, 'host' | 'out'>,
  reading: { imports: (name: string) => boolean; outer: Lookup },
) {
  const { host, out } = context;
  const { imports, outer } = reading;
  const text = await fileText(host.cwd, file, out);
  if (text === undefined) {
    return new Map<string, string>();
  }
  const { assignments, malformed } = parseDotenv(text, imports);
  for (const { line, name } of malformed) {
    await out.warn(dotenvPhrase('lineMalformed', name, line, file));
  }
  return expandFile(assignments, outer);
}

/** The settings' list that leaves a name out, or `undefined` when the plugin imports it. */
type ListedOut = (name: string) => 'except' | 'only' | undefined;

/** What the files read so far hold: each name's first value, and the file that supplied it. */
interface Layers {
  readonly values: Map<string, string>;
  readonly files: Map<string, string>;
}

/** What judging a file's names reads: the hook's environment, the files read so far, and the list. */
interface Judging {
  readonly env: EnvironmentContext['host']['env'];
  readonly layers: Layers;
  readonly listedOut: ListedOut;
}

/** Keeps a name's value and the file that supplied it, when no more specific file did. */
function keepFirst(layers: Layers, [name, value]: readonly [string, string], file: string): void {
  if (!layers.values.has(name)) {
    layers.values.set(name, value);
    layers.files.set(name, file);
  }
}

/**
 * Why a file's name is not imported from it, with the first reason that holds: the settings'
 * list, then the environment, an empty value included, then a more specific file. `undefined` is
 * a name the file imports.
 */
function skipReason(name: string, reading: Judging): SkipReason | undefined {
  const { env, layers, listedOut } = reading;
  const listed = listedOut(name);
  if (listed !== undefined) {
    return { kind: listed };
  }
  if (Object.hasOwn(env, name) && env[name] !== undefined) {
    return { kind: 'set' };
  }
  const from = layers.files.get(name);
  return from === undefined ? undefined : { from, kind: 'supplied' };
}

/** What one file's names came to: the ones it imports, and each one passed over with why. */
interface LayerOutcome {
  readonly imported: string[];
  readonly skipped: [string, SkipReason][];
}

/**
 * Sorts one file's names, in the order the file first assigns them, into the ones it imports and
 * the ones it passes over, and keeps each name's first value and the file that supplied it.
 */
function judgeLayer(
  file: string,
  names: ReadonlyMap<string, string>,
  reading: Judging,
): LayerOutcome {
  const outcome: LayerOutcome = { imported: [], skipped: [] };
  for (const entry of names) {
    const [name] = entry;
    const reason = skipReason(name, reading);
    if (reason === undefined) {
      outcome.imported.push(name);
    } else {
      outcome.skipped.push([name, reason]);
    }
    keepFirst(reading.layers, entry, file);
  }
  return outcome;
}

const noNames = 0;

/**
 * Logs one file's lines: at `debug` how many names it imported, when any, and at `trace` each name
 * it passed over and why, in the order the file first assigns them. No line holds a value.
 */
function reportLayer(file: string, outcome: LayerOutcome, log: EnvironmentContext['log']): void {
  if (outcome.imported.length > noNames) {
    const line = imported(outcome.imported.length, file);
    log.debug(line.template, line.fields);
  }
  for (const [name, reason] of outcome.skipped) {
    const line = skippedName(name, file, reason);
    log.trace(line.template, line.fields);
  }
}

/**
 * Reads the layered files from the most specific, as Bun loads them, so a name keeps the first
 * value read and a later file only fills names still unset. That order decides what a reference
 * reads.
 */
async function readDotenv(context: EnvironmentContext, listedOut: ListedOut) {
  const { env } = context.host;
  const imports = (name: string) => listedOut(name) === undefined;
  const layers: Layers = { files: new Map(), values: new Map() };
  // A name the environment holds as undefined is unset, as core's merge reads it.
  const outer: Lookup = (name) =>
    (Object.hasOwn(env, name) ? env[name] : undefined) ?? layers.values.get(name);
  for (const file of dotenvFiles(env.NODE_ENV)) {
    const names = await readLayer(file, context, { imports, outer });
    reportLayer(file, judgeLayer(file, names, { env, layers, listedOut }), context.log);
  }
  return Object.fromEntries([...layers.values].filter(([name]) => imports(name)));
}

export type { ListedOut };
export { readDotenv };
