import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EnvironmentContext } from '@loomcli/core';

import { expandValue } from './expand.js';
import type { Lookup } from './expand.js';
import { parseDotenv } from './parse.js';
import type { DotenvAssignment } from './parse.js';

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
      await out.warn(
        `Skipped ${file}: the file could not be read. Make it readable, or remove it.`,
      );
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
    await out.warn(
      `Skipped ${name} on line ${String(line)} of ${file}: the line is not a valid assignment. Correct the line, or remove it.`,
    );
  }
  return expandFile(assignments, outer);
}

/**
 * Reads the layered files from the most specific, as Bun loads them, so a name keeps the first
 * value read and a later file only fills names still unset. That order decides what a reference
 * reads.
 */
async function readDotenv(context: EnvironmentContext, imports: (name: string) => boolean) {
  const { env } = context.host;
  const known = new Map<string, string>();
  const outer: Lookup = (name) => (Object.hasOwn(env, name) ? env[name] : known.get(name));
  for (const file of dotenvFiles(env.NODE_ENV)) {
    for (const [name, value] of await readLayer(file, context, { imports, outer })) {
      if (!known.has(name)) {
        known.set(name, value);
      }
    }
  }
  return Object.fromEntries([...known].filter(([name]) => imports(name)));
}

export { readDotenv };
