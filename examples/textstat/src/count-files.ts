import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ActionHandler } from '@loom/core';

import type { textstat } from './application.js';

export const countFiles: ActionHandler<typeof textstat> = async ({ args, host, out }) => {
  for (const file of args.files) {
    const bytes = await readFile(resolve(host.cwd, file)).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'The file could not be read.';
      return out.fatal(`Cannot read file: ${file}: ${reason}`);
    });
    await out.print(`${bytes.byteLength}\t${file}`);
  }
};
