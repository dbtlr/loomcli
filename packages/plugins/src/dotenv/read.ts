import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EnvironmentContext } from '@loomcli/core';

import { parseDotenv } from './parse.js';

async function fileText(cwd: string, out: EnvironmentContext['out']): Promise<string | undefined> {
  try {
    return await readFile(join(cwd, '.env'), 'utf8');
  } catch (error) {
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EISDIR') {
      await out.warn('Skipped .env: the file could not be read. Make it readable, or remove it.');
    }
    return undefined;
  }
}

/** Only file access errors are lenient; parser and output defects use the ordinary failure path. */
export async function readDotenv(
  { host, out }: EnvironmentContext,
  variables: ReadonlySet<string>,
) {
  const text = await fileText(host.cwd, out);
  if (text === undefined) {
    return undefined;
  }
  const { malformed, values } = parseDotenv(text, variables);
  for (const { line, name } of malformed) {
    await out.warn(
      `Skipped ${name} on line ${String(line)} of .env: the line is not a valid assignment. Correct the line, or remove it.`,
    );
  }
  return values;
}
