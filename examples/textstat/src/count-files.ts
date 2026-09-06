import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ActionHandler } from '@loom/core';

import type { textstat } from './application.js';

// oxlint-disable-next-line eslint/no-magic-numbers
type Metric = Parameters<ActionHandler<typeof textstat>>[0]['options']['metric'];

function countContent(bytes: Buffer, metric: Metric) {
  switch (metric) {
    case 'bytes': {
      return bytes.byteLength;
    }
    case 'words': {
      return [...bytes.toString('utf8').matchAll(/\S+/gu)].length;
    }
    case 'lines': {
      return [...bytes.toString('utf8').matchAll(/\n/gu)].length;
    }
    default: {
      const exhaustive: never = metric;
      return exhaustive;
    }
  }
}

export const countFiles: ActionHandler<typeof textstat> = async ({ args, options, host, out }) => {
  let total = 0;
  for (const file of args.files) {
    const bytes = await readFile(resolve(host.cwd, file)).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'The file could not be read.';
      return out.fatal(`Cannot read file: ${file}: ${reason}`);
    });
    if (bytes.byteLength >= options['min-bytes']) {
      const count = countContent(bytes, options.metric);
      total += count;
      await out.print(`${count}\t${file}`);
    }
  }
  if (options.total) {
    await out.print(`${total}\ttotal`);
  }
};
