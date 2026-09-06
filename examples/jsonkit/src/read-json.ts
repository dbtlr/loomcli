import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Host, Out } from '@loom/core';

function explain(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Every action reads its document here, so read and parse failures read the same everywhere. */
export async function readJson(file: string, host: Host, out: Out): Promise<unknown> {
  const text = await readFile(resolve(host.cwd, file), 'utf8').catch((error: unknown) =>
    out.fatal(`Cannot read file: ${file}: ${explain(error, 'The file could not be read.')}`),
  );
  try {
    const document: unknown = JSON.parse(text);
    return document;
  } catch (error: unknown) {
    return out.fatal(
      `Cannot parse JSON in ${file}: ${explain(error, 'The text is not valid JSON.')}`,
    );
  }
}
